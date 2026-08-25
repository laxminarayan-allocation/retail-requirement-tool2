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
from datetime import date
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
    source:        str          = Query("nso", description="'nso'=V_NSO, 'all'=V_ALL_WITH_NSO"),
    force_refresh: bool         = Query(False),
    limit:         int          = Query(50000, ge=1, le=200000),
):
    """
    Return V_NSO or V_ALL_WITH_NSO rows enriched with STORE_MASTER_NSO master data.
    source=nso  → V_NSO (NSO plan stores only)
    source=all  → V_ALL_WITH_NSO (all stores carrying NSO articles)
    """
    _require_oracle()
    view_name = _ALL_VIEW if source == "all" else _NSO_VIEW
    try:
        t0 = time.perf_counter()
        from app.core.parquet_cache import has_output, read_cache

        if not has_output(_NSO_OWNER, view_name):
            return APIResponse.fail(
                message=f"{view_name} parquet not found. Please download it from Master Data page first."
            )

        df = read_cache(_NSO_OWNER, view_name)
        if df is None:
            return APIResponse.fail(message=f"Cache read error — re-download {view_name} from Master Data page.")
        served_from = "parquet"

        # ── 3. Enrich with STORE_MASTER_NSO parquet ────────────────────────
        df = _enrich(df)

        # ── 4. Filter ──────────────────────────────────────────────────────
        mask = pd.Series([True] * len(df), index=df.index)

        def col(name: str):
            return next((c for c in df.columns if c.lower() == name.lower()), None)

        def _isin_mask(param, col_name):
            nonlocal mask
            if not param: return
            vals = [v.strip().upper() for v in param.split(',') if v.strip() and v.strip() != '-']
            c = col(col_name)
            if c and vals: mask &= df[c].str.upper().isin(vals)

        _isin_mask(attribute1,   "attribute1")
        _isin_mask(store_status, "store_status")
        _isin_mask(division,     "division")
        _isin_mask(region_type,  "region_type")
        _isin_mask(cluster_type, "cluster_type")
        _isin_mask(store_tag,    "store_tag")
        if store_search:
            c = col("store_f_name") or col("store_name")
            if c: mask &= df[c].str.upper().str.contains(store_search.upper(), na=False)

        filtered = df[mask].head(limit).copy()

        # Compute opert_days if not already present
        od_col = col("opening_date")
        if od_col and "opert_days" not in [c.lower() for c in filtered.columns]:
            today = pd.Timestamp(date.today())
            od = pd.to_datetime(filtered[od_col], errors="coerce")
            filtered["opert_days"] = (today - od).dt.days.clip(lower=0).fillna(0).astype(int)

        filtered = filtered.where(filtered.notna(), None)

        # Reorder: pin opert_days near front (after key identity columns)
        PIN_FIRST = ["store_f_name", "store_name", "store_status", "opening_date",
                     "opert_days", "division", "attribute1"]
        existing = list(filtered.columns)
        pinned = [c for c in PIN_FIRST if c in existing]
        rest   = [c for c in existing if c not in pinned]
        filtered = filtered[pinned + rest]

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


_ALL_VIEW = "V_ALL_WITH_NSO"

@router.get("/store-summary", response_model=APIResponse)
async def get_nso_store_summary(
    store_status: Optional[str] = Query(None),
    cluster_type: Optional[str] = Query(None),
    region_type:  Optional[str] = Query(None),
    store_tag:    Optional[str] = Query(None),
    source:       str           = Query("nso"),   # "nso" = V_NSO, "all" = V_ALL_WITH_NSO
    division:     Optional[str] = Query(None),   # comma-separated multi-values
    attribute1:   Optional[str] = Query(None),   # comma-separated multi-values
):
    """
    Return store-level NSO summary aggregated from V_NSO or V_ALL_WITH_NSO parquet.
    source=nso  → V_NSO (NSO plan stores only)
    source=all  → V_ALL_WITH_NSO (all stores carrying NSO articles)
    """
    _require_oracle()
    view_name = _ALL_VIEW if source == "all" else _NSO_VIEW
    try:
        t0 = time.perf_counter()
        from app.core.parquet_cache import has_output, read_cache

        if not has_output(_NSO_OWNER, view_name):
            return APIResponse.fail(
                message=f"{view_name} parquet not found. Please download it from Master Data page first."
            )

        df = read_cache(_NSO_OWNER, view_name)
        if df is None:
            return APIResponse.fail(message=f"Cache read error — re-download {view_name} from Master Data page.")

        df = _enrich(df)

        # Normalise column names to lowercase
        df.columns = [c.lower() for c in df.columns]

        def _col(name: str):
            return name if name in df.columns else None

        # Filters
        def _isin_filter(df, col_name, param):
            if not param: return df
            vals = [v.strip().upper() for v in param.split(',') if v.strip() and v.strip() != '-']
            c = _col(col_name)
            return df[df[c].str.upper().isin(vals)] if c and vals else df

        df = _isin_filter(df, "store_status", store_status)
        df = _isin_filter(df, "cluster_type", cluster_type)
        df = _isin_filter(df, "region_type",  region_type)
        df = _isin_filter(df, "store_tag",    store_tag)
        df = _isin_filter(df, "division",     division)
        df = _isin_filter(df, "attribute1",   attribute1)

        # Columns to aggregate — sums and firsts
        SUM_COLS   = [c for c in [
            'pbs_q', 'ttl_stk_q', 'pbs_v', 'ttl_stk_v',
            'in_transit_v', 'to_v', 'mtd_sl_v', 'lm_sl_val', 'lm_tgt_v', 'lm_sl_v',
            'tgt_v', 'sl_v', 'pack_pend_v', 'stk_v',
        ] if c in df.columns]
        FIRST_COLS = [c for c in [
            'opening_date', 'tentetive_date', 'store_status',
            'store_area', 'store_f_name', 'cluster_type',
            'region_type', 'store_tag',
        ] if c in df.columns]

        agg_dict = {c: 'sum' for c in SUM_COLS}
        agg_dict.update({c: 'first' for c in FIRST_COLS})

        grp = df.groupby('store_name', as_index=False).agg(agg_dict)

        # ── Unit normalisation ─────────────────────────────────────────────────
        # V_NSO mixes units: some value cols are in Rupees, others in Lakhs.
        # Rupees → Lakhs: divide by 100_000.
        # Lakhs already: pbs_v, sl_v, tgt_v, lm_sl_v, lm_tgt_v  (small numbers ~0-100)
        # Rupees:         ttl_stk_v, stk_v, to_v, mtd_sl_v, lm_sl_val, pack_pend_v
        RS_TO_L = 100_000
        for col in ['ttl_stk_v', 'stk_v', 'in_transit_v', 'to_v', 'mtd_sl_v', 'lm_sl_val', 'pack_pend_v']:
            if col in grp.columns:
                grp[col] = (grp[col] / RS_TO_L).round(4)

        # ── Derived metrics (all values now in Lakhs) ──────────────────────────
        today = pd.Timestamp(date.today())
        if 'opening_date' in grp.columns:
            od = pd.to_datetime(grp['opening_date'], errors='coerce')
            grp['opert_days'] = (today - od).dt.days.clip(lower=0).fillna(0).astype(int)
        else:
            grp['opert_days'] = 0

        # SL AVG/D = sl_v (lakhs) / opert_days
        if 'sl_v' in grp.columns:
            grp['sl_avg_d'] = grp.apply(
                lambda r: round(r['sl_v'] / r['opert_days'], 4) if r['opert_days'] > 0 else 0,
                axis=1,
            )
        else:
            grp['sl_avg_d'] = 0

        # ACH% = sl_v / tgt_v * 100  (both in Lakhs)
        if 'sl_v' in grp.columns and 'tgt_v' in grp.columns:
            grp['ach_pct'] = grp.apply(
                lambda r: round(r['sl_v'] / r['tgt_v'] * 100, 2) if r['tgt_v'] > 0 else 0,
                axis=1,
            )

        # ACH_LM% = lm_sl_v / lm_tgt_v * 100  (both in Lakhs)
        if 'lm_sl_v' in grp.columns and 'lm_tgt_v' in grp.columns:
            grp['ach_lm_pct'] = grp.apply(
                lambda r: round(r['lm_sl_v'] / r['lm_tgt_v'] * 100, 2) if r['lm_tgt_v'] > 0 else 0,
                axis=1,
            )

        # FILL RATE = ttl_stk_q / pbs_q * 100  (both qty in pieces)
        if 'ttl_stk_q' in grp.columns and 'pbs_q' in grp.columns:
            grp['fill_rate'] = grp.apply(
                lambda r: round(r['ttl_stk_q'] / r['pbs_q'] * 100, 2) if r['pbs_q'] > 0 else 0,
                axis=1,
            )

        # STR (days) = stk_v / (mtd_sl_v / store_mtd_days)
        # store_mtd_days = min(opert_days, days elapsed in current month)
        mtd_days_in_month = date.today().day - 1 or 1
        if 'stk_v' in grp.columns and 'mtd_sl_v' in grp.columns and 'opert_days' in grp.columns:
            def _str(r):
                store_mtd = min(int(r['opert_days'] or 0), mtd_days_in_month)
                return round(r['stk_v'] / (r['mtd_sl_v'] / store_mtd), 1) if store_mtd > 0 and r['mtd_sl_v'] > 0 else 0
            grp['str_days'] = grp.apply(_str, axis=1)

        # Sort: ACTIVE first (opening_date asc), then UPCOMING (tentetive_date asc)
        if 'store_status' in grp.columns:
            grp['_sort_status'] = grp['store_status'].str.upper().map(
                lambda s: 0 if s == 'ACTIVE' else 1
            )
            if 'opening_date' in grp.columns:
                grp['_sort_date'] = pd.to_datetime(
                    grp.apply(
                        lambda r: r['opening_date'] if r['_sort_status'] == 0 else r.get('tentetive_date', None),
                        axis=1,
                    ), errors='coerce'
                )
            grp = grp.sort_values(['_sort_status', '_sort_date']).drop(columns=['_sort_status', '_sort_date'], errors='ignore')

        grp = grp.where(grp.notna(), None)
        elapsed = round((time.perf_counter() - t0) * 1000, 1)
        return APIResponse.ok(data={
            "stores": grp.to_dict(orient="records"),
            "count":  len(grp),
            "source": source,
            "view":   view_name,
            "elapsed_ms": elapsed,
        })

    except Exception as exc:
        logger.error("NSO store-summary failed: %s", exc)
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
