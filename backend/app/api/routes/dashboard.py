"""
Dashboard summary endpoint — Phase 9.

GET /api/dashboard/summary
  Aggregates live KPIs from Oracle (cached), SQLite history, and in-memory run store.
  All Oracle reads hit the item/store caches — no extra DB round-trips after first load.
"""
import logging
import time
from datetime import date
from typing import Optional

import pandas as pd

from fastapi import APIRouter

from app.models.response_models import APIResponse
from app.repositories.history_repository import list_history
from app.repositories.factor_repository import FactorRepository
from app.engine import run_store

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/dashboard", tags=["Dashboard"])

_factor_repo = FactorRepository()

# ── Oracle stats cache (5-minute TTL) ─────────────────────────────────────────
_oracle_cache: dict = {}
_oracle_cache_ts: float = 0.0
_ORACLE_TTL = 300  # seconds


def _safe_oracle_stats() -> dict:
    """Pull aggregate counts from Oracle caches. Returns zeros on any error.
    Result is cached for _ORACLE_TTL seconds to avoid hammering Oracle on every page load."""
    global _oracle_cache, _oracle_cache_ts
    age = time.time() - _oracle_cache_ts
    if _oracle_cache and age < _ORACLE_TTL:
        cached = dict(_oracle_cache)
        cached["oracle_cache_ms"] = round(age * 1000, 1)  # show age, not query time
        cached["from_cache"] = True
        return cached
    try:
        import concurrent.futures
        from app.repositories.item_repository import ItemRepository
        from app.repositories.store_repository import StoreRepository

        item_repo = ItemRepository()
        store_repo = StoreRepository()

        t0 = time.perf_counter()
        # Run both Oracle fetches in parallel with a 25s cap
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as ex:
            f_items  = ex.submit(item_repo._load)
            f_stores = ex.submit(store_repo.get_all_stores, True)
            item_df  = f_items.result(timeout=60)
            store_df = f_stores.result(timeout=60)
        oracle_ms = round((time.perf_counter() - t0) * 1000, 1)

        # Item stats
        total_items = len(item_df)
        attrs = sorted(item_df["attribute1"].dropna().unique().tolist()) if "attribute1" in item_df.columns else []
        divisions = item_df["division"].nunique() if "division" in item_df.columns else 0
        departments = item_df["department"].nunique() if "department" in item_df.columns else 0
        articles = item_df["article_name"].nunique() if "article_name" in item_df.columns else 0

        # Items by attribute1
        items_by_attr: dict = {}
        if "attribute1" in item_df.columns:
            items_by_attr = item_df.groupby("attribute1").size().to_dict()

        # Store stats
        active_stores = len(store_df)

        # Upcoming stores — from Parquet cache if available, else skip (avoid Oracle timeout)
        upcoming_stores = 0
        try:
            from app.core.parquet_cache import has_output, read_cache
            if has_output("MISRETAIL", "T_STORE_OPENING_DATE"):
                sod = read_cache("MISRETAIL", "T_STORE_OPENING_DATE")
                if sod is not None:
                    col_status = next((c for c in sod.columns if c.lower() == "store_status"), None)
                    if col_status:
                        upcoming_stores = int((sod[col_status].str.upper() == "UPCOMING_STORE").sum())
        except Exception as exc:
            logger.warning("upcoming store count failed: %s", exc)

        total_all_stores = active_stores + upcoming_stores
        status_dist: dict = {"ACTIVE": active_stores}
        if upcoming_stores:
            status_dist["UPCOMING"] = upcoming_stores

        # NSO: active stores opened on/after the 1st of two months ago (dynamic)
        # Aug → 01-Jun, Sep → 01-Jul, Jan → 01-Nov of prior year, etc.
        today = date.today()
        nso_month = today.month - 2
        nso_year = today.year
        if nso_month <= 0:
            nso_month += 12
            nso_year -= 1
        nso_start = date(nso_year, nso_month, 1)
        nso_label = nso_start.strftime("01-%b-%Y").upper()   # e.g. "01-JUN-2026"

        active_nso = 0
        if "opening_date" in store_df.columns:
            od = pd.to_datetime(store_df["opening_date"], errors="coerce")
            active_nso = int((od >= pd.Timestamp(nso_start)).sum())

        grade_dist: dict = {}
        if "store_grade" in store_df.columns:
            grade_dist = store_df["store_grade"].fillna("—").value_counts().to_dict()

        zone_dist: dict = {}
        if "zone" in store_df.columns:
            zone_dist = store_df["zone"].fillna("—").value_counts().head(10).to_dict()

        state_dist: dict = {}
        for col in ("state", "store_state", "state_name"):
            if col in store_df.columns:
                state_dist = store_df[col].fillna("—").value_counts().head(15).to_dict()
                break

        # Calendar year and financial year store counts from opening_date
        cal_year_dist: dict = {}
        fin_year_dist: dict = {}
        if "opening_date" in store_df.columns:
            od = pd.to_datetime(store_df["opening_date"], errors="coerce")
            valid = store_df[od.notna()].copy()
            valid["_cy"] = od[od.notna()].dt.year.astype(str)
            cal_year_dist = valid["_cy"].value_counts().sort_index().to_dict()
            # Financial year: Apr–Mar, e.g. Apr-2024 to Mar-2025 = "FY25"
            def fy_label(dt):
                return f"FY{str(dt.year + 1)[-2:]}" if dt.month >= 4 else f"FY{str(dt.year)[-2:]}"
            valid["_fy"] = od[od.notna()].apply(fy_label)
            fin_year_dist = valid["_fy"].value_counts().sort_index().to_dict()

        result = {
            "oracle_ok": True,
            "oracle_cache_ms": oracle_ms,
            "total_items": total_items,
            "total_stores": active_stores,
            "upcoming_stores": upcoming_stores,
            "total_all_stores": total_all_stores,
            "active_nso": active_nso,
            "nso_from_date": nso_label,
            "store_status_distribution": {str(k): int(v) for k, v in status_dist.items()},
            "divisions": int(divisions),
            "departments": int(departments),
            "articles": int(articles),
            "attributes": attrs,
            "items_by_attribute1": {str(k): int(v) for k, v in items_by_attr.items()},
            "store_grade_distribution": {str(k): int(v) for k, v in sorted(grade_dist.items())},
            "store_zone_distribution": {str(k): int(v) for k, v in zone_dist.items()},
            "store_state_distribution": {str(k): int(v) for k, v in state_dist.items()},
            "store_cal_year_dist": {str(k): int(v) for k, v in cal_year_dist.items()},
            "store_fin_year_dist": {str(k): int(v) for k, v in fin_year_dist.items()},
        }
        _oracle_cache.update(result)
        _oracle_cache_ts = time.time()
        return result
    except Exception as exc:
        logger.warning("dashboard Oracle stats failed: %s", exc)
        if _oracle_cache:
            logger.info("Returning stale oracle cache (age %.0fs)", time.time() - _oracle_cache_ts)
            stale = dict(_oracle_cache)
            stale["oracle_ok"] = False
            return stale
        return {
            "oracle_ok": False,
            "oracle_cache_ms": None,
            "total_items": 0,
            "total_stores": 0,
            "upcoming_stores": 0,
            "total_all_stores": 0,
            "active_nso": 0,
            "nso_from_date": None,
            "store_status_distribution": {},
            "divisions": 0,
            "departments": 0,
            "articles": 0,
            "attributes": [],
            "items_by_attribute1": {},
            "store_grade_distribution": {},
            "store_zone_distribution": {},
            "store_state_distribution": {},
            "store_cal_year_dist": {},
            "store_fin_year_dist": {},
        }


def _last_run_stats() -> dict:
    """Pull the most recent completed in-memory run summary + division breakdown."""
    runs = run_store.list_runs()
    last_complete = next((r for r in runs if r.status == "complete"), None)

    if not last_complete:
        return {"has_last_run": False}

    s = last_complete.summary
    req = last_complete.request

    # Division breakdown from result DataFrame
    division_breakdown: list[dict] = []
    df = run_store.get_results(last_complete.run_id)
    if df is not None and "division" in df.columns and "req" in df.columns:
        grp = (
            df.groupby("division")
            .agg(total_req=("req", "sum"), stores=("store_name", "nunique"), rows=("req", "count"))
            .reset_index()
            .sort_values("total_req", ascending=False)
        )
        division_breakdown = grp.to_dict(orient="records")

    return {
        "has_last_run": True,
        "run_id": last_complete.run_id,
        "label": last_complete.label,
        "factor_set_name": last_complete.factor_set_name,
        "completed_at": last_complete.completed_at,
        "duration_s": last_complete.duration_s,
        "attribute1": req.attribute1 if req else None,
        "division": req.division if req else None,
        "department": req.department if req else None,
        "total_rows": s.total_rows if s else 0,
        "total_req": s.total_req if s else 0,
        "total_pbs": s.total_pbs if s else 0,
        "stores": s.stores if s else 0,
        "departments": s.departments if s else 0,
        "fill_rate_achieved": s.fill_rate_achieved if s else 0,
        "zero_req_rows": s.zero_req_rows if s else 0,
        "capped_rows": s.capped_rows if s else 0,
        "result_rows": last_complete.result_rows,
        "division_breakdown": division_breakdown,
    }


def _history_stats() -> dict:
    """Aggregate stats across persisted run history."""
    try:
        all_complete, total_complete = list_history(status="complete", limit=200, offset=0)
        all_error, total_error = list_history(status="error", limit=1, offset=0)

        durations = [r["duration_s"] for r in all_complete if r.get("duration_s")]
        avg_duration = round(sum(durations) / len(durations), 1) if durations else None
        avg_req = (
            round(sum(r["total_req"] for r in all_complete) / len(all_complete), 0)
            if all_complete else None
        )

        recent, _ = list_history(limit=5, offset=0)

        return {
            "total_complete": total_complete,
            "total_error": total_error,
            "avg_duration_s": avg_duration,
            "avg_total_req": avg_req,
            "recent_runs": [
                {
                    "run_id": r["run_id"],
                    "label": r["label"],
                    "status": r["status"],
                    "started_at": r["started_at"],
                    "duration_s": r["duration_s"],
                    "total_req": r["total_req"],
                    "attribute1": r["attribute1"],
                    "exception_errors": r["exception_errors"],
                    "exception_warnings": r["exception_warnings"],
                }
                for r in recent
            ],
        }
    except Exception as exc:
        logger.warning("dashboard history stats failed: %s", exc)
        return {"total_complete": 0, "total_error": 0, "avg_duration_s": None, "avg_total_req": None, "recent_runs": []}


def _factor_stats() -> dict:
    """Active factor set summary."""
    try:
        sets = _factor_repo.list_sets()
        active = next((s for s in sets if s.is_active), None)
        return {
            "total_factor_sets": len(sets),
            "active_factor_set_id": active.id if active else None,
            "active_factor_set_name": active.name if active else None,
            "active_fill_rate": active.config.fill_rate_target if active and active.config else None,
            "active_safety_days": active.config.safety_days if active and active.config else None,
        }
    except Exception as exc:
        logger.warning("dashboard factor stats failed: %s", exc)
        return {"total_factor_sets": 0, "active_factor_set_id": None, "active_factor_set_name": None}


@router.get("/summary", response_model=APIResponse)
async def dashboard_summary():
    """
    Aggregate dashboard KPIs from all data sources in parallel.
    Oracle stats are cached for 5 minutes — first load is slow, subsequent loads are instant.
    """
    import asyncio
    t0 = time.perf_counter()

    loop = asyncio.get_event_loop()
    oracle, last_run, history, factors = await asyncio.gather(
        loop.run_in_executor(None, _safe_oracle_stats),
        loop.run_in_executor(None, _last_run_stats),
        loop.run_in_executor(None, _history_stats),
        loop.run_in_executor(None, _factor_stats),
    )

    elapsed_ms = round((time.perf_counter() - t0) * 1000, 1)

    return APIResponse.ok(data={
        "oracle": oracle,
        "last_run": last_run,
        "history": history,
        "factors": factors,
        "summary_ms": elapsed_ms,
    })


@router.post("/cache/clear", response_model=APIResponse)
async def clear_dashboard_cache():
    """Force-expire the oracle stats cache so next load re-fetches from Oracle."""
    global _oracle_cache_ts
    _oracle_cache_ts = 0.0
    return APIResponse.ok(message="Oracle stats cache cleared — next summary call will re-fetch.")


# ── Allocation summary cache ───────────────────────────────────────────────────
_alloc_cache: dict = {}
_alloc_cache_ts: float = 0.0
_ALLOC_TTL = 600  # 10 minutes


@router.get("/allocation-summary", response_model=APIResponse)
async def allocation_summary():
    """
    Division-level pivot of T_ALLOCATION_FOR_ALL_DIVISION parquet.
    Returns rows sorted by alloc_regn_q desc plus a totals row.
    Cached for 10 minutes.
    """
    global _alloc_cache, _alloc_cache_ts
    age = time.time() - _alloc_cache_ts
    if _alloc_cache and age < _ALLOC_TTL:
        return APIResponse.ok(data=_alloc_cache)

    try:
        from app.core.parquet_cache import has_output, read_cache

        if not has_output("MISRETAIL", "T_ALLOCATION_FOR_ALL_DIVISION"):
            return APIResponse.ok(data={"available": False, "rows": []})

        df = read_cache("MISRETAIL", "T_ALLOCATION_FOR_ALL_DIVISION")
        if df is None or df.empty:
            return APIResponse.ok(data={"available": False, "rows": []})

        if "division" not in df.columns:
            return APIResponse.ok(data={"available": False, "rows": []})

        def safe_col(col):
            return col if col in df.columns else None

        # Split STORE vs DC rows
        has_loc = "location" in df.columns
        store_df = df[df["location"] == "STORE"] if has_loc else df
        dc_df    = df[df["location"] == "DC"]    if has_loc else df.iloc[:0]

        # Store-level numeric cols
        STORE_NUM = ["total_stk_q", "lm_sl_q", "mtd_sl_q", "proj_q", "in_transit_q"]
        store_agg = {c: "sum" for c in STORE_NUM if safe_col(c)}
        pivot = store_df.groupby("division", as_index=False).agg(store_agg)

        # DC stock + alloc qty from DC rows
        if not dc_df.empty:
            dc_agg_cols = {c: "sum" for c in ["total_stk_q", "alloc_regn_q"] if c in dc_df.columns}
            dc_pivot = dc_df.groupby("division", as_index=False).agg(dc_agg_cols)
            dc_pivot = dc_pivot.rename(columns={"total_stk_q": "dc_stk_q"})
            pivot = pivot.merge(dc_pivot, on="division", how="left")
        else:
            pivot["dc_stk_q"] = 0
            pivot["alloc_regn_q"] = 0

        # Stores = only STORE location unique store_codes
        if safe_col("store_code"):
            store_grp = store_df.groupby("division")["store_code"].nunique().reset_index(name="stores")
            pivot = pivot.merge(store_grp, on="division", how="left")

        if safe_col("barcode"):
            art_grp = df.groupby("division")["barcode"].nunique().reset_index(name="articles")
            pivot = pivot.merge(art_grp, on="division", how="left")

        # Rename numeric cols
        rename_map = {
            "total_stk_q": "stk_qty", "alloc_regn_q": "alloc_qty",
            "lm_sl_q": "lm_sale_q", "mtd_sl_q": "mtd_sale_q",
            "proj_q": "proj_qty",
        }
        pivot = pivot.rename(columns={k: v for k, v in rename_map.items() if k in pivot.columns})

        # Sort by alloc_qty desc
        if "alloc_qty" in pivot.columns:
            pivot = pivot.sort_values("alloc_qty", ascending=False)

        # Totals row
        total_row = {"division": "__TOTAL__"}
        for col in pivot.columns:
            if col == "division":
                continue
            total_row[col] = int(pivot[col].sum()) if pivot[col].dtype.kind in "iuf" else None

        rows = [{k: (int(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else v)
                 for k, v in r.items()}
                for r in pivot.fillna(0).to_dict(orient="records")]

        result = {
            "available": True,
            "total_rows": int(len(df)),
            "rows": rows,
            "totals": total_row,
        }
        _alloc_cache = result
        _alloc_cache_ts = time.time()
        return APIResponse.ok(data=result)

    except Exception as exc:
        logger.warning("allocation summary failed: %s", exc)
        return APIResponse.ok(data={"available": False, "rows": [], "error": str(exc)})


def _alloc_parquet():
    """Return the allocation DataFrame or None."""
    from app.core.parquet_cache import has_output, read_cache
    if not has_output("MISRETAIL", "T_ALLOCATION_FOR_ALL_DIVISION"):
        return None
    return read_cache("MISRETAIL", "T_ALLOCATION_FOR_ALL_DIVISION")


from fastapi import Query as FQuery

_DETAIL_COLS = [
    "store_code", "store_name", "division", "section", "department",
    "article_name", "barcode", "mrp", "last_in_rate",
    "cat1", "cat2", "cat3", "cat4", "cat5", "cat6",
    "desc1", "desc2", "desc3", "desc4", "desc5", "desc6",
    "total_stk_q", "stk_q", "adj_stk_q", "alloc_regn_q",
    "pack_pend_q", "adj_pack_pend_q", "to_q", "adj_to_q",
    "in_transit_q", "adj_in_transit_q", "ppo_q",
    "lm_sl_q", "mtd_sl_q",
    "proj_mnth_1_q", "proj_mnth_1a_q", "proj_mnth_2_q", "proj_mnth_2a_q",
    "proj_mnth_3_q", "proj_mnth_3a_q", "proj_q",
]


@router.get("/allocation-barcodes", response_model=APIResponse)
async def allocation_barcodes(q: str = FQuery("", description="Partial barcode/icode search")):
    """Return up to 60 barcodes matching the query string."""
    try:
        df = _alloc_parquet()
        if df is None or "barcode" not in df.columns:
            return APIResponse.ok(data={"barcodes": []})
        barcodes = df["barcode"].dropna().astype(str).unique()
        if q:
            q_lower = q.lower()
            barcodes = [b for b in barcodes if q_lower in b.lower()]
        else:
            barcodes = list(barcodes)
        barcodes = sorted(barcodes)[:60]
        return APIResponse.ok(data={"barcodes": barcodes})
    except Exception as exc:
        logger.warning("allocation-barcodes failed: %s", exc)
        return APIResponse.ok(data={"barcodes": []})


@router.get("/allocation-detail", response_model=APIResponse)
async def allocation_detail(
    icodes: str = FQuery("", description="Comma-separated barcodes; empty = all"),
    page: int = FQuery(0, ge=0),
    limit: int = FQuery(500, ge=1, le=2000),
):
    """Return paginated rows from T_ALLOCATION_FOR_ALL_DIVISION with all columns."""
    try:
        df = _alloc_parquet()
        if df is None or df.empty:
            return APIResponse.ok(data={"available": False, "rows": [], "total": 0, "page": 0})

        # Filter by selected barcodes
        if icodes.strip():
            selected = [b.strip() for b in icodes.split(",") if b.strip()]
            if "barcode" in df.columns:
                df = df[df["barcode"].astype(str).isin(selected)]

        total = int(len(df))
        # Select only available columns
        avail = [c for c in _DETAIL_COLS if c in df.columns]
        page_df = df[avail].iloc[page * limit: (page + 1) * limit]

        # Serialize: round floats to int where appropriate
        rows = []
        for rec in page_df.fillna("").to_dict(orient="records"):
            clean = {}
            for k, v in rec.items():
                if isinstance(v, float):
                    clean[k] = int(v) if v == int(v) else round(v, 2)
                else:
                    clean[k] = v
            rows.append(clean)

        return APIResponse.ok(data={
            "available": True,
            "total": total,
            "page": page,
            "limit": limit,
            "total_pages": max(1, -(-total // limit)),
            "rows": rows,
            "columns": avail,
        })
    except Exception as exc:
        logger.warning("allocation-detail failed: %s", exc)
        return APIResponse.ok(data={"available": False, "rows": [], "total": 0, "error": str(exc)})


def _pivot_and_serialize(df, group_cols: list[str]) -> dict:
    """Generic pivot helper — groups df by group_cols and sums numeric cols.
    Separates STORE vs DC rows so stock counts and store counts are accurate.
    """
    has_loc = "location" in df.columns
    store_df = df[df["location"] == "STORE"] if has_loc else df
    dc_df    = df[df["location"] == "DC"]    if has_loc else df.iloc[:0]

    STORE_COLS = ["total_stk_q", "lm_sl_q", "mtd_sl_q", "proj_q", "in_transit_q"]
    DC_COLS    = ["total_stk_q", "alloc_regn_q"]

    store_agg = {c: "sum" for c in STORE_COLS if c in store_df.columns}
    pivot = store_df.groupby(group_cols, as_index=False).agg(store_agg)

    # DC stock + alloc from DC rows
    if not dc_df.empty:
        dc_agg = {c: "sum" for c in DC_COLS if c in dc_df.columns}
        dc_pivot = dc_df.groupby(group_cols, as_index=False).agg(dc_agg)
        dc_pivot = dc_pivot.rename(columns={"total_stk_q": "dc_stk_q"})
        pivot = pivot.merge(dc_pivot, on=group_cols, how="left")
    else:
        pivot["dc_stk_q"] = 0
        if "alloc_regn_q" not in pivot.columns:
            pivot["alloc_regn_q"] = 0

    # Store count = only STORE location unique store_codes
    if "store_code" in store_df.columns:
        sc = store_df.groupby(group_cols)["store_code"].nunique().reset_index(name="stores")
        pivot = pivot.merge(sc, on=group_cols, how="left")
    if "barcode" in df.columns:
        ac = df.groupby(group_cols)["barcode"].nunique().reset_index(name="articles")
        pivot = pivot.merge(ac, on=group_cols, how="left")

    rename = {
        "total_stk_q": "stk_qty", "alloc_regn_q": "alloc_qty",
        "lm_sl_q": "lm_sale_q", "mtd_sl_q": "mtd_sale_q",
        "proj_q": "proj_qty",
    }
    pivot = pivot.rename(columns={k: v for k, v in rename.items() if k in pivot.columns})

    if "alloc_qty" in pivot.columns:
        pivot = pivot.sort_values("alloc_qty", ascending=False)

    total_row: dict = {"__label__": "TOTAL"}
    for col in pivot.columns:
        if col in group_cols:
            continue
        total_row[col] = int(pivot[col].sum()) if pivot[col].dtype.kind in "iuf" else None

    def _to_int(v):
        if isinstance(v, float) and v == int(v):
            return int(v)
        return v

    rows = [{k: _to_int(v) for k, v in r.items()} for r in pivot.fillna(0).to_dict(orient="records")]
    return {"available": True, "total_rows": int(len(df)), "rows": rows, "totals": total_row}


# Store-wise cache
_store_cache: dict = {}
_store_cache_ts: float = 0.0

@router.get("/allocation-store", response_model=APIResponse)
async def allocation_store():
    """Store-wise pivot of T_ALLOCATION_FOR_ALL_DIVISION."""
    global _store_cache, _store_cache_ts
    age = time.time() - _store_cache_ts
    if _store_cache and age < _ALLOC_TTL:
        return APIResponse.ok(data=_store_cache)
    try:
        df = _alloc_parquet()
        if df is None or df.empty:
            return APIResponse.ok(data={"available": False, "rows": []})
        group_cols = [c for c in ["store_code", "store_name"] if c in df.columns]
        if not group_cols:
            return APIResponse.ok(data={"available": False, "rows": []})
        result = _pivot_and_serialize(df, group_cols)
        _store_cache.update(result)
        _store_cache_ts = time.time()
        return APIResponse.ok(data=result)
    except Exception as exc:
        logger.warning("allocation store summary failed: %s", exc)
        return APIResponse.ok(data={"available": False, "rows": [], "error": str(exc)})


# MC (div+section+dept) cache
_mc_cache: dict = {}
_mc_cache_ts: float = 0.0

@router.get("/allocation-mc", response_model=APIResponse)
async def allocation_mc():
    """Division + Section + Department pivot of T_ALLOCATION_FOR_ALL_DIVISION."""
    global _mc_cache, _mc_cache_ts
    age = time.time() - _mc_cache_ts
    if _mc_cache and age < _ALLOC_TTL:
        return APIResponse.ok(data=_mc_cache)
    try:
        df = _alloc_parquet()
        if df is None or df.empty:
            return APIResponse.ok(data={"available": False, "rows": []})
        group_cols = [c for c in ["division", "section", "department"] if c in df.columns]
        if not group_cols:
            return APIResponse.ok(data={"available": False, "rows": []})
        result = _pivot_and_serialize(df, group_cols)
        _mc_cache.update(result)
        _mc_cache_ts = time.time()
        return APIResponse.ok(data=result)
    except Exception as exc:
        logger.warning("allocation mc summary failed: %s", exc)
        return APIResponse.ok(data={"available": False, "rows": [], "error": str(exc)})
