"""
Store-wise Sale Dashboard — TY vs LY from pre-aggregated Oracle base tables.

T_DAILY_SALE_AMT_TY and T_DAILY_SALE_AMT_LY are the data source.
A background thread aggregates both to STORE × DATE level (~18s), writes
two Parquet files, and the frontend polls until ready (typically <30s).
"""
import json
import logging
import threading
import time
from pathlib import Path
from typing import Any, Optional

import pandas as pd
from fastapi import APIRouter, Query, HTTPException
from pydantic import BaseModel

from app.models.response_models import APIResponse
from app.db.connection import get_connection
from app.core.config import settings

# ── store-summary result cache ────────────────────────────────────────────────
_STORE_SUMMARY_CACHE: dict | None = None
_STORE_SUMMARY_TS: float = 0.0
_STORE_SUMMARY_TTL = 1800  # 30 min

# ── weekly-summary result cache ───────────────────────────────────────────────
_WEEKLY_SUMMARY_CACHE: dict | None = None
_WEEKLY_SUMMARY_TS: float = 0.0
_WEEKLY_SUMMARY_TTL = 1800  # 30 min

# ── Sale Pivot preset storage ─────────────────────────────────────────────────
_SALE_PRESETS_FILE = Path(__file__).resolve().parents[3] / "data" / "sale_pivot_presets.json"

def _load_sale_presets() -> list[dict]:
    try:
        if _SALE_PRESETS_FILE.exists():
            return json.loads(_SALE_PRESETS_FILE.read_text(encoding="utf-8"))
    except Exception:
        pass
    return []

def _save_sale_presets(presets: list[dict]) -> None:
    _SALE_PRESETS_FILE.parent.mkdir(parents=True, exist_ok=True)
    _SALE_PRESETS_FILE.write_text(json.dumps(presets, ensure_ascii=False, indent=2), encoding="utf-8")

class SalePivotPreset(BaseModel):
    name: str
    rowDims: list[str]
    colDims: list[str]
    valSpecs: list[dict[str, Any]]
    colFilters: dict[str, Any] = {}
    search: str = ""
    showTop: int = 0
    condEnabled: bool = False
    condLo: str = ""
    condHi: str = ""

# ── Sale pivot merged DataFrame cache ────────────────────────────────────────
_SALE_DF_CACHE: "pd.DataFrame | None" = None
_SALE_DF_CACHE_TS: float = 0.0
_SALE_DF_CACHE_TTL = 1800  # 30 min

_SALE_PIVOT_DIMS = {
    "division", "section", "department", "article_name", "icode",
    "attribute1", "color", "cat1", "season", "sz_grp",
    "sitecode", "store_name", "store_name_f", "city_name", "state", "cluster_type", "zone",
    "sale_year", "sale_month", "sale_month_label", "sale_week",
}
_SALE_VALUE_COLS = {"sale_qty", "sale_netamt"}
_AGG_MAP = {"sum": "sum", "count": "count", "avg": "mean", "max": "max", "min": "min"}


def _load_sale_pivot_df(refresh: bool = False) -> "pd.DataFrame":
    global _SALE_DF_CACHE, _SALE_DF_CACHE_TS
    age = time.time() - _SALE_DF_CACHE_TS
    if not refresh and _SALE_DF_CACHE is not None and age < _SALE_DF_CACHE_TTL:
        return _SALE_DF_CACHE

    from app.core.parquet_store import read_parquet
    from app.repositories.store_repository import StoreRepository

    sale = read_parquet("sale_raw")
    sale.columns = [c.lower() for c in sale.columns]
    sale["sale_date"] = pd.to_datetime(sale["sale_date"], errors="coerce")
    sale = sale.dropna(subset=["sale_date"])
    sale["sale_qty"] = pd.to_numeric(sale["sale_qty"], errors="coerce").fillna(0)
    sale["sale_netamt"] = pd.to_numeric(sale["sale_netamt"], errors="coerce").fillna(0)
    sale["sale_year"]  = sale["sale_date"].dt.year.astype(str)
    sale["sale_month"] = sale["sale_date"].dt.strftime("%Y-%m")
    sale["sale_month_label"] = sale["sale_date"].dt.strftime("%b-%y")
    sale["sale_week"]  = sale["sale_date"].dt.strftime("%G-W%V")
    sale["sitecode"]   = sale["sitecode"].astype(str).str.strip()

    # join item_master
    try:
        item = read_parquet("item_master")
        item.columns = [c.lower() for c in item.columns]
        icode_col = "icode" if "icode" in item.columns else item.columns[0]
        keep_item = [c for c in ["icode", "division", "section", "department",
                                  "article_name", "attribute1", "color", "cat1",
                                  "season", "sz_grp", "mrp"] if c in item.columns]
        item = item[keep_item].drop_duplicates(subset=[icode_col])
        item[icode_col] = item[icode_col].astype(str).str.strip()
        sale["icode"] = sale["icode"].astype(str).str.strip()
        sale = sale.merge(item, on="icode", how="left")
    except Exception as e:
        logger.warning("sale_pivot: item_master join failed — %s", e)

    # join store_master (NSO names)
    try:
        sm_df = StoreRepository().get_all_stores(active_only=False)
        sm_df.columns = [c.lower() for c in sm_df.columns]
        sid_col = "store_name" if "store_name" in sm_df.columns else sm_df.columns[0]
        sm_df["_sid"] = sm_df[sid_col].astype(str).str.strip()
        keep_sm = {c: c for c in ["store_name_short", "store_grade", "city_name",
                                   "state_name", "cluster_type", "zone"] if c in sm_df.columns}
        sm_small = sm_df[["_sid"] + list(keep_sm.keys())].drop_duplicates("_sid")
        sm_small = sm_small.rename(columns={"state_name": "state"})
        sale = sale.merge(sm_small.rename(columns={"_sid": "sitecode"}), on="sitecode", how="left")
        # NSO fname
        nso_fname_map: dict = {}
        try:
            from app.core.parquet_cache import has_output, read_cache as _rc
            if has_output("CK_A2166", "STORE_MASTER_NSO"):
                nso_df = _rc("CK_A2166", "STORE_MASTER_NSO")
                if nso_df is not None and "site_code" in nso_df.columns and "store_f_name" in nso_df.columns:
                    nso_fname_map = dict(zip(
                        nso_df["site_code"].astype(str).str.strip(),
                        nso_df["store_f_name"].fillna("").astype(str)
                    ))
        except Exception:
            pass
        sale["store_name_f"] = sale["sitecode"].map(nso_fname_map).fillna("")
        if "store_name_short" in sale.columns:
            sale["store_name"] = sale["store_name_f"].where(sale["store_name_f"] != "", sale["store_name_short"])
        else:
            sale["store_name"] = sale["store_name_f"].where(sale["store_name_f"] != "", sale["sitecode"])
    except Exception as e:
        logger.warning("sale_pivot: store_master join failed — %s", e)
        sale["store_name"] = sale["sitecode"]
        sale["store_name_f"] = ""

    _SALE_DF_CACHE = sale
    _SALE_DF_CACHE_TS = time.time()
    return sale


def _df_to_rows_safe(df: "pd.DataFrame") -> list[dict]:
    df = df.copy()
    for col in df.select_dtypes(include=["datetime64[ns]", "datetime64[ns, UTC]"]).columns:
        df[col] = df[col].dt.strftime("%Y-%m-%d")
    return df.where(df.notna(), other=None).to_dict(orient="records")

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

# Aggregation SQL — store × date × division × attribute1 level
_AGG_SQL = """
    SELECT STORE_NAME, CLUSTER_TYPE, STORE_STATUS, REGION_TYPE,
           DIVISION, ATTRIBUTE1,
           TRUNC(BILLDATE) as SALE_DATE,
           SUM(SL_QTY) as SL_QTY,
           SUM(SL_V)   as SL_V,
           SUM(TGT_Q)  as TGT_Q,
           SUM(TGT_V)  as TGT_V
    FROM MISRETAIL."{table}"
    GROUP BY STORE_NAME, CLUSTER_TYPE, STORE_STATUS, REGION_TYPE,
             DIVISION, ATTRIBUTE1,
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
    attribute1:    Optional[str] = Query(None, description="Comma-separated campaign values"),
    division:      Optional[str] = Query(None, description="Comma-separated division values"),
    store_search:  Optional[str] = Query(None),
    date_from:     Optional[str] = Query(None, description="TY date from YYYY-MM-DD"),
    date_to:       Optional[str] = Query(None, description="TY date to YYYY-MM-DD"),
    ly_date_from:  Optional[str] = Query(None, description="LY date from YYYY-MM-DD (defaults to date_from -1yr)"),
    ly_date_to:    Optional[str] = Query(None, description="LY date to YYYY-MM-DD (defaults to date_to -1yr)"),
    by_date:       bool          = Query(False, description="Aggregate by date instead of store"),
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

        attr_vals = [v.strip().upper() for v in attribute1.split(",")] if attribute1 else []
        div_vals  = [v.strip().upper() for v in division.split(",")]  if division  else []

        def _base_mask(df: pd.DataFrame) -> pd.Series:
            m = pd.Series([True] * len(df), index=df.index)
            if cluster_type:
                m &= df["cluster_type"].str.upper() == cluster_type.upper()
            if region_type:
                m &= df["region_type"].str.upper() == region_type.upper()
            if store_status and store_status != "-":
                m &= df["store_status"] == store_status
            if attr_vals:
                m &= df["attribute1"].str.upper().isin(attr_vals)
            if div_vals and "division" in df.columns:
                m &= df["division"].str.upper().isin(div_vals)
            if store_search:
                m &= df["store_name"].str.upper().str.contains(store_search.upper(), na=False)
            return m

        def _date_mask(df: pd.DataFrame, d_from: Optional[str], d_to: Optional[str]) -> pd.Series:
            m = pd.Series([True] * len(df), index=df.index)
            if d_from:
                m &= pd.to_datetime(df["sale_date"]) >= pd.to_datetime(d_from)
            if d_to:
                m &= pd.to_datetime(df["sale_date"]) <= pd.to_datetime(d_to)
            return m

        # LY dates: use explicit ly_date_from/to if provided, else fall back to TY dates
        eff_ly_from = ly_date_from if ly_date_from else date_from
        eff_ly_to   = ly_date_to   if ly_date_to   else date_to

        ty_f = df_ty[_base_mask(df_ty) & _date_mask(df_ty, date_from, date_to)].copy()
        ly_f = df_ly[_base_mask(df_ly) & _date_mask(df_ly, eff_ly_from, eff_ly_to)].copy()

        if by_date:
            # ── Date-wise aggregation ──────────────────────────────────────────
            ty_d = ty_f.groupby("sale_date", as_index=False).agg(
                TY_QTY=("sl_qty", "sum"), TY_V=("sl_v", "sum"),
                TY_TGT_Q=("tgt_q", "sum"), TY_TGT_V=("tgt_v", "sum"))
            ly_d = ly_f.groupby("sale_date", as_index=False).agg(
                LY_QTY=("sl_qty", "sum"), LY_V=("sl_v", "sum"),
                LY_TGT_Q=("tgt_q", "sum"), LY_TGT_V=("tgt_v", "sum"))
            merged = pd.merge(ty_d, ly_d, on="sale_date", how="outer").fillna(0)
            merged = merged.rename(columns={"sale_date": "SALE_DATE"})
            merged["SALE_DATE"] = merged["SALE_DATE"].astype(str)
            merged = merged.sort_values("SALE_DATE")
            merged["ACHV_PCT"]  = (merged["TY_V"] / merged["TY_TGT_V"].replace(0, pd.NA) * 100).round(1)
            merged["GRWTH_PCT"] = ((merged["TY_V"] - merged["LY_V"]) / merged["LY_V"].replace(0, pd.NA) * 100).round(1)
            merged = merged.where(merged.notna(), None)
            merged = merged.head(limit)
        else:
            # ── Store-wise aggregation (default) ──────────────────────────────
            base_keys = ["store_name", "cluster_type", "store_status", "region_type"]
            div_key = "division" if "division" in ty_f.columns else None
            grp_keys = base_keys + ([div_key] if div_key else [])

            ty_agg = ty_f.groupby(grp_keys, as_index=False).agg(
                TY_QTY=("sl_qty", "sum"), TY_V=("sl_v", "sum"),
                TY_TGT_Q=("tgt_q", "sum"), TY_TGT_V=("tgt_v", "sum"))
            ly_agg = ly_f.groupby(base_keys, as_index=False).agg(
                LY_QTY=("sl_qty", "sum"), LY_V=("sl_v", "sum"),
                LY_TGT_Q=("tgt_q", "sum"), LY_TGT_V=("tgt_v", "sum"))

            merged = pd.merge(ty_agg, ly_agg, on=base_keys, how="outer").fillna(0)
            rename_map = {
                "store_name": "STORE_NAME", "cluster_type": "CLUSTER_TYPE",
                "store_status": "STORE_STATUS", "region_type": "REGION_TYPE",
            }
            if div_key:
                rename_map[div_key] = "DIVISION"
            merged = merged.rename(columns=rename_map)

            # Enrich with OPERT_DAYS from store master
            try:
                from app.repositories.store_repository import StoreRepository
                from datetime import date as _date
                store_df = StoreRepository().get_all_stores(active_only=False)
                if store_df is not None and len(store_df) > 0:
                    store_df.columns = [c.lower() for c in store_df.columns]
                    if "opening_date" in store_df.columns:
                        od_map = store_df.set_index("store_name")["opening_date"].to_dict()
                        today = pd.Timestamp(_date.today())
                        od = pd.to_datetime(merged["STORE_NAME"].map(od_map), errors="coerce")
                        merged["OPERT_DAYS"] = (today - od).dt.days.clip(lower=0).fillna(0).astype(int)
            except Exception as enrich_err:
                logger.warning("Store master enrich failed: %s", enrich_err)

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

        cluster, region, attribute1, division, store_statuses = [], [], [], [], ["ACTIVE", "INACTIVE"]
        if has_output(*_CACHE_TY):
            df = read_cache(*_CACHE_TY)
            if df is not None:
                cluster        = uniq(df, "cluster_type")
                region         = uniq(df, "region_type")
                attribute1     = uniq(df, "attribute1")
                division       = uniq(df, "division")
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
            "division":     division,
            "store_status": store_statuses,
        })

    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/weekly-summary", response_model=APIResponse)
def sale_weekly_summary(refresh: bool = False):
    """
    2-year store × week pivot using TY + LY parquet cache.
    Weeks grouped by month for collapse UI.
    Returns both sl_v and sl_q per store per week.
    """
    global _WEEKLY_SUMMARY_CACHE, _WEEKLY_SUMMARY_TS

    if not refresh and _WEEKLY_SUMMARY_CACHE is not None:
        if time.time() - _WEEKLY_SUMMARY_TS < _WEEKLY_SUMMARY_TTL:
            return APIResponse.ok(data=_WEEKLY_SUMMARY_CACHE)

    try:
        from app.core.parquet_cache import has_output, read_cache

        if not (has_output(*_CACHE_TY) and has_output(*_CACHE_LY)):
            return APIResponse.ok(data={"loading": True, "message": "Cache not ready — trigger from Sale Dashboard first."})

        df_ty = read_cache(*_CACHE_TY)
        df_ly = read_cache(*_CACHE_LY)

        def _prep(df, year_label):
            d = df.copy()
            d["sale_date"] = pd.to_datetime(d["sale_date"], errors="coerce")
            d = d.dropna(subset=["sale_date"])
            d["iso_year"]  = d["sale_date"].dt.isocalendar().year.astype(int)
            d["iso_week"]  = d["sale_date"].dt.isocalendar().week.astype(int)
            d["week_key"]  = d["sale_date"].dt.strftime("%G-W%V")   # e.g. "2026-W09"
            d["month_key"] = d["sale_date"].dt.strftime("%Y-%m")     # e.g. "2026-03"
            d["week_start"] = d["sale_date"] - pd.to_timedelta(d["sale_date"].dt.dayofweek, unit="D")
            d["year_label"] = year_label
            return d

        ty = _prep(df_ty, "TY")
        ly = _prep(df_ly, "LY")
        combined = pd.concat([ty, ly], ignore_index=True)

        # Aggregate to store × week (group by week only — a cross-month week must not appear twice)
        agg = combined.groupby(["store_name", "week_key"], as_index=False).agg(
            val=("sl_v",   "sum"),
            qty=("sl_qty", "sum"),
            week_start=("week_start", "min"),
        )
        # Assign month from week_start so a week belongs to exactly one month
        agg["month_key"] = agg["week_start"].dt.strftime("%Y-%m")

        # Build opening-date map for active store count per period
        import calendar as _cal
        from app.repositories.store_repository import StoreRepository
        sm_df = StoreRepository().get_all_stores(active_only=False)
        sm_df.columns = [c.lower() for c in sm_df.columns]
        opening_dates: list = []
        if "opening_date" in sm_df.columns:
            # Filter to STORE locations only; column may be "location" or renamed "site_id"
            loc_col = "location" if "location" in sm_df.columns else (
                "site_id" if "site_id" in sm_df.columns and sm_df["site_id"].dtype == object else None
            )
            if loc_col:
                stores_only = sm_df[sm_df[loc_col].astype(str).str.upper() == "STORE"]
            else:
                stores_only = sm_df
            # Only ACTIVE stores contribute to the denominator
            if "store_status" in stores_only.columns:
                stores_only = stores_only[stores_only["store_status"].fillna("").str.upper() == "ACTIVE"]
            od = pd.to_datetime(stores_only["opening_date"], errors="coerce").dropna()
            opening_dates = sorted(od.tolist())
        total_stores_ever = len(opening_dates)

        import bisect
        def active_count_on(end_date: pd.Timestamp) -> int:
            return bisect.bisect_right(opening_dates, end_date)

        # Build week_end_map: week_key → last date in that week from sale data
        week_end_map: dict = {}
        for _, row in agg[["week_key","week_start"]].drop_duplicates().iterrows():
            ws = row["week_start"]
            we = ws + pd.Timedelta(days=6)
            wk = row["week_key"]
            if wk not in week_end_map or we > week_end_map[wk]:
                week_end_map[wk] = we

        # Build month → weeks metadata (newest month first)
        month_week_map: dict = {}
        for _, row in agg[["month_key","week_key","week_start"]].drop_duplicates().iterrows():
            mk = row["month_key"]
            wk = row["week_key"]
            ws = str(row["week_start"].date())
            if mk not in month_week_map:
                month_week_map[mk] = {}
            if wk not in month_week_map[mk]:
                month_week_map[mk][wk] = ws

        all_months_sorted = sorted(month_week_map.keys(), reverse=True)  # newest first
        months_meta = []
        for mk in all_months_sorted:
            wks = sorted(month_week_map[mk].keys(), reverse=True)        # newest week first
            dt  = pd.to_datetime(mk + "-01")
            month_end = dt.replace(day=_cal.monthrange(dt.year, dt.month)[1])
            m_store_cnt = active_count_on(month_end) if opening_dates else total_stores_ever
            weeks_list = []
            for w in wks:
                we = week_end_map.get(w, month_end)
                w_store_cnt = active_count_on(we) if opening_dates else total_stores_ever
                weeks_list.append({"key": w, "start": month_week_map[mk][w], "store_count": w_store_cnt})
            months_meta.append({
                "key":         mk,
                "label":       dt.strftime("%b-%y"),
                "store_count": m_store_cnt,
                "weeks":       weeks_list,
            })

        # Build per-store rows
        store_agg = agg.groupby("store_name")
        rows = []
        for store, grp in store_agg:
            wk_val = grp.set_index("week_key")["val"].to_dict()
            wk_qty = grp.set_index("week_key")["qty"].to_dict()
            mn_val = grp.groupby("month_key")["val"].sum().to_dict()
            mn_qty = grp.groupby("month_key")["qty"].sum().to_dict()
            total_val = round(float(grp["val"].sum()), 2)
            total_qty = int(grp["qty"].sum())
            rows.append({
                "store_name": str(store),
                "total_val":  total_val,
                "total_qty":  total_qty,
                "month_val":  {k: round(float(v), 2) for k, v in mn_val.items()},
                "month_qty":  {k: int(v) for k, v in mn_qty.items()},
                "week_val":   {k: round(float(v), 2) for k, v in wk_val.items()},
                "week_qty":   {k: int(v) for k, v in wk_qty.items()},
            })

        rows.sort(key=lambda x: -x["total_val"])
        result = {"rows": rows, "count": len(rows), "months": months_meta}
        _WEEKLY_SUMMARY_CACHE = result
        _WEEKLY_SUMMARY_TS    = time.time()
        return APIResponse.ok(data=result)
    except Exception as exc:
        logger.error("weekly-summary error: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/store-summary", response_model=APIResponse)
def sale_store_summary(refresh: bool = False):
    """
    Store-wise daily sale pivot — last 6 weeks (42 days) from sale_raw parquet.
    Returns rows with store_name + one key per date (YYYY-MM-DD) = sale_netamt.
    Also returns weeks[] grouping for collapse UI.
    """
    global _STORE_SUMMARY_CACHE, _STORE_SUMMARY_TS

    if not refresh and _STORE_SUMMARY_CACHE is not None:
        age = time.time() - _STORE_SUMMARY_TS
        if age < _STORE_SUMMARY_TTL:
            return APIResponse.ok(data=_STORE_SUMMARY_CACHE)

    from datetime import timedelta, date as _date
    from app.core.parquet_store import _parquet_path
    from app.repositories.store_repository import StoreRepository
    import pyarrow.parquet as pq

    try:
        p = _parquet_path("sale_raw")
        if not p.exists():
            return APIResponse.fail("sale_raw parquet not downloaded yet. Go to Data Store and download SALE Raw.")

        # Read only last 8 weeks using pyarrow row-group filter (avoids loading 76M rows)
        cutoff_date = _date.today() - timedelta(days=56)
        cutoff_ts   = pd.Timestamp(cutoff_date)
        sale = pd.read_parquet(p, engine="pyarrow",
                               filters=[("SALE_DATE", ">=", cutoff_ts)])
    except Exception as exc:
        return APIResponse.fail(f"sale_raw read failed: {str(exc)[:200]}")

    sale.columns = [c.lower() for c in sale.columns]
    sale["sale_date"] = pd.to_datetime(sale["sale_date"], errors="coerce")
    sale = sale.dropna(subset=["sale_date"])

    if sale.empty:
        return APIResponse.fail("sale_raw has no data in last 8 weeks.")

    t1_date     = sale["sale_date"].max().date()
    six_w_start = t1_date - timedelta(days=55)

    # Filter precisely (pyarrow filter may include extra rows at row-group boundary)
    cutoff_ts2  = pd.Timestamp(six_w_start)
    six_w = sale[sale["sale_date"] >= cutoff_ts2].copy()
    six_w["date_str"] = six_w["sale_date"].dt.strftime("%Y-%m-%d")

    # Pivot: store × date → sum
    pivot_val = six_w.groupby(["sitecode", "date_str"])["sale_netamt"].sum().unstack(fill_value=0)
    pivot_qty = six_w.groupby(["sitecode", "date_str"])["sale_qty"].sum().unstack(fill_value=0)

    # All dates sorted ascending; build week groups (newest-first)
    dates = sorted(pivot_val.columns.tolist())
    t1_str = str(t1_date)

    all_dates_rev = list(reversed(dates))  # newest → oldest
    weeks = []
    for w in range(8):
        w_dates = all_dates_rev[w * 7: (w + 1) * 7]  # 7 dates per week, newest first
        if w_dates:
            weeks.append({
                "week":   w + 1,
                "label":  f"W{w + 1}",
                "dates":  w_dates,        # newest first within week
                "start":  min(w_dates),
                "end":    max(w_dates),
            })

    store_df = StoreRepository().get_all_stores(active_only=False)
    # store_name col = SITE_CODE (numeric int) — same type as sale_raw SITECODE
    if "store_name" in store_df.columns:
        store_df["_sid"] = store_df["store_name"].astype(str).str.strip()
        store_map = store_df.drop_duplicates("_sid").set_index("_sid").to_dict("index")
    else:
        store_map = {}

    # Build NSO store_f_name map from STORE_MASTER_NSO (keyed by site_code numeric)
    nso_fname_map: dict = {}
    try:
        from app.core.parquet_cache import has_output, read_cache as _rc
        if has_output("CK_A2166", "STORE_MASTER_NSO"):
            nso_df = _rc("CK_A2166", "STORE_MASTER_NSO")
            if nso_df is not None and "site_code" in nso_df.columns and "store_f_name" in nso_df.columns:
                nso_fname_map = dict(zip(
                    nso_df["site_code"].astype(str).str.strip(),
                    nso_df["store_f_name"].fillna("").astype(str)
                ))
    except Exception:
        pass

    # MTD and LM ranges
    mtd_start = t1_date.replace(day=1)
    import calendar
    lm_year  = t1_date.year if t1_date.month > 1 else t1_date.year - 1
    lm_month = t1_date.month - 1 if t1_date.month > 1 else 12
    lm_start = t1_date.replace(year=lm_year, month=lm_month, day=1)
    lm_end   = t1_date.replace(year=lm_year, month=lm_month,
                               day=calendar.monthrange(lm_year, lm_month)[1])

    # MTD/LM: use Timestamp comparisons (no .dt.date on large df)
    mtd_df = sale[sale["sale_date"] >= pd.Timestamp(mtd_start)].copy()
    lm_df  = sale[(sale["sale_date"] >= pd.Timestamp(lm_start)) &
                  (sale["sale_date"] <= pd.Timestamp(lm_end))].copy()

    mtd_pv = mtd_df.groupby("sitecode")["sale_netamt"].sum() if len(mtd_df) else pd.Series(dtype=float)
    lm_pv  = lm_df.groupby("sitecode")["sale_netamt"].sum()  if len(lm_df)  else pd.Series(dtype=float)

    # Convert pivot to dict-of-dicts for O(1) per-cell access (much faster than .loc in loop)
    pv_dict = pivot_val.to_dict(orient="index")
    pq_dict = pivot_qty.to_dict(orient="index")

    rows = []
    for code in pivot_val.index:
        sid   = str(code).strip()
        sm    = store_map.get(sid, {})
        row_v = pv_dict.get(code, {})
        row_q = pq_dict.get(code, {})
        dvals = {d: round(float(row_v.get(d, 0)), 2) for d in dates}
        dqtys = {d: int(row_q.get(d, 0))             for d in dates}

        six_w_val = round(sum(dvals.values()), 2)
        six_w_qty = sum(dqtys.values())
        yday_val  = dvals.get(t1_str, 0.0)
        yday_qty  = dqtys.get(t1_str, 0)

        # Per-week sums (for frontend top-N max computation)
        week_sums = [round(sum(dvals.get(d, 0) for d in wk["dates"]), 2) for wk in weeks]

        nso_fname = nso_fname_map.get(sid, "") or str(sm.get("store_name_f", ""))
        rows.append({
            "store_name":       sid,
            "store_name_short": str(sm.get("store_name_short", "")),
            "store_name_f":     nso_fname,
            "zone":             str(sm.get("zone", "")),
            "state":            str(sm.get("state_name", "")),
            "grade":            str(sm.get("store_grade", "")),
            "yesterday_val":    yday_val,
            "yesterday_qty":    yday_qty,
            "six_w_val":        six_w_val,
            "six_w_qty":        six_w_qty,
            "week_sums":        week_sums,   # index = week index (0=W1 newest)
            "mtd_val":          round(float(mtd_pv.get(code, 0)), 2),
            "lm_val":           round(float(lm_pv.get(code, 0)),  2),
            "dates":            dvals,
        })

    rows.sort(key=lambda x: -x["yesterday_val"])
    result = {
        "rows":         rows,
        "count":        len(rows),
        "sale_date":    t1_str,
        "period_start": str(six_w_start),
        "mtd_start":    str(mtd_start),
        "lm_start":     str(lm_start),
        "lm_end":       str(lm_end),
        "dates":        dates,
        "weeks":        weeks,
    }
    _STORE_SUMMARY_CACHE = result
    _STORE_SUMMARY_TS    = time.time()
    return APIResponse.ok(data=result)


# ── Sale Pivot ────────────────────────────────────────────────────────────────

@router.get("/pivot", response_model=APIResponse)
def sale_pivot(
    rows: str = "division",
    cols: str = "",
    values: str = "sale_netamt:sum",
    division: str = "",
    season: str = "",
    attribute1: str = "",
    year_from: str = "",
    year_to: str = "",
    refresh: bool = False,
):
    try:
        row_dims = [c.strip().lower() for c in rows.split(",") if c.strip().lower() in _SALE_PIVOT_DIMS]
        col_dims = [c.strip().lower() for c in cols.split(",") if c.strip().lower() in _SALE_PIVOT_DIMS] if cols.strip() else []

        val_specs: list[tuple[str, str]] = []
        for part in values.split(","):
            part = part.strip()
            vc, ag = (part.split(":", 1) if ":" in part else (part, "sum"))
            vc = vc.strip().lower(); ag = ag.strip().lower()
            if vc in _SALE_VALUE_COLS and (ag in _AGG_MAP or ag == "pct"):
                val_specs.append((vc, ag))
        if not val_specs:
            val_specs = [("sale_netamt", "sum")]
        if not row_dims:
            return APIResponse.fail(f"Valid row dims: {sorted(_SALE_PIVOT_DIMS)}")

        df = _load_sale_pivot_df(refresh=refresh)
        if division:
            df = df[df["division"].astype(str).str.upper() == division.strip().upper()]
        if season:
            df = df[df["season"].astype(str).str.upper().str.contains(season.strip().upper(), na=False)]
        if attribute1:
            df = df[df["attribute1"].astype(str).str.upper().str.contains(attribute1.strip().upper(), na=False)]
        if year_from:
            df = df[df["sale_year"] >= year_from.strip()]
        if year_to:
            df = df[df["sale_year"] <= year_to.strip()]

        for vc, _ in val_specs:
            df[vc] = pd.to_numeric(df[vc], errors="coerce")

        all_dims = row_dims + col_dims
        base_specs = [(vc, ag) for vc, ag in val_specs if ag != "pct"]
        agg_dict: dict[str, list] = {}
        for vc, ag in base_specs:
            agg_dict.setdefault(vc, [])
            if _AGG_MAP[ag] not in agg_dict[vc]:
                agg_dict[vc].append(_AGG_MAP[ag])
        if not agg_dict:
            base_vc = val_specs[0][0]
            agg_dict = {base_vc: ["sum"]}

        grouped = df.groupby(all_dims, dropna=False).agg(agg_dict).reset_index()
        if isinstance(grouped.columns, pd.MultiIndex):
            grouped.columns = [f"{c[0]}_{c[1]}" if c[1] else c[0] for c in grouped.columns]

        for vc, ag in val_specs:
            if ag == "pct":
                src_col = f"{vc}_sum" if f"{vc}_sum" in grouped.columns else vc
                if src_col in grouped.columns:
                    total = grouped[src_col].sum()
                    grouped[f"{vc}_pct%"] = (grouped[src_col] / total * 100).round(2) if total else 0

        num_cols = [c for c in grouped.columns if c not in all_dims]
        grand_totals: dict[str, float] = {}
        for nc in num_cols:
            try:
                grand_totals[nc] = float(grouped[nc].sum())
            except Exception:
                grand_totals[nc] = 0

        if col_dims:
            val_cols_in_grouped = [c for c in grouped.columns if c not in all_dims]
            pivot_df = grouped.pivot_table(index=row_dims, columns=col_dims, values=val_cols_in_grouped, fill_value=0)
            if isinstance(pivot_df.columns, pd.MultiIndex):
                pivot_df.columns = [" | ".join(str(x) for x in col if x) for col in pivot_df.columns]
            else:
                pivot_df.columns = [str(c) for c in pivot_df.columns]
            pivot_df["__rt__"] = pivot_df.select_dtypes("number").sum(axis=1)
            pivot_df = pivot_df.sort_values("__rt__", ascending=False).drop(columns="__rt__").reset_index()
            col_headers = list(pivot_df.columns)
            out_rows = _df_to_rows_safe(pivot_df.head(500))
        else:
            sort_col = num_cols[0] if num_cols else None
            if sort_col:
                grouped = grouped.sort_values(sort_col, ascending=False)
            grouped = grouped.head(3000)
            col_headers = list(grouped.columns)
            out_rows = _df_to_rows_safe(grouped)

        return APIResponse.ok(data={
            "columns": col_headers,
            "rows": out_rows,
            "total": len(out_rows),
            "grand_totals": grand_totals,
            "grand_total": list(grand_totals.values())[0] if grand_totals else 0,
            "row_dims": row_dims,
            "col_dims": col_dims,
            "val_specs": [{"col": vc, "agg": ag} for vc, ag in val_specs],
        })
    except Exception as exc:
        logger.exception("sale_pivot failed")
        return APIResponse.fail(f"Pivot failed: {str(exc)[:300]}")


# ── Sale Pivot presets ────────────────────────────────────────────────────────

@router.get("/pivot/presets", response_model=APIResponse)
def sale_pivot_presets_get():
    return APIResponse.ok(data={"presets": _load_sale_presets()})


@router.post("/pivot/presets", response_model=APIResponse)
def sale_pivot_presets_save(preset: SalePivotPreset):
    presets = _load_sale_presets()
    presets = [p for p in presets if p.get("name") != preset.name]
    presets.append(preset.model_dump())
    _save_sale_presets(presets)
    return APIResponse.ok(data={"presets": presets})


@router.delete("/pivot/presets/{name}", response_model=APIResponse)
def sale_pivot_presets_delete(name: str):
    presets = [p for p in _load_sale_presets() if p.get("name") != name]
    _save_sale_presets(presets)
    return APIResponse.ok(data={"presets": presets})
