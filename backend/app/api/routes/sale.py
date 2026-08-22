"""
Store-wise Sale Dashboard — TY vs LY comparison from Oracle views.

These views are complex season-period aggregates — full Oracle fetch can take
10–15 minutes.  We run the fetch in a background thread so the client is never
blocked.  The frontend polls /api/sale/cache-status until ready, then calls
/api/sale/data for instant pandas-filtered results from the Parquet cache.

Note: No SALE_DATE / DAY column in these views — TY vs LY comparison via
SL_V / LM_SL_V columns only.
"""
import logging
import threading
import time
from typing import Optional

from fastapi import APIRouter, Query, HTTPException

from app.models.response_models import APIResponse
from app.db.connection import get_connection
from app.core.config import settings

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/sale", tags=["Sale Dashboard"])

_SALE_OWNER = "MISRETAIL"
_SALE_VIEW  = "V_COMPARE_TY_LY_LLY_CONSO"

# ── Background fetch state ────────────────────────────────────────────────────
_fetch_lock   = threading.Lock()
_fetch_active = False   # True while Oracle thread is running
_fetch_error  = ""      # last error message if thread failed

_ALLOWED_VIEWS = {
    "V_COMPARE_TY_LY_LLY_CONSO",
    "V_SALE_COMPARE_CONSOLIDATED",
    "V_STORE_WISE_DAY_SALE",
    "V_STORE_WISE_DAY_SALE_V1",
    "V_COMPARE_TY_LY_LLY_DAY_WISE",
    "V_DAILY_SALE_AMT_TY_LY",
    "V_DAILY_SALE_FINAL_OUTPUT",
}


def _require_oracle():
    if not settings.is_oracle_configured:
        raise HTTPException(status_code=503, detail="Oracle not configured")


def _do_background_fetch(owner: str, view_name: str) -> None:
    """Runs in a daemon thread — fetches full Oracle view into Parquet cache."""
    global _fetch_active, _fetch_error
    try:
        from app.core.parquet_cache import write_cache
        from app.repositories.base_repository import fetch_df
        logger.info("SALE BG: starting full fetch of %s.%s", owner, view_name)
        t0 = time.perf_counter()
        sql = f'SELECT * FROM "{owner}"."{view_name}"'
        with get_connection() as conn:
            df = fetch_df(conn, sql, label=f"SALE_{view_name}")
        write_cache(owner, view_name, df)
        elapsed = round((time.perf_counter() - t0))
        _fetch_error = ""
        logger.info("SALE BG: cached %d rows for %s in %ds", len(df), view_name, elapsed)
    except Exception as exc:
        _fetch_error = str(exc)
        logger.error("SALE BG: fetch failed for %s: %s", view_name, exc)
    finally:
        with _fetch_lock:
            _fetch_active = False


def _start_fetch_if_idle(owner: str, view_name: str) -> bool:
    """Starts background thread if one is not already running. Returns True if started."""
    global _fetch_active
    with _fetch_lock:
        if _fetch_active:
            return False
        _fetch_active = True
    t = threading.Thread(target=_do_background_fetch, args=(owner, view_name),
                         daemon=True, name=f"sale-fetch-{view_name}")
    t.start()
    return True


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/cache-status", response_model=APIResponse)
async def get_cache_status(view_name: str = Query(_SALE_VIEW)):
    """
    Poll this endpoint to check if the Parquet cache is ready.
    Returns {ready: bool, fetching: bool, error: str, rows: int}.
    """
    _require_oracle()
    if view_name not in _ALLOWED_VIEWS:
        raise HTTPException(status_code=400, detail=f"Unknown view: {view_name}")
    try:
        from app.core.parquet_cache import has_output, get_meta
        ready = has_output(_SALE_OWNER, view_name)
        meta  = get_meta(_SALE_OWNER, view_name) if ready else None
        return APIResponse.ok(data={
            "ready":    ready,
            "fetching": _fetch_active,
            "error":    _fetch_error,
            "rows":     meta.get("rows", 0) if meta else 0,
            "view":     view_name,
        })
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/data", response_model=APIResponse)
async def get_sale_data(
    attribute1:    Optional[str] = Query(None),
    cluster_type:  Optional[str] = Query(None),
    district:      Optional[str] = Query(None),
    store_status:  Optional[str] = Query(None),
    division:      Optional[str] = Query(None),
    store_search:  Optional[str] = Query(None),
    view_name:     str            = Query(_SALE_VIEW),
    force_refresh: bool           = Query(False),
    limit:         int            = Query(10000, ge=1, le=100000),
):
    """
    Return filtered rows from the sale comparison view.

    If the Parquet cache is not ready:
    - Starts a background thread to fetch from Oracle (may take 10–15 min)
    - Returns {loading: true} immediately — poll /api/sale/cache-status

    Once cached, filters and serves in-memory via pandas (instant).
    Force_refresh=true re-fetches from Oracle and rebuilds the cache.
    """
    _require_oracle()
    if view_name not in _ALLOWED_VIEWS:
        raise HTTPException(status_code=400, detail=f"Unknown view: {view_name}")

    try:
        t0 = time.perf_counter()
        from app.core.parquet_cache import has_output, read_cache, write_cache
        import pandas as pd

        # ── Handle force_refresh ───────────────────────────────────────────
        if force_refresh:
            started = _start_fetch_if_idle(_SALE_OWNER, view_name)
            return APIResponse.ok(data={
                "loading": True,
                "fetching": True,
                "message": "Oracle refresh started in background — poll /api/sale/cache-status",
                "started_new": started,
            })

        # ── Serve from cache if ready ──────────────────────────────────────
        if has_output(_SALE_OWNER, view_name):
            df = read_cache(_SALE_OWNER, view_name)
            if df is None:
                return APIResponse.fail(message="Cache read error — try force_refresh=true")

            mask = pd.Series([True] * len(df), index=df.index)

            def col(name: str):
                return next((c for c in df.columns if c.upper() == name.upper()), None)

            if attribute1:
                c = col("ATTRIBUTE1")
                if c: mask &= df[c].str.upper() == attribute1.upper()
            if cluster_type:
                c = col("CLUSTER_TYPE")
                if c: mask &= df[c].str.upper() == cluster_type.upper()
            if district:
                c = col("DISTRICT")
                if c: mask &= df[c].str.upper() == district.upper()
            if store_status and store_status != "-":
                c = col("STORE_STATUS")
                if c: mask &= df[c] == store_status
            if division:
                c = col("DIVISION")
                if c: mask &= df[c].str.upper() == division.upper()
            if store_search:
                c = col("STORE_NAME")
                if c: mask &= df[c].str.upper().str.contains(store_search.upper(), na=False)

            filtered = df[mask].head(limit)
            filtered = filtered.where(filtered.notna(), None)
            elapsed  = round((time.perf_counter() - t0) * 1000, 1)
            return APIResponse.ok(data={
                "rows":         filtered.to_dict(orient="records"),
                "count":        len(filtered),
                "total_cached": len(df),
                "columns":      list(df.columns),
                "elapsed_ms":   elapsed,
                "served_from":  "cache",
                "loading":      False,
                "view":         view_name,
            })

        # ── Cache not ready — start background fetch ───────────────────────
        started = _start_fetch_if_idle(_SALE_OWNER, view_name)
        return APIResponse.ok(data={
            "loading":     True,
            "fetching":    True,
            "started_new": started,
            "message":     "Fetching from Oracle in background (10–15 min first load). Poll /api/sale/cache-status for progress.",
            "rows":        [],
            "count":       0,
        })

    except Exception as exc:
        logger.error("SALE data query failed: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/filters", response_model=APIResponse)
async def get_sale_filters():
    """
    Return distinct filter values from in-memory item/store caches — instant.
    """
    _require_oracle()
    try:
        t0 = time.perf_counter()
        from app.repositories.item_repository import ItemRepository
        from app.repositories.store_repository import StoreRepository

        item_df  = ItemRepository()._load()
        store_df = StoreRepository().get_all_stores(active_only=False)

        def uniq(df, col):
            if col in df.columns:
                return sorted(df[col].dropna().unique().tolist())
            return []

        attr1    = uniq(item_df,  "attribute1")
        division = uniq(item_df,  "division")
        cluster  = uniq(store_df, "cluster_type")
        district = uniq(store_df, "district")

        store_status: list = []
        try:
            with get_connection() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        "SELECT DISTINCT STORE_STATUS FROM MISRETAIL.T_STORE_OPENING_DATE "
                        "WHERE STORE_STATUS IS NOT NULL ORDER BY STORE_STATUS"
                    )
                    store_status = [r[0] for r in cur.fetchall()]
        except Exception:
            store_status = ["ACTIVE", "INACTIVE"]

        elapsed = round((time.perf_counter() - t0) * 1000, 1)
        return APIResponse.ok(data={
            "attribute1":   attr1,
            "division":     division,
            "cluster_type": cluster,
            "district":     district,
            "store_status": store_status,
            "elapsed_ms":   elapsed,
        })

    except Exception as exc:
        logger.error("SALE filters query failed: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))
