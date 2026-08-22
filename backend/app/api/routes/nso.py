"""
NSO Dashboard — New Store Opening performance tracker.

Queries V_NSO (Oracle view) with optional filters.
All queries are parameterized — no raw string interpolation of user input.
"""
import logging
import time
from typing import Optional

from fastapi import APIRouter, Query, HTTPException

from app.models.response_models import APIResponse
from app.db.connection import get_connection
from app.core.config import settings

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/nso", tags=["NSO Dashboard"])


def _require_oracle():
    if not settings.is_oracle_configured:
        raise HTTPException(status_code=503, detail="Oracle not configured")


def _col_names(cursor) -> list[str]:
    """Extract column names from cursor description."""
    return [d[0].upper() for d in cursor.description]


_NSO_OWNER = "CK_A2166"
_NSO_VIEW  = "V_NSO"


@router.get("/data", response_model=APIResponse)
async def get_nso_data(
    attribute1: Optional[str] = Query(None),
    store_status: Optional[str] = Query(None),
    division: Optional[str] = Query(None),
    force_refresh: bool = Query(False),
    limit: int = Query(5000, ge=1, le=50000),
):
    """
    Return rows from V_NSO.

    V_NSO is a complex view — querying it live is very slow.
    On first call (or force_refresh=true) we fetch the full view into a
    Parquet cache (same mechanism the DB Explorer uses), then filter/serve
    from the cache on every subsequent call.  First-fetch can take a few
    minutes; subsequent calls are instant.
    """
    _require_oracle()
    try:
        t0 = time.perf_counter()
        from app.core.parquet_cache import has_output, read_cache, write_cache, get_meta
        from app.repositories.base_repository import fetch_df
        import pandas as pd

        # ── 1. Serve from cache if available ──────────────────────────────
        if not force_refresh and has_output(_NSO_OWNER, _NSO_VIEW):
            df = read_cache(_NSO_OWNER, _NSO_VIEW)
            if df is None:
                return APIResponse.fail(message="Cache read error — try ?force_refresh=true")
            served_from = "cache"
        else:
            # ── 2. Full fetch — may take several minutes ───────────────────
            logger.info("NSO: fetching full V_NSO from Oracle (first load / refresh)")
            sql = f'SELECT * FROM "{_NSO_OWNER}"."{_NSO_VIEW}"'
            with get_connection() as conn:
                df = fetch_df(conn, sql, label="V_NSO_full")
            write_cache(_NSO_OWNER, _NSO_VIEW, df)
            served_from = "oracle"
            logger.info("NSO: cached %d rows", len(df))

        # ── 3. Filter in-memory (pandas — instant) ────────────────────────
        mask = pd.Series([True] * len(df), index=df.index)
        if attribute1:
            col = next((c for c in df.columns if c.upper() == "ATTRIBUTE1"), None)
            if col:
                mask &= df[col].str.upper() == attribute1.upper()
        if store_status and store_status != "-":
            col = next((c for c in df.columns if c.upper() == "STORE_STATUS"), None)
            if col:
                mask &= df[col] == store_status
        if division:
            col = next((c for c in df.columns if c.upper() == "DIVISION"), None)
            if col:
                mask &= df[col].str.upper() == division.upper()

        filtered = df[mask].head(limit)
        filtered = filtered.where(filtered.notna(), None)
        rows = filtered.to_dict(orient="records")
        cols = list(df.columns)

        elapsed = round((time.perf_counter() - t0) * 1000, 1)
        return APIResponse.ok(data={
            "rows": rows,
            "count": len(rows),
            "total_cached": len(df),
            "columns": cols,
            "elapsed_ms": elapsed,
            "served_from": served_from,
        })

    except Exception as exc:
        logger.error("NSO data query failed: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/columns", response_model=APIResponse)
async def get_nso_columns():
    """Return V_NSO column names from the Oracle data dictionary (fast — no table scan)."""
    _require_oracle()
    try:
        t0 = time.perf_counter()
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT column_name, data_type FROM all_tab_columns "
                    "WHERE owner = 'CK_A2166' AND table_name = 'V_NSO' "
                    "ORDER BY column_id"
                )
                cols = [{"name": r[0], "type": r[1]} for r in cur.fetchall()]
        elapsed = round((time.perf_counter() - t0) * 1000, 1)
        return APIResponse.ok(data={"columns": cols, "elapsed_ms": elapsed})
    except Exception as exc:
        logger.error("NSO columns query failed: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/filters", response_model=APIResponse)
async def get_nso_filters():
    """
    Return distinct filter values using the in-memory item/store caches — instant, no Oracle scan.
    """
    _require_oracle()
    try:
        t0 = time.perf_counter()
        from app.repositories.item_repository import ItemRepository
        from app.repositories.store_repository import StoreRepository

        item_repo = ItemRepository()
        store_repo = StoreRepository()

        item_df = item_repo._load()
        store_df = store_repo.get_all_stores(active_only=False)

        attr1 = sorted(item_df["attribute1"].dropna().unique().tolist()) if "attribute1" in item_df.columns else []
        division = sorted(item_df["division"].dropna().unique().tolist()) if "division" in item_df.columns else []

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
            store_status = ["ACTIVE", "UPCOMING_STORE"]

        elapsed = round((time.perf_counter() - t0) * 1000, 1)
        return APIResponse.ok(data={
            "attribute1": attr1,
            "store_status": store_status,
            "division": division,
            "elapsed_ms": elapsed,
        })

    except Exception as exc:
        logger.error("NSO filters query failed: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))
