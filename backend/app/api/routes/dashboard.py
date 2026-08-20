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
            item_df  = f_items.result(timeout=25)
            store_df = f_stores.result(timeout=25)
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

        # Upcoming stores live in MISRETAIL.T_STORE_OPENING_DATE, not V_STORE_MASTER
        upcoming_stores = 0
        try:
            from app.db.connection import get_connection
            with get_connection() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        "SELECT COUNT(*) FROM MISRETAIL.T_STORE_OPENING_DATE WHERE STORE_STATUS = 'UPCOMING_STORE'"
                    )
                    row = cur.fetchone()
                    upcoming_stores = int(row[0]) if row else 0
        except Exception as exc:
            logger.warning("upcoming store count query failed: %s", exc)

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
