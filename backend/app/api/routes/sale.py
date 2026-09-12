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


@router.get("/store-summary", response_model=APIResponse)
def sale_store_summary():
    """
    Store-wise daily sale pivot — last 6 weeks (42 days) from sale_raw parquet.
    Returns rows with store_name + one key per date (YYYY-MM-DD) = sale_netamt.
    Also returns weeks[] grouping for collapse UI.
    """
    from datetime import timedelta
    from app.core.parquet_store import read_parquet
    from app.repositories.store_repository import StoreRepository

    try:
        sale = read_parquet("sale_raw")
    except FileNotFoundError:
        return APIResponse.fail("sale_raw parquet not downloaded yet. Go to Data Store and download SALE Raw.")

    sale.columns = [c.lower() for c in sale.columns]
    sale["sale_date"] = pd.to_datetime(sale["sale_date"], errors="coerce")
    sale = sale.dropna(subset=["sale_date"])

    t1_date     = sale["sale_date"].max().date()
    six_w_start = t1_date - timedelta(days=55)  # 56 days = 8 weeks

    # Filter to last 8 weeks
    six_w = sale[(sale["sale_date"].dt.date >= six_w_start) & (sale["sale_date"].dt.date <= t1_date)].copy()
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

    # MTD and LM ranges
    mtd_start = t1_date.replace(day=1)
    import calendar
    lm_year  = t1_date.year if t1_date.month > 1 else t1_date.year - 1
    lm_month = t1_date.month - 1 if t1_date.month > 1 else 12
    lm_start = t1_date.replace(year=lm_year, month=lm_month, day=1)
    lm_end   = t1_date.replace(year=lm_year, month=lm_month,
                               day=calendar.monthrange(lm_year, lm_month)[1])

    # MTD pivot (from full sale, not six_w)
    mtd_df = sale[(sale["sale_date"].dt.date >= mtd_start) & (sale["sale_date"].dt.date <= t1_date)].copy()
    lm_df  = sale[(sale["sale_date"].dt.date >= lm_start)  & (sale["sale_date"].dt.date <= lm_end)].copy()

    mtd_pv = mtd_df.groupby("sitecode")["sale_netamt"].sum() if len(mtd_df) else pd.Series(dtype=float)
    lm_pv  = lm_df.groupby("sitecode")["sale_netamt"].sum()  if len(lm_df)  else pd.Series(dtype=float)

    rows = []
    for code in pivot_val.index:
        sid   = str(code).strip()
        sm    = store_map.get(sid, {})
        dvals = {d: round(float(pivot_val.loc[code, d]), 2) if d in pivot_val.columns else 0.0 for d in dates}
        dqtys = {d: int(pivot_qty.loc[code, d])             if d in pivot_qty.columns else 0    for d in dates}

        six_w_val = round(sum(dvals.values()), 2)
        six_w_qty = sum(dqtys.values())
        yday_val  = dvals.get(t1_str, 0.0)
        yday_qty  = dqtys.get(t1_str, 0)

        # Per-week sums (for frontend top-N max computation)
        week_sums = [round(sum(dvals.get(d, 0) for d in wk["dates"]), 2) for wk in weeks]

        rows.append({
            "store_name":       sid,
            "store_name_short": str(sm.get("store_name_short", "")),
            "store_name_f":     str(sm.get("store_name_f", "")),
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
    return APIResponse.ok(data={
        "rows":         rows,
        "count":        len(rows),
        "sale_date":    t1_str,
        "period_start": str(six_w_start),   # 8-week start
        "mtd_start":    str(mtd_start),
        "lm_start":     str(lm_start),
        "lm_end":       str(lm_end),
        "dates":        dates,
        "weeks":        weeks,
    })
