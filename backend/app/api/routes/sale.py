"""
Store-wise Sale Dashboard — TY vs LY from pre-aggregated Oracle base tables.

T_DAILY_SALE_AMT_TY and T_DAILY_SALE_AMT_LY are the data source.
A background thread aggregates both to STORE × DATE level (~18s), writes
two Parquet files, and the frontend polls until ready (typically <30s).
"""
import logging
import threading
import time
from typing import Optional

import pandas as pd
from fastapi import APIRouter, Query, HTTPException

from app.models.response_models import APIResponse
from app.db.connection import get_connection
from app.core.config import settings

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/sale", tags=["Sale Dashboard"])

_OWNER = "MISRETAIL"
_TABLE_TY = "T_DAILY_SALE_AMT_TY"
_TABLE_LY = "T_DAILY_SALE_AMT_LY"

# Parquet cache keys (store_name re-used as owner/view slug)
_CACHE_TY = ("MISRETAIL", "SALE_TY_STORE_DATE")
_CACHE_LY = ("MISRETAIL", "SALE_LY_STORE_DATE")

_fetch_lock   = threading.Lock()
_fetch_active = False
_fetch_error  = ""

# Aggregation SQL — store × date × attribute1 level (18s total for both tables)
_AGG_SQL = """
    SELECT STORE_NAME, CLUSTER_TYPE, STORE_STATUS, REGION_TYPE, ATTRIBUTE1,
           TRUNC(BILLDATE) as SALE_DATE,
           SUM(SL_QTY) as SL_QTY,
           SUM(SL_V)   as SL_V,
           SUM(TGT_Q)  as TGT_Q,
           SUM(TGT_V)  as TGT_V
    FROM MISRETAIL."{table}"
    GROUP BY STORE_NAME, CLUSTER_TYPE, STORE_STATUS, REGION_TYPE, ATTRIBUTE1,
             TRUNC(BILLDATE)
"""


def _do_background_fetch() -> None:
    global _fetch_active, _fetch_error
    try:
        from app.core.parquet_cache import write_cache
        from app.repositories.base_repository import fetch_df

        logger.info("SALE BG: fetching TY data from %s.%s", _OWNER, _TABLE_TY)
        t0 = time.perf_counter()
        with get_connection() as conn:
            df_ty = fetch_df(conn, _AGG_SQL.format(table=_TABLE_TY), label="SALE_TY")
        logger.info("SALE BG: TY done — %d rows in %.0fs", len(df_ty), time.perf_counter() - t0)

        logger.info("SALE BG: fetching LY data from %s.%s", _OWNER, _TABLE_LY)
        t1 = time.perf_counter()
        with get_connection() as conn:
            df_ly = fetch_df(conn, _AGG_SQL.format(table=_TABLE_LY), label="SALE_LY")
        logger.info("SALE BG: LY done — %d rows in %.0fs", len(df_ly), time.perf_counter() - t1)

        write_cache(*_CACHE_TY, df_ty)
        write_cache(*_CACHE_LY, df_ly)
        _fetch_error = ""
        logger.info("SALE BG: cache ready — TY=%d rows, LY=%d rows", len(df_ty), len(df_ly))
    except Exception as exc:
        _fetch_error = str(exc)
        logger.error("SALE BG: fetch failed: %s", exc)
    finally:
        with _fetch_lock:
            _fetch_active = False


def _start_fetch_if_idle() -> bool:
    global _fetch_active
    with _fetch_lock:
        if _fetch_active:
            return False
        _fetch_active = True
    t = threading.Thread(target=_do_background_fetch, daemon=True, name="sale-fetch")
    t.start()
    return True


def _require_oracle():
    if not settings.is_oracle_configured:
        raise HTTPException(status_code=503, detail="Oracle not configured")


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/cache-status", response_model=APIResponse)
async def get_cache_status():
    """Poll to check if Parquet cache is ready."""
    _require_oracle()
    try:
        from app.core.parquet_cache import has_output, get_meta
        ty_ready = has_output(*_CACHE_TY)
        ly_ready = has_output(*_CACHE_LY)
        ready = ty_ready and ly_ready
        meta_ty = get_meta(*_CACHE_TY) if ty_ready else {}
        meta_ly = get_meta(*_CACHE_LY) if ly_ready else {}
        return APIResponse.ok(data={
            "ready":    ready,
            "fetching": _fetch_active,
            "error":    _fetch_error,
            "rows_ty":  meta_ty.get("rows", 0),
            "rows_ly":  meta_ly.get("rows", 0),
        })
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/data", response_model=APIResponse)
async def get_sale_data(
    cluster_type:  Optional[str] = Query(None),
    region_type:   Optional[str] = Query(None),
    store_status:  Optional[str] = Query(None),
    attribute1:    Optional[str] = Query(None),
    store_search:  Optional[str] = Query(None),
    date_from:     Optional[str] = Query(None, description="YYYY-MM-DD"),
    date_to:       Optional[str] = Query(None, description="YYYY-MM-DD"),
    force_refresh: bool          = Query(False),
    limit:         int           = Query(5000, ge=1, le=50000),
):
    """
    Return store-wise TY vs LY sale comparison.

    Filtered by store attributes and optional date range.
    Results are aggregated to store × date level — group by STORE_NAME on
    the frontend for totals.

    First call starts a ~20s Oracle background fetch; poll /api/sale/cache-status.
    """
    _require_oracle()
    try:
        from app.core.parquet_cache import has_output, read_cache

        if force_refresh:
            _start_fetch_if_idle()
            return APIResponse.ok(data={"loading": True, "fetching": True,
                                        "message": "Oracle refresh started"})

        if not (has_output(*_CACHE_TY) and has_output(*_CACHE_LY)):
            started = _start_fetch_if_idle()
            return APIResponse.ok(data={
                "loading":     True,
                "fetching":    True,
                "started_new": started,
                "message":     "Fetching from Oracle (~20 seconds). Poll /api/sale/cache-status.",
                "rows": [], "count": 0,
            })

        t0 = time.perf_counter()
        df_ty = read_cache(*_CACHE_TY)
        df_ly = read_cache(*_CACHE_LY)
        if df_ty is None or df_ly is None:
            return APIResponse.fail(message="Cache read error — try force_refresh=true")

        def _mask(df: pd.DataFrame) -> pd.Series:
            m = pd.Series([True] * len(df), index=df.index)
            if cluster_type:
                m &= df["cluster_type"].str.upper() == cluster_type.upper()
            if region_type:
                m &= df["region_type"].str.upper() == region_type.upper()
            if store_status and store_status != "-":
                m &= df["store_status"] == store_status
            if attribute1:
                m &= df["attribute1"].str.upper() == attribute1.upper()
            if store_search:
                m &= df["store_name"].str.upper().str.contains(store_search.upper(), na=False)
            if date_from:
                m &= pd.to_datetime(df["sale_date"]) >= pd.to_datetime(date_from)
            if date_to:
                m &= pd.to_datetime(df["sale_date"]) <= pd.to_datetime(date_to)
            return m

        ty_f = df_ty[_mask(df_ty)].copy()
        ly_f = df_ly[_mask(df_ly)].copy()

        # Aggregate to store level for TY vs LY table
        ty_agg = ty_f.groupby(
            ["store_name", "cluster_type", "store_status", "region_type"],
            as_index=False
        ).agg(TY_QTY=("sl_qty", "sum"), TY_V=("sl_v", "sum"),
              TY_TGT_Q=("tgt_q", "sum"), TY_TGT_V=("tgt_v", "sum"))

        ly_agg = ly_f.groupby(
            ["store_name", "cluster_type", "store_status", "region_type"],
            as_index=False
        ).agg(LY_QTY=("sl_qty", "sum"), LY_V=("sl_v", "sum"),
              LY_TGT_Q=("tgt_q", "sum"), LY_TGT_V=("tgt_v", "sum"))

        merged = pd.merge(ty_agg, ly_agg,
                          on=["store_name", "cluster_type", "store_status", "region_type"],
                          how="outer").fillna(0)

        merged = merged.rename(columns={
            "store_name": "STORE_NAME", "cluster_type": "CLUSTER_TYPE",
            "store_status": "STORE_STATUS", "region_type": "REGION_TYPE",
        })

        # Derived columns
        merged["ACHV_PCT"]  = (merged["TY_V"] / merged["TY_TGT_V"].replace(0, pd.NA) * 100).round(1)
        merged["GRWTH_PCT"] = ((merged["TY_V"] - merged["LY_V"]) / merged["LY_V"].replace(0, pd.NA) * 100).round(1)
        merged = merged.where(merged.notna(), None)
        merged = merged.head(limit)

        elapsed = round((time.perf_counter() - t0) * 1000, 1)
        return APIResponse.ok(data={
            "rows":    merged.to_dict(orient="records"),
            "count":   len(merged),
            "elapsed_ms": elapsed,
            "loading": False,
        })

    except Exception as exc:
        logger.error("SALE data error: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/daily", response_model=APIResponse)
async def get_daily_trend(
    store_name: str            = Query(...),
    date_from:  Optional[str] = Query(None),
    date_to:    Optional[str] = Query(None),
):
    """Day-wise TY vs LY trend for a single store."""
    _require_oracle()
    try:
        from app.core.parquet_cache import has_output, read_cache
        if not (has_output(*_CACHE_TY) and has_output(*_CACHE_LY)):
            return APIResponse.ok(data={"loading": True})

        df_ty = read_cache(*_CACHE_TY)
        df_ly = read_cache(*_CACHE_LY)

        def _store_daily(df):
            m = df["store_name"].str.upper() == store_name.upper()
            if date_from:
                m &= pd.to_datetime(df["sale_date"]) >= pd.to_datetime(date_from)
            if date_to:
                m &= pd.to_datetime(df["sale_date"]) <= pd.to_datetime(date_to)
            return df[m].groupby("sale_date", as_index=False).agg(
                sl_v=("sl_v", "sum"), tgt_v=("tgt_v", "sum"))

        ty_d = _store_daily(df_ty).rename(columns={"sl_v": "TY_V", "tgt_v": "TY_TGT", "sale_date": "SALE_DATE"})
        ly_d = _store_daily(df_ly).rename(columns={"sl_v": "LY_V", "tgt_v": "LY_TGT", "sale_date": "SALE_DATE"})
        merged = pd.merge(ty_d, ly_d, on="SALE_DATE", how="outer").fillna(0)
        merged["SALE_DATE"] = merged["SALE_DATE"].astype(str)
        merged = merged.sort_values("SALE_DATE")

        return APIResponse.ok(data={"rows": merged.to_dict(orient="records"), "store": store_name})
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/filters", response_model=APIResponse)
async def get_sale_filters():
    """Return distinct filter values — instant (from in-memory caches)."""
    _require_oracle()
    try:
        from app.core.parquet_cache import has_output, read_cache
        from app.repositories.store_repository import StoreRepository

        def uniq(df, col):
            if col in df.columns:
                return sorted(df[col].dropna().unique().tolist())
            return []

        cluster, region, attribute1, store_statuses = [], [], [], ["ACTIVE", "INACTIVE"]
        if has_output(*_CACHE_TY):
            df = read_cache(*_CACHE_TY)
            if df is not None:
                cluster        = uniq(df, "cluster_type")
                region         = uniq(df, "region_type")
                attribute1     = uniq(df, "attribute1")
                store_statuses = uniq(df, "store_status")
        else:
            from app.repositories.store_repository import StoreRepository
            store_df = StoreRepository().get_all_stores(active_only=False)
            cluster  = uniq(store_df, "cluster_type")
            region   = uniq(store_df, "region_type") if "region_type" in store_df.columns else []

        return APIResponse.ok(data={
            "cluster_type": cluster,
            "region_type":  region,
            "attribute1":   attribute1,
            "store_status": store_statuses,
        })

    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
