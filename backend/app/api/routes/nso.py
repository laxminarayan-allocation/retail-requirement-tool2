"""
NSO Dashboard — New Store Opening performance tracker.

Data source priority:
  1. Parquet cache (CK_A2166__V_NSO.parquet) — instant, served in <50ms
  2. Oracle V_NSO view — slow (~3-5 min), writes parquet for future loads

Master data enrichment: merges STORE_MASTER_NSO parquet on store_name to
add region_type, store_tag, gm_grade, festival_grouping, bd_tier, asp_tier.
"""
import logging
import time
from typing import Optional

import pandas as pd
from fastapi import APIRouter, Query, HTTPException

from app.models.response_models import APIResponse
from app.db.connection import get_connection
from app.core.config import settings

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/nso", tags=["NSO Dashboard"])

_NSO_OWNER = "CK_A2166"
_NSO_VIEW  = "V_NSO"
_STR_OWNER = "CK_A2166"
_STR_TABLE = "STORE_MASTER_NSO"

# Extra columns pulled from STORE_MASTER_NSO and merged into V_NSO rows
_MASTER_COLS = [
    "store_name", "region_type", "store_tag", "gm_grade", "bd_tier",
    "asp_tier", "festival_grouping", "holi_group", "focus_store",
    "store_desc_filter", "dc_transit_days",
]


def _require_oracle():
    if not settings.is_oracle_configured:
        raise HTTPException(status_code=503, detail="Oracle not configured")


def _enrich(df: pd.DataFrame) -> pd.DataFrame:
    """Merge V_NSO rows with STORE_MASTER_NSO parquet for extra master fields."""
    try:
        from app.core.parquet_cache import has_output, read_cache
        if not has_output(_STR_OWNER, _STR_TABLE):
            return df
        sm = read_cache(_STR_OWNER, _STR_TABLE)
        if sm is None:
            return df
        # keep only extra cols not already in V_NSO
        merge_cols = [c for c in _MASTER_COLS if c in sm.columns and c not in df.columns or c == "store_name"]
        sm_sub = sm[list(dict.fromkeys(merge_cols))].drop_duplicates("store_name")
        merged = df.merge(sm_sub, on="store_name", how="left")
        return merged
    except Exception as e:
        logger.warning("NSO enrich failed (non-fatal): %s", e)
        return df


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/cache-status", response_model=APIResponse)
async def get_nso_cache_status():
    """Return whether the V_NSO Parquet cache is ready, and its row count."""
    _require_oracle()
    try:
        from app.core.parquet_cache import has_output, get_meta
        ready = has_output(_NSO_OWNER, _NSO_VIEW)
        meta  = get_meta(_NSO_OWNER, _NSO_VIEW) if ready else {}
        str_ready = has_output(_STR_OWNER, _STR_TABLE)
        return APIResponse.ok(data={
            "ready":          ready,
            "rows":           meta.get("rows", 0),
            "store_master_ready": str_ready,
            "source":         "parquet" if ready else "oracle_needed",
        })
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/data", response_model=APIResponse)
async def get_nso_data(
    attribute1:   Optional[str] = Query(None),
    store_status: Optional[str] = Query(None),
    division:     Optional[str] = Query(None),
    region_type:  Optional[str] = Query(None),
    cluster_type: Optional[str] = Query(None),
    store_tag:    Optional[str] = Query(None),
    store_search: Optional[str] = Query(None),
    force_refresh: bool         = Query(False),
    limit:         int          = Query(50000, ge=1, le=200000),
):
    """
    Return V_NSO rows enriched with STORE_MASTER_NSO master data.
    Reads ONLY from Parquet cache (downloaded via Master Data page).
    No direct Oracle fetch — refresh data from Master Data > V_NSO download.
    """
    _require_oracle()
    try:
        t0 = time.perf_counter()
        from app.core.parquet_cache import has_output, read_cache

        if not has_output(_NSO_OWNER, _NSO_VIEW):
            return APIResponse.fail(
                message="V_NSO parquet not found. Please download it from Master Data page first."
            )

        df = read_cache(_NSO_OWNER, _NSO_VIEW)
        if df is None:
            return APIResponse.fail(message="Cache read error — re-download V_NSO from Master Data page.")
        served_from = "parquet"

        # ── 3. Enrich with STORE_MASTER_NSO parquet ────────────────────────
        df = _enrich(df)

        # ── 4. Filter ──────────────────────────────────────────────────────
        mask = pd.Series([True] * len(df), index=df.index)

        def col(name: str):
            return next((c for c in df.columns if c.lower() == name.lower()), None)

        if attribute1:
            c = col("attribute1")
            if c: mask &= df[c].str.upper() == attribute1.upper()
        if store_status and store_status != "-":
            c = col("store_status")
            if c: mask &= df[c].str.upper() == store_status.upper()
        if division:
            c = col("division")
            if c: mask &= df[c].str.upper() == division.upper()
        if region_type:
            c = col("region_type")
            if c: mask &= df[c].str.upper() == region_type.upper()
        if cluster_type:
            c = col("cluster_type")
            if c: mask &= df[c].str.upper() == cluster_type.upper()
        if store_tag:
            c = col("store_tag")
            if c: mask &= df[c].str.upper() == store_tag.upper()
        if store_search:
            c = col("store_f_name") or col("store_name")
            if c: mask &= df[c].str.upper().str.contains(store_search.upper(), na=False)

        filtered = df[mask].head(limit)
        filtered = filtered.where(filtered.notna(), None)

        elapsed = round((time.perf_counter() - t0) * 1000, 1)
        return APIResponse.ok(data={
            "rows":         filtered.to_dict(orient="records"),
            "count":        len(filtered),
            "total_cached": len(df),
            "columns":      list(filtered.columns),
            "elapsed_ms":   elapsed,
            "served_from":  served_from,
        })

    except Exception as exc:
        logger.error("NSO data query failed: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/filters", response_model=APIResponse)
async def get_nso_filters():
    """
    Return distinct filter values — from parquet caches (instant, no Oracle scan).
    Includes V_NSO filters + extra master filters from STORE_MASTER_NSO.
    """
    _require_oracle()
    try:
        t0 = time.perf_counter()
        from app.core.parquet_cache import has_output, read_cache

        def uniq(df, col):
            c = next((x for x in df.columns if x.lower() == col.lower()), None)
            return sorted(df[c].dropna().unique().tolist()) if c else []

        attr1, division, store_status = [], [], ["ACTIVE", "UPCOMING_STORE"]
        cluster_type, region_type, store_tag = [], [], []

        # From V_NSO parquet (if ready)
        if has_output(_NSO_OWNER, _NSO_VIEW):
            df = read_cache(_NSO_OWNER, _NSO_VIEW)
            if df is not None:
                attr1        = uniq(df, "attribute1")
                division     = uniq(df, "division")
                store_status = uniq(df, "store_status")
                cluster_type = uniq(df, "cluster_type")
        else:
            # fallback: item_repository (in-memory)
            from app.repositories.item_repository import ItemRepository
            item_df = ItemRepository()._load()
            attr1    = uniq(item_df, "attribute1")
            division = uniq(item_df, "division")

        # From STORE_MASTER_NSO parquet — extra master filters
        if has_output(_STR_OWNER, _STR_TABLE):
            sm = read_cache(_STR_OWNER, _STR_TABLE)
            if sm is not None:
                region_type = uniq(sm, "region_type")
                store_tag   = uniq(sm, "store_tag")

        elapsed = round((time.perf_counter() - t0) * 1000, 1)
        return APIResponse.ok(data={
            "attribute1":   attr1,
            "store_status": store_status,
            "division":     division,
            "cluster_type": cluster_type,
            "region_type":  region_type,
            "store_tag":    store_tag,
            "elapsed_ms":   elapsed,
        })

    except Exception as exc:
        logger.error("NSO filters query failed: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/columns", response_model=APIResponse)
async def get_nso_columns():
    """Return V_NSO column names from the Oracle data dictionary."""
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
