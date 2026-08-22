"""
Store-wise Sale Dashboard — TY vs LY comparison from Oracle views.

Queries V_COMPARE_TY_LY_LLY_CONSO (or any of the 5 sale views) using the
same Parquet cache pattern as NSO — full fetch once, pandas filter on
subsequent calls.

Note: These views are season-period aggregates (no SALE_DATE / DAY column).
TY vs LY comparison is via SL_V / LM_SL_V columns.
"""
import logging
import time
from typing import Optional

from fastapi import APIRouter, Query, HTTPException

from app.models.response_models import APIResponse
from app.db.connection import get_connection
from app.core.config import settings

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/sale", tags=["Sale Dashboard"])

_SALE_OWNER = "CK_A2166"
_SALE_VIEW  = "V_COMPARE_TY_LY_LLY_CONSO"


def _require_oracle():
    if not settings.is_oracle_configured:
        raise HTTPException(status_code=503, detail="Oracle not configured")


@router.get("/data", response_model=APIResponse)
async def get_sale_data(
    attribute1:   Optional[str] = Query(None),
    cluster_type: Optional[str] = Query(None),
    district:     Optional[str] = Query(None),
    store_status: Optional[str] = Query(None),
    division:     Optional[str] = Query(None),
    store_search: Optional[str] = Query(None),
    view_name:    str            = Query(_SALE_VIEW),
    force_refresh: bool          = Query(False),
    limit:        int            = Query(10000, ge=1, le=100000),
):
    """
    Return rows from the sale comparison view.

    First call (or force_refresh=true) fetches the full view from Oracle into
    Parquet cache.  Subsequent calls filter in-memory via pandas — instant.
    """
    _require_oracle()
    # Only allow known safe view names — never interpolate raw user input
    _ALLOWED_VIEWS = {
        "V_COMPARE_TY_LY_LLY_CONSO",
        "V_SALE_COMPARE_CONSOLIDATED",
        "V_ACTIVE_STORE_COMPARISION",
        "V_STORE_WISE_DAY_SALE",
        "V_STORE_WISE_DAY_SALE_V1",
    }
    if view_name not in _ALLOWED_VIEWS:
        raise HTTPException(status_code=400, detail=f"Unknown view: {view_name}")

    try:
        t0 = time.perf_counter()
        from app.core.parquet_cache import has_output, read_cache, write_cache
        from app.repositories.base_repository import fetch_df
        import pandas as pd

        if not force_refresh and has_output(_SALE_OWNER, view_name):
            df = read_cache(_SALE_OWNER, view_name)
            if df is None:
                return APIResponse.fail(message="Cache read error — try ?force_refresh=true")
            served_from = "cache"
        else:
            logger.info("SALE: fetching full %s from Oracle", view_name)
            sql = f'SELECT * FROM "{_SALE_OWNER}"."{view_name}"'
            with get_connection() as conn:
                df = fetch_df(conn, sql, label=f"SALE_{view_name}")
            write_cache(_SALE_OWNER, view_name, df)
            served_from = "oracle"
            logger.info("SALE: cached %d rows for %s", len(df), view_name)

        # ── Filter in-memory (pandas) ──────────────────────────────────────
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
        rows = filtered.to_dict(orient="records")

        elapsed = round((time.perf_counter() - t0) * 1000, 1)
        return APIResponse.ok(data={
            "rows": rows,
            "count": len(rows),
            "total_cached": len(df),
            "columns": list(df.columns),
            "elapsed_ms": elapsed,
            "served_from": served_from,
            "view": view_name,
        })

    except Exception as exc:
        logger.error("SALE data query failed: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/filters", response_model=APIResponse)
async def get_sale_filters():
    """
    Return distinct filter values — sourced from in-memory item/store caches,
    not from a live Oracle scan.
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

        # cluster_type / district / store_status from store repo
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
