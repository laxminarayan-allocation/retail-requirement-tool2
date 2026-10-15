"""
Distribution Model API — replenishment distribution engine.

Steps:
  1. V_ITEM_MASTER cache (icode → option_level, allocation_option, sz_grp)
  2. Build joined base dataset (Barcode × Store × all REQ views)
  3. Sorting + distribution loop (min_grid → max_grid)
"""
import io
import logging
import math
import time
from typing import Optional

import numpy as np
import pandas as pd
from fastapi import APIRouter, File, HTTPException, UploadFile

from app.models.calculation_models import DistributeRequest, HoldRule
from app.models.response_models import APIResponse
from app.core.config import settings
from app.core.parquet_cache import has_output, read_cache, write_cache, get_meta

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/distribution", tags=["Distribution Model"])

# In-memory cache for last distribution result (avoids re-running loop on export)
_last_dist_result: Optional[pd.DataFrame] = None
_last_dist_params: dict = {}

# ── Uploaded stock CSV (barcode-level qty override) ───────────────────────────
_uploaded_stock_df: Optional[pd.DataFrame] = None
_uploaded_stock_meta: dict = {}   # {filename, rows, qty_col}


@router.post("/upload-stock-csv", response_model=APIResponse)
async def upload_stock_csv(file: UploadFile = File(...)):
    """
    Accept a CSV with BARCODE + one qty column (GRC_QTY / MSA_QTY / WMS_QTY / ASN_QTY).
    Stores it in memory; subsequent /build-base calls use it as the stock source.
    """
    global _uploaded_stock_df, _uploaded_stock_meta
    try:
        content = await file.read()
        df = pd.read_csv(io.BytesIO(content))
        df.columns = [c.strip().upper() for c in df.columns]

        # Find BARCODE / ICODE column
        bc_col = next((c for c in df.columns if c in ("BARCODE", "ICODE", "BAR_CODE")), None)
        if bc_col is None:
            return APIResponse.fail(message="CSV must have a BARCODE (or ICODE) column.")

        # Find qty column
        qty_candidates = [c for c in df.columns if any(k in c for k in ("GRC_QTY", "MSA_QTY", "WMS_QTY", "ASN_QTY", "QTY", "STOCK", "GRC_Q", "WMS_Q"))]
        if not qty_candidates:
            return APIResponse.fail(message="CSV must have a qty column (e.g. GRC_QTY, WMS_QTY, MSA_QTY, ASN_QTY).")
        qty_col = qty_candidates[0]

        out = df[[bc_col, qty_col]].copy()
        out.columns = ["icode", "wh_q"]
        out["icode"] = out["icode"].astype(str).str.strip()
        out["wh_q"]  = pd.to_numeric(out["wh_q"], errors="coerce").fillna(0).astype(int)
        out = out[out["icode"].str.len() > 0]

        _uploaded_stock_df = out
        _uploaded_stock_meta = {"filename": file.filename, "rows": len(out), "qty_col": qty_col}
        return APIResponse.ok(data=_uploaded_stock_meta, message=f"Uploaded {len(out):,} barcode rows from '{qty_col}'")
    except Exception as exc:
        logger.error("upload_stock_csv: %s", exc)
        return APIResponse.fail(message=str(exc))


@router.delete("/upload-stock-csv", response_model=APIResponse)
async def clear_stock_csv():
    """Clear the uploaded stock CSV override."""
    global _uploaded_stock_df, _uploaded_stock_meta
    _uploaded_stock_df = None
    _uploaded_stock_meta = {}
    return APIResponse.ok(message="Uploaded stock CSV cleared.")


@router.get("/upload-stock-csv/status", response_model=APIResponse)
async def stock_csv_status():
    """Return whether an uploaded stock CSV is active."""
    return APIResponse.ok(data={"active": _uploaded_stock_df is not None, **_uploaded_stock_meta})


# ── Uploaded REQ CSVs (barcode-store req + MC/ART/MRP/SIZE req overrides) ────
# Each entry: key → {df, meta}
_uploaded_req: dict = {}   # key: "barcode" | "mc" | "art" | "mrp" | "size"

_REQ_UPLOAD_SPECS = {
    "barcode": {
        "label": "Barcode × Store REQ",
        "required_cols": ["ICODE", "STORE_NAME", "REQ"],
        "aliases": {"BARCODE": "ICODE", "BAR_CODE": "ICODE", "STORE": "STORE_NAME"},
        "key_cols": ["icode", "store_name"],
        "val_col": "req",
    },
    "mc": {
        "label": "MC REQ",
        "required_cols": ["DEPARTMENT", "DISPLAY_TYPE", "STORE_NAME", "REQ"],
        "aliases": {"STORE": "STORE_NAME", "DEPT": "DEPARTMENT", "DISPLAY": "DISPLAY_TYPE"},
        "key_cols": ["department", "display_type", "store_name"],
        "val_col": "req",
    },
    "art": {
        "label": "ART REQ",
        "required_cols": ["DEPARTMENT", "DISPLAY_TYPE", "ARTICLE_NAME", "STORE_NAME", "REQ"],
        "aliases": {"STORE": "STORE_NAME", "DEPT": "DEPARTMENT", "ARTICLE": "ARTICLE_NAME"},
        "key_cols": ["department", "display_type", "article_name", "store_name"],
        "val_col": "req",
    },
    "mrp": {
        "label": "MRP REQ",
        "required_cols": ["DEPARTMENT", "DISPLAY_TYPE", "ARTICLE_NAME", "MRP", "STORE_NAME", "REQ"],
        "aliases": {"STORE": "STORE_NAME", "DEPT": "DEPARTMENT", "ARTICLE": "ARTICLE_NAME"},
        "key_cols": ["department", "display_type", "article_name", "mrp", "store_name"],
        "val_col": "req",
    },
    "size": {
        "label": "SIZE REQ",
        "required_cols": ["DEPARTMENT", "DISPLAY_TYPE", "ARTICLE_NAME", "CAT4", "STORE_NAME", "SZ_REQ"],
        "aliases": {"STORE": "STORE_NAME", "DEPT": "DEPARTMENT", "ARTICLE": "ARTICLE_NAME", "SIZE": "CAT4", "REQ": "SZ_REQ"},
        "key_cols": ["department", "display_type", "article_name", "cat4", "store_name"],
        "val_col": "sz_req",
    },
}


@router.post("/upload-req-csv/{req_type}", response_model=APIResponse)
async def upload_req_csv(req_type: str, file: UploadFile = File(...)):
    """Upload a REQ CSV override. req_type: barcode | mc | art | mrp | size"""
    global _uploaded_req
    spec = _REQ_UPLOAD_SPECS.get(req_type)
    if spec is None:
        return APIResponse.fail(message=f"Unknown req_type '{req_type}'. Use: {list(_REQ_UPLOAD_SPECS)}")
    try:
        content = await file.read()
        df = pd.read_csv(io.BytesIO(content))
        df.columns = [c.strip().upper() for c in df.columns]
        # Apply aliases
        df.rename(columns=spec["aliases"], inplace=True)
        # Check required cols
        missing = [c for c in spec["required_cols"] if c not in df.columns]
        if missing:
            return APIResponse.fail(message=f"CSV missing columns: {missing}. Have: {list(df.columns)}")
        # Keep only needed cols, lowercase
        keep = list(dict.fromkeys([c for c in spec["required_cols"] if c in df.columns]))
        out = df[keep].copy()
        out.columns = [c.lower() for c in out.columns]
        out[spec["val_col"]] = pd.to_numeric(out[spec["val_col"]], errors="coerce").fillna(0)
        # Drop all-zero rows
        out = out[out[spec["val_col"]] > 0]
        meta = {"filename": file.filename, "rows": len(out), "label": spec["label"]}
        _uploaded_req[req_type] = {"df": out, "meta": meta}
        return APIResponse.ok(data=meta, message=f"Uploaded {len(out):,} rows for {spec['label']}")
    except Exception as exc:
        logger.error("upload_req_csv[%s]: %s", req_type, exc)
        return APIResponse.fail(message=str(exc))


@router.delete("/upload-req-csv/{req_type}", response_model=APIResponse)
async def clear_req_csv(req_type: str):
    global _uploaded_req
    _uploaded_req.pop(req_type, None)
    return APIResponse.ok(message=f"Cleared {req_type} REQ CSV.")


@router.get("/upload-req-csv/status", response_model=APIResponse)
async def req_csv_status():
    return APIResponse.ok(data={k: v["meta"] for k, v in _uploaded_req.items()})


# ── Constants ──────────────────────────────────────────────────────────────────
_IM_OWNER = "REPORT"
_IM_OBJ   = "V_ITEM_MASTER"

_ITEM_MASTER_SQL = """
SELECT DISTINCT
    ICODE,
    OPTION_LEVEL,
    ALLOCATION_OPTION,
    SZ_GRP,
    ATTRIBUTE1,
    CONCEPT_NEW
FROM REPORT.V_ITEM_MASTER
WHERE ICODE IS NOT NULL
"""


def _require_oracle():
    if not settings.is_oracle_configured:
        raise HTTPException(status_code=503, detail="Oracle not configured")


# ── Store list from T_STORE_OPENING_DATE ──────────────────────────────────────

_store_list_cache: list = []

@router.get("/store-list", response_model=APIResponse)
async def distribution_store_list():
    """Return all store names from cached GRC/WMS parquets (includes all stores in REQ data)."""
    global _store_list_cache
    if _store_list_cache:
        return APIResponse.ok(data={"stores": _store_list_cache})
    try:
        stores = set()
        for obj in ["V_BARCODE_REQ_APPS_GRC_V2", "V_BARCODE_REQ_APPS_WMS_V2"]:
            df = _load("CK_A2166", obj)
            if df is not None and "store_name" in df.columns:
                stores.update(df["store_name"].dropna().str.strip().unique().tolist())
            elif df is not None:
                # lowercase columns
                df.columns = [c.lower() for c in df.columns]
                if "store_name" in df.columns:
                    stores.update(df["store_name"].dropna().str.strip().unique().tolist())
        if stores:
            _store_list_cache = sorted(stores)
            return APIResponse.ok(data={"stores": _store_list_cache})
        # fallback: V_STORE_MASTER
        from app.repositories.store_repository import StoreRepository
        sm = StoreRepository().get_all_stores(active_only=False)
        names = sm["store_name"].dropna().str.strip().tolist() if "store_name" in sm.columns else []
        _store_list_cache = sorted(set(names))
        return APIResponse.ok(data={"stores": _store_list_cache})
    except Exception as exc:
        logger.error("distribution_store_list: %s", exc)
        return APIResponse.fail(message=str(exc))


# ── Store master field filter meta ────────────────────────────────────────────

_STORE_FILTER_META_CACHE: dict = {}

# Fields exposed as filterable (col_name → display label)
_STORE_FILTER_FIELDS = {
    "zone":         "Zone",
    "city":         "City",
    "state_name":   "State",
    "cluster_type": "Cluster",
    "store_grade":  "Store Grade",
    "gm_grd":       "GM Grade",
    "store_type":   "Store Type",
    "store_tag":    "Store Tag",
    "store_status": "Status",
}

@router.get("/store-filter-meta", response_model=APIResponse)
async def store_filter_meta():
    """Return unique values for each filterable store master field."""
    global _STORE_FILTER_META_CACHE
    if _STORE_FILTER_META_CACHE:
        return APIResponse.ok(data=_STORE_FILTER_META_CACHE)
    try:
        from app.repositories.store_repository import StoreRepository
        df = StoreRepository().get_all_stores(active_only=False)
        df.columns = [c.lower() for c in df.columns]
        result = {"fields": {}}
        for col, label in _STORE_FILTER_FIELDS.items():
            if col in df.columns:
                vals = sorted(df[col].dropna().astype(str).str.strip().unique().tolist())
                vals = [v for v in vals if v and v != "nan"]
                result["fields"][col] = {"label": label, "values": vals}
        _STORE_FILTER_META_CACHE = result
        return APIResponse.ok(data=result)
    except Exception as exc:
        logger.error("store_filter_meta: %s", exc)
        return APIResponse.fail(message=str(exc))


# ── V_ITEM_MASTER endpoints ────────────────────────────────────────────────────

@router.get("/item-master/status", response_model=APIResponse)
async def item_master_status():
    """Return cache status of REPORT.V_ITEM_MASTER parquet."""
    _require_oracle()
    try:
        ready = has_output(_IM_OWNER, _IM_OBJ)
        meta  = get_meta(_IM_OWNER, _IM_OBJ) if ready else {}
        return APIResponse.ok(data={
            "ready":      ready,
            "rows":       meta.get("rows", 0),
            "cached_at":  meta.get("cached_at"),
            "source":     "parquet" if ready else "oracle_needed",
        })
    except Exception as exc:
        logger.error("item_master_status: %s", exc)
        return APIResponse.fail(message=str(exc))


@router.post("/item-master/download", response_model=APIResponse)
async def download_item_master():
    """Fetch REPORT.V_ITEM_MASTER from Oracle and cache to parquet."""
    _require_oracle()
    try:
        from app.db.oracle import get_pool
        t0 = time.perf_counter()
        pool = get_pool()
        with pool.acquire() as conn:
            with conn.cursor() as cur:
                cur.execute(_ITEM_MASTER_SQL)
                cols = [c[0].lower() for c in cur.description]
                rows = cur.fetchall()
        df = pd.DataFrame(rows, columns=cols)
        write_cache(_IM_OWNER, _IM_OBJ, df)
        elapsed = round((time.perf_counter() - t0) * 1000, 1)
        logger.info("item_master download: %d rows in %.0fms", len(df), elapsed)
        return APIResponse.ok(data={
            "rows":       len(df),
            "elapsed_ms": elapsed,
            "columns":    list(df.columns),
        })
    except Exception as exc:
        logger.exception("item_master download error")
        return APIResponse.fail(message=str(exc))


# ── Option Listing (T_CLR_CONCEPT_AW26_V1) endpoints ──────────────────────────

_OL_OWNER = "REPORT"
_OL_OBJ   = "T_CLR_CONCEPT_AW26_V1"
_OL_ATTR1_SCOPE = {"LT WINTER", "PREWINTER"}

_OL_SQL = """
SELECT DISTINCT STORE, CONCEPT_NEW, LIST_TAG
FROM REPORT.T_CLR_CONCEPT_AW26_V1
WHERE LIST_TAG IS NOT NULL
"""


@router.get("/option-listing/status", response_model=APIResponse)
async def option_listing_status():
    """Return cache status of REPORT.T_CLR_CONCEPT_AW26_V1 parquet."""
    _require_oracle()
    try:
        ready = has_output(_OL_OWNER, _OL_OBJ)
        meta  = get_meta(_OL_OWNER, _OL_OBJ) if ready else {}
        return APIResponse.ok(data={
            "ready":     ready,
            "rows":      meta.get("rows", 0),
            "cached_at": meta.get("cached_at"),
        })
    except Exception as exc:
        logger.error("option_listing_status: %s", exc)
        return APIResponse.fail(message=str(exc))


@router.post("/option-listing/download", response_model=APIResponse)
async def download_option_listing():
    """Fetch REPORT.T_CLR_CONCEPT_AW26_V1 from Oracle and cache to parquet."""
    _require_oracle()
    try:
        from app.db.oracle import get_pool
        t0 = time.perf_counter()
        pool = get_pool()
        with pool.acquire() as conn:
            with conn.cursor() as cur:
                cur.execute(_OL_SQL)
                cols = [c[0].lower() for c in cur.description]
                rows = cur.fetchall()
        df = pd.DataFrame(rows, columns=cols)
        write_cache(_OL_OWNER, _OL_OBJ, df)
        elapsed = round((time.perf_counter() - t0) * 1000, 1)
        yes_count = int((df["list_tag"].str.upper() == "YES").sum()) if "list_tag" in df.columns else 0
        logger.info("option_listing download: %d rows (%d YES) in %.0fms", len(df), yes_count, elapsed)
        return APIResponse.ok(data={
            "rows":       len(df),
            "yes_count":  yes_count,
            "elapsed_ms": elapsed,
        })
    except Exception as exc:
        logger.exception("option_listing download error")
        return APIResponse.fail(message=str(exc))


def _load_option_listing_set() -> set | None:
    """Load (store, concept_new) YES set from cache. Returns None if not cached."""
    if not has_output(_OL_OWNER, _OL_OBJ):
        return None
    try:
        ol = read_cache(_OL_OWNER, _OL_OBJ)
        ol.columns = [c.lower() for c in ol.columns]
        yes = ol[ol["list_tag"].str.upper() == "YES"][["store", "concept_new"]].drop_duplicates()
        return set(zip(yes["store"].astype(str).str.strip(), yes["concept_new"].astype(str).str.strip()))
    except Exception as exc:
        logger.warning("_load_option_listing_set: %s", exc)
        return None


# ── Distribution Base builder ──────────────────────────────────────────────────

_CK = "CK_A2166"
_NSO_OWNER = "CK_A2166"


def _load(owner: str, obj: str) -> pd.DataFrame | None:
    if not has_output(owner, obj):
        return None
    return read_cache(owner, obj)


def _safe_merge(base: pd.DataFrame, right: pd.DataFrame | None,
                on: list[str], cols: list[str], suffixes=('', '_r')) -> pd.DataFrame:
    """Left join base with right on `on`, bringing in only `cols`."""
    if right is None or right.empty:
        for c in cols:
            if c not in base.columns:
                base[c] = 0
        return base
    # keep only join keys + needed cols from right
    keep = list({*on, *[c for c in cols if c in right.columns]})
    right_sub = right[keep].copy()
    # lowercase col names
    right_sub.columns = [c.lower() for c in right_sub.columns]
    merged = base.merge(right_sub, on=[k.lower() for k in on], how='left', suffixes=suffixes)
    for c in cols:
        if c not in merged.columns:
            merged[c] = 0
    return merged


@router.post("/build-base", response_model=APIResponse)
async def build_distribution_base(
    req_source:          str = "GRC",   # GRC | WMS | BOTH
    biz_segment:         str = "APPS",  # APPS | GM | BOTH
    sort_mode:           str = "combined_req",  # fill_rate | combined_req | festive_req
    scopes:              str = "",       # JSON array of {division, attribute1} for OR-filter
    stores:              str = "",       # JSON array of store_name strings to filter
    store_field_filters: str = "",       # JSON dict of {field: [values]} store master field filters
    req_fallback:        str = "parquet",  # "parquet" | "zero" — for items not matched in REQ CSV
):
    """
    Build the full joined distribution base:
      BARCODE_GRC/WMS × V_ITEM_MASTER × MC/ART/MRP/SIZE/SPARKY/OPTION REQ
    Returns sorted store-barcode rows ready for grid distribution loop.
    """
    _require_oracle()
    try:
        t0 = time.perf_counter()

        # ── 1. Load base (BARCODE GRC / WMS / BOTH, or uploaded CSV override) ─
        if _uploaded_stock_df is not None:
            # Use uploaded CSV as stock source — pick GRC parquet for REQ columns,
            # fallback to WMS, then override wh_q from the uploaded barcode qty map.
            grc = _load(_CK, "V_BARCODE_REQ_APPS_GRC_V2")
            wms = _load(_CK, "V_BARCODE_REQ_APPS_WMS_V2")
            base_raw = grc if grc is not None else wms
            if base_raw is None:
                return APIResponse.fail(message="Barcode parquets not found. Download from Master Data page first.")
            base = base_raw.copy()
            base.columns = [c.lower() for c in base.columns]
            base["dist_req"] = base.get("req", 0)
            # Merge uploaded qty — any barcode not in upload gets wh_q = 0
            upload = _uploaded_stock_df.copy()
            base = base.merge(upload.rename(columns={"wh_q": "_csv_wh_q"}), on="icode", how="left")
            base["wh_q"] = base["_csv_wh_q"].fillna(0).astype(int)
            base.drop(columns=["_csv_wh_q"], inplace=True)
            req_source = "CSV"
        else:
            grc = _load(_CK, "V_BARCODE_REQ_APPS_GRC_V2")
            wms = _load(_CK, "V_BARCODE_REQ_APPS_WMS_V2")

            if grc is None and wms is None:
                return APIResponse.fail(message="Barcode parquets not found. Download from Master Data page first.")

            req_source = req_source.upper()
            if req_source == "GRC":
                if grc is None:
                    return APIResponse.fail(message="GRC parquet not found.")
                base = grc.copy()
                base.columns = [c.lower() for c in base.columns]
                base["dist_req"] = base.get("req", 0)
                base["wh_q"] = base.get("grc_q", 0)
            elif req_source == "WMS":
                if wms is None:
                    return APIResponse.fail(message="WMS parquet not found.")
                base = wms.copy()
                base.columns = [c.lower() for c in base.columns]
                base["dist_req"] = base.get("req", 0)
                base["wh_q"] = base.get("wms_q", 0)
            else:  # BOTH
                if grc is None or wms is None:
                    return APIResponse.fail(message="Both GRC and WMS parquets required.")
                grc.columns = [c.lower() for c in grc.columns]
                wms.columns = [c.lower() for c in wms.columns]
                base = grc.merge(
                    wms[["icode", "store_name", "req", "wms_q"]].rename(columns={"req": "wms_req", "wms_q": "wms_stock"}),
                    on=["icode", "store_name"], how="left"
                )
                base["wms_req"]   = base["wms_req"].fillna(0)
                base["wms_stock"] = base["wms_stock"].fillna(0)
                base["dist_req"]  = base.get("req", 0) + base["wms_req"]
                base["wh_q"] = base.get("grc_q", 0) + base["wms_stock"]

        # normalise col names
        base.columns = [c.lower() for c in base.columns]

        # filter fnl_list = Y
        if "fnl_list" in base.columns:
            base = base[base["fnl_list"].astype(str).str.upper() == "Y"].copy()

        # ── Scope filter (Division × Attribute1 OR-combined, multi-select) ───────
        if scopes:
            import json as _json
            try:
                parsed = _json.loads(scopes)
                if parsed:
                    masks = []
                    for sc in parsed:
                        m = pd.Series(True, index=base.index)
                        # Support both new multi-select (divisions/attribute1s) and old single-value
                        divs  = sc.get("divisions") or ([sc["division"]] if sc.get("division") else [])
                        attrs = sc.get("attribute1s") or ([sc["attribute1"]] if sc.get("attribute1") else [])
                        if divs and "division" in base.columns:
                            m &= base["division"].isin(divs)
                        if attrs and "attribute1" in base.columns:
                            m &= base["attribute1"].isin(attrs)
                        masks.append(m)
                    if masks:
                        combined = masks[0]
                        for m in masks[1:]:
                            combined |= m
                        base = base[combined].copy()
            except Exception:
                pass

        # ── Store filter (by name) ─────────────────────────────────────────────
        if stores and "store_name" in base.columns:
            import json as _json
            try:
                store_list = _json.loads(stores)
                if store_list:
                    base = base[base["store_name"].isin(store_list)].copy()
            except Exception:
                pass

        # ── Store master field filters (zone/city/state/cluster/grade/etc.) ───
        if store_field_filters:
            import json as _json
            try:
                field_map = _json.loads(store_field_filters)  # {col: [values]}
                if field_map:
                    # Join store master to get the filterable columns
                    from app.repositories.store_repository import StoreRepository
                    sm = StoreRepository().get_all_stores(active_only=False)
                    sm.columns = [c.lower() for c in sm.columns]
                    # Find the store name column in base
                    base_sn = "store_name" if "store_name" in base.columns else None
                    sm_sn   = "store_name" if "store_name" in sm.columns else None
                    if base_sn and sm_sn:
                        filter_cols = [c for c in field_map.keys() if c in sm.columns]
                        if filter_cols:
                            sm_sub = sm[[sm_sn] + filter_cols].drop_duplicates(sm_sn)
                            # Merge, apply filters, drop helper cols
                            merged = base.merge(sm_sub, left_on=base_sn, right_on=sm_sn, how="left", suffixes=("", "_sm"))
                            mask = pd.Series(True, index=merged.index)
                            for col, vals in field_map.items():
                                if col in merged.columns and vals:
                                    mask &= merged[col].astype(str).str.strip().isin([str(v).strip() for v in vals])
                            base = merged[mask].drop(columns=[c + "_sm" for c in filter_cols if c + "_sm" in merged.columns]).copy()
            except Exception as _fe:
                logger.warning("store_field_filters parse error: %s", _fe)

        # ── 1b. Barcode REQ CSV override (replace dist_req per icode×store) ────
        if "barcode" in _uploaded_req:
            bc_req = _uploaded_req["barcode"]["df"].copy()  # icode, store_name, req
            if "icode" in base.columns and "store_name" in base.columns:
                base = base.merge(bc_req[["icode", "store_name", "req"]].rename(columns={"req": "_csv_req"}),
                                  on=["icode", "store_name"], how="left")
                mask = base["_csv_req"].notna()
                base.loc[mask, "dist_req"] = base.loc[mask, "_csv_req"]
                if req_fallback == "zero":
                    base.loc[~mask, "dist_req"] = 0
                base.drop(columns=["_csv_req"], inplace=True)

        # ── 2. Join V_ITEM_MASTER → option_level, allocation_option, sz_grp ───
        im = _load("REPORT", "V_ITEM_MASTER")
        if im is not None:
            im.columns = [c.lower() for c in im.columns]
            cols = ["icode", "option_level", "allocation_option", "sz_grp"]
            extras = []
            for extra in ["attribute1", "concept_new"]:
                if extra in im.columns:
                    cols.append(extra)
                    extras.append(extra)
            im_sub = im[cols].drop_duplicates("icode")
            # drop any existing extras from base to avoid _x/_y suffix conflict
            base = base.drop(columns=[c for c in extras if c in base.columns], errors="ignore")
            base = base.merge(im_sub, on="icode", how="left")

        # ── 3. MC REQ (sorting only) — dept + display_type + store_name ───────
        biz = biz_segment.upper()
        mc_frames = []
        if biz in ("APPS", "BOTH"):
            mc_apps = _load(_CK, "V_MC_REQ_APPS_2")
            if mc_apps is not None:
                mc_frames.append(mc_apps)
        if biz in ("GM", "BOTH"):
            mc_gm = _load(_CK, "V_MC_REQ_GM")
            if mc_gm is not None:
                mc_frames.append(mc_gm)
        if mc_frames:
            mc = pd.concat(mc_frames, ignore_index=True)
            mc.columns = [c.lower() for c in mc.columns]
            mc_key = ["department", "display_type", "store_name"]
            mc_agg = mc.groupby(mc_key, as_index=False).agg(
                mc_req=("req", "sum"),
                mc_fill_rate=("fill_rate", "mean"),
                mc_pbs=("pbs", "sum"),
            )
            base = base.merge(mc_agg, on=mc_key, how="left")
        else:
            base["mc_req"] = 0; base["mc_fill_rate"] = 0; base["mc_pbs"] = 0
        # MC CSV override
        if "mc" in _uploaded_req:
            _mc_csv = _uploaded_req["mc"]["df"].copy()
            _mc_key = ["department", "display_type", "store_name"]
            _valid = [k for k in _mc_key if k in _mc_csv.columns and k in base.columns]
            if _valid and "req" in _mc_csv.columns:
                base = base.merge(_mc_csv[_valid + ["req"]].rename(columns={"req": "_csv_mc_req"}),
                                  on=_valid, how="left")
                base["mc_req"] = base["_csv_mc_req"].fillna(0 if req_fallback == "zero" else base.get("mc_req", 0))
                base.drop(columns=["_csv_mc_req"], inplace=True)

        # ── 4. ART REQ (sort + dist) — dept + display_type + article_name + store ─
        art_frames = []
        if biz in ("APPS", "BOTH"):
            art_apps = _load(_CK, "V_ART_REQ_APPS")
            if art_apps is not None:
                art_frames.append(art_apps)
        if biz in ("GM", "BOTH"):
            art_gm = _load(_CK, "V_ART_REQ_GM")
            if art_gm is not None:
                art_frames.append(art_gm)
        if art_frames:
            art = pd.concat(art_frames, ignore_index=True)
            art.columns = [c.lower() for c in art.columns]
            art_key = ["department", "display_type", "article_name", "store_name"]
            art_agg = art.groupby(art_key, as_index=False).agg(
                art_req=("req", "sum"),
                art_fill_rate=("fill_rate", "mean"),
            )
            base = base.merge(art_agg, on=art_key, how="left")
        else:
            base["art_req"] = 0; base["art_fill_rate"] = 0
        # ART CSV override
        if "art" in _uploaded_req:
            _art_csv = _uploaded_req["art"]["df"].copy()
            _art_key = ["department", "display_type", "article_name", "store_name"]
            _valid = [k for k in _art_key if k in _art_csv.columns and k in base.columns]
            if _valid and "req" in _art_csv.columns:
                base = base.merge(_art_csv[_valid + ["req"]].rename(columns={"req": "_csv_art_req"}),
                                  on=_valid, how="left")
                base["art_req"] = base["_csv_art_req"].fillna(0 if req_fallback == "zero" else base.get("art_req", 0))
                base.drop(columns=["_csv_art_req"], inplace=True)

        # ── 5. MRP REQ (sort + dist) — dept + display_type + article_name + mrp + store ─
        mrp = _load(_CK, "V_MRP_REQ_APPS")
        if mrp is not None:
            mrp.columns = [c.lower() for c in mrp.columns]
            mrp_key = ["department", "display_type", "article_name", "mrp", "store_name"]
            mrp_agg = mrp.groupby(mrp_key, as_index=False).agg(mrp_req=("req", "sum"))
            base = base.merge(mrp_agg, on=mrp_key, how="left")
        else:
            base["mrp_req"] = 0
        # MRP CSV override
        if "mrp" in _uploaded_req:
            _mrp_csv = _uploaded_req["mrp"]["df"].copy()
            _mrp_key = ["department", "display_type", "article_name", "mrp", "store_name"]
            _valid = [k for k in _mrp_key if k in _mrp_csv.columns and k in base.columns]
            if _valid and "req" in _mrp_csv.columns:
                base = base.merge(_mrp_csv[_valid + ["req"]].rename(columns={"req": "_csv_mrp_req"}),
                                  on=_valid, how="left")
                base["mrp_req"] = base["_csv_mrp_req"].fillna(0 if req_fallback == "zero" else base.get("mrp_req", 0))
                base.drop(columns=["_csv_mrp_req"], inplace=True)

        # ── 6. SIZE REQ (sort + dist) — dept + display_type + article_name + cat4 + store ─
        sz = _load(_CK, "V_SZ_REQ_APPS")
        if sz is not None:
            sz.columns = [c.lower() for c in sz.columns]
            sz_key = ["department", "display_type", "article_name", "cat4", "store_name"]
            valid_sz_key = [k for k in sz_key if k in sz.columns and k in base.columns]
            if valid_sz_key:
                sz_agg = sz.groupby(valid_sz_key, as_index=False).agg(sz_req=("sz_req", "sum"))
                base = base.merge(sz_agg, on=valid_sz_key, how="left")
            else:
                base["sz_req"] = 0
        else:
            base["sz_req"] = 0
        # SIZE CSV override
        if "size" in _uploaded_req:
            _sz_csv = _uploaded_req["size"]["df"].copy()
            _sz_key = ["department", "display_type", "article_name", "cat4", "store_name"]
            _valid = [k for k in _sz_key if k in _sz_csv.columns and k in base.columns]
            if _valid and "sz_req" in _sz_csv.columns:
                base = base.merge(_sz_csv[_valid + ["sz_req"]].rename(columns={"sz_req": "_csv_sz_req"}),
                                  on=_valid, how="left")
                base["sz_req"] = base["_csv_sz_req"].fillna(0 if req_fallback == "zero" else base.get("sz_req", 0))
                base.drop(columns=["_csv_sz_req"], inplace=True)

        # ── 7. SPARKY REQ (sort + dist) — article_name + store (cat2='SPARKY') ─
        sparky = _load(_CK, "V_SPARKY_PBS_REQ")
        if sparky is not None:
            sparky.columns = [c.lower() for c in sparky.columns]
            sparky_key = ["article_name", "store_name"]
            if all(k in sparky.columns for k in sparky_key):
                sparky_agg = sparky.groupby(sparky_key, as_index=False).agg(sparky_req=("sparky_req", "sum"))
                sparky_rows = base["cat2"].astype(str).str.upper() == "SPARKY" if "cat2" in base.columns else pd.Series(False, index=base.index)
                base_sparky = base[sparky_rows].merge(sparky_agg, on=sparky_key, how="left")
                base_other  = base[~sparky_rows].copy()
                base_other["sparky_req"] = 0
                base = pd.concat([base_sparky, base_other], ignore_index=True)
            else:
                base["sparky_req"] = 0
        else:
            base["sparky_req"] = 0

        # ── 8. OPTION REQ (sort + dist) — dept + display_type + mrp + opt_level + alloc_opt + store ─
        opt = _load(_CK, "V_OPTION_REQ_APPS")
        if opt is not None and "option_level" in base.columns and "allocation_option" in base.columns:
            opt.columns = [c.lower() for c in opt.columns]
            opt_key = ["department", "display_type", "mrp", "option_level", "allocation_option", "store_name"]
            valid_opt_key = [k for k in opt_key if k in opt.columns and k in base.columns]
            if valid_opt_key:
                opt_agg = opt.groupby(valid_opt_key, as_index=False).agg(option_req=("option_req", "sum"))
                base = base.merge(opt_agg, on=valid_opt_key, how="left")
            else:
                base["option_req"] = 0
        else:
            base["option_req"] = 0

        # ── 9. STORE MASTER — festival_grouping, store_tag ────────────────────
        sm = _load("CK_A2166", "STORE_MASTER_NSO")
        if sm is not None:
            sm.columns = [c.lower() for c in sm.columns]
            sm_cols = [c for c in ["store_name", "festival_grouping", "store_tag", "plng_store_tag"] if c in sm.columns]
            sm_sub = sm[sm_cols].drop_duplicates("store_name")
            base = base.merge(sm_sub, on="store_name", how="left")

        # ── 10. Fill NaN req cols ──────────────────────────────────────────────
        req_cols = ["art_req", "mrp_req", "sz_req", "sparky_req", "option_req",
                    "mc_req", "mc_fill_rate", "art_fill_rate"]
        for c in req_cols:
            if c in base.columns:
                base[c] = base[c].fillna(0)

        # ── 11. Total distribution req ─────────────────────────────────────────
        dist_cols = [c for c in ["dist_req", "art_req", "mrp_req", "sz_req", "sparky_req", "option_req"]
                     if c in base.columns]
        base["total_req"] = base[dist_cols].sum(axis=1)

        # ── 12. Sorting — primary: icode (keeps each barcode's stores together)
        #        secondary: store priority (determines which store gets stock first in loop)
        if sort_mode == "fill_rate":
            # Low fill_rate stores get stock first (most under-served)
            base["_sort_fill"] = base.get("mc_fill_rate", pd.Series(0, index=base.index)).fillna(999)
            base = base.sort_values(["icode", "_sort_fill"], ascending=[True, True])
            base = base.drop(columns=["_sort_fill"])
        elif sort_mode == "festive_req":
            # Festive stores first, then by total_req descending
            fest = base.get("festival_grouping", pd.Series("-", index=base.index)).fillna("-")
            base["_fest_priority"] = (fest != "-").astype(int)
            base = base.sort_values(["icode", "_fest_priority", "total_req"],
                                    ascending=[True, False, False])
            base = base.drop(columns=["_fest_priority"])
        else:  # combined_req (default) — high req stores get stock first
            base = base.sort_values(["icode", "total_req"], ascending=[True, False])

        # ── 13. Cache base for distribution loop ──────────────────────────────
        write_cache("DIST", "BASE", base)

        # ── 14. Return summary ─────────────────────────────────────────────────
        elapsed = round((time.perf_counter() - t0) * 1000, 1)
        base = base.where(base.notna(), None)

        return APIResponse.ok(data={
            "rows":        len(base),
            "columns":     list(base.columns),
            "elapsed_ms":  elapsed,
            "req_source":  req_source,
            "biz_segment": biz_segment,
            "sort_mode":   sort_mode,
            "sample":      base.head(5).to_dict(orient="records"),
        })

    except Exception as exc:
        logger.exception("build_distribution_base error")
        return APIResponse.fail(message=str(exc))


# ── Distribution Loop v3 — MROUND + shared pools ──────────────────────────────


def _mround(value: float, multiple: int) -> int:
    """Excel MROUND: round to nearest grid multiple."""
    if multiple <= 0:
        return max(0, int(value))
    return int(math.floor(value / multiple + 0.5) * multiple)


def _run_distribution_loop_v2(base: pd.DataFrame, wh_col: str = "grc_q",
                               max_round: int = 9) -> pd.DataFrame:
    """
    Distribution loop v3:
    - MROUND: allocation in grid multiples (Excel MROUND)
    - Shared mc_req pool per (department, store) — cross-barcode deduction
    - Shared art_req pool per (article_name, store) — cross-barcode deduction
    - Phase: rounds 1-3 = grid×3 (bulk), rounds 4+ = grid×1 (drip)
    - eligible_req = min(barcode_req, mc_req, [mrp_req if MRP in option_level])
    - Outer loop: round → all rows in sort order (preserves cross-barcode shared pool)
    """
    base = base.reset_index(drop=True)
    n    = len(base)

    def gcol(name, default=0.0):
        return base[name].fillna(default).values if name in base.columns else np.full(n, default)

    art_g   = gcol("art_grid").astype(int)
    max_g   = gcol("max_grid").astype(int)
    desc4_g = gcol("desc4").astype(int)   # pack size — MROUND multiple
    mc_r    = gcol("mc_req")
    art_r   = gcol("art_req")
    mrp_r   = gcol("mrp_req")
    bar_r   = gcol("dist_req")
    wh_q    = gcol(wh_col)
    opt_lvl = base["option_level"].fillna("").values if "option_level" in base.columns else np.array([""] * n)
    dept    = base["department"].fillna("").values   if "department"    in base.columns else np.array([""] * n)
    art_nm  = base["article_name"].fillna("").values if "article_name"  in base.columns else np.array([""] * n)
    store_v = base["store_name"].fillna("").values   if "store_name"    in base.columns else np.array([""] * n)
    icode_v = base["icode"].fillna("").values        if "icode"         in base.columns else np.array([""] * n)

    # Sorting rank within each icode group (base already sorted by sort_mode)
    ranks, rank_ctr = np.zeros(n, dtype=int), {}
    for i in range(n):
        rank_ctr[icode_v[i]] = rank_ctr.get(icode_v[i], 0) + 1
        ranks[i] = rank_ctr[icode_v[i]]
    base["sorting_rank"] = ranks

    # MRP flag per row
    mrp_flag = np.array(["MRP" in str(o).upper() for o in opt_lvl])

    # ── Initialize shared pools ────────────────────────────────────────────────
    mc_pool  = {}   # (department, store) → remaining mc_req
    art_pool = {}   # (article_name, store) → remaining art_req
    bar_pool = {}   # (icode, store) → remaining barcode_req
    wh_pool  = {}   # icode → remaining wh_stock

    for i in range(n):
        k_mc  = (dept[i],   store_v[i])
        k_art = (art_nm[i], store_v[i])
        k_bar = (icode_v[i], store_v[i])
        if k_mc  not in mc_pool:  mc_pool[k_mc]   = max(0.0, float(mc_r[i]))
        if k_art not in art_pool: art_pool[k_art]  = max(0.0, float(art_r[i]))
        if k_bar not in bar_pool: bar_pool[k_bar]  = max(0.0, float(bar_r[i]))
        if icode_v[i] not in wh_pool: wh_pool[icode_v[i]] = max(0.0, float(wh_q[i]))

    # Per-row eligibility (static: bar_req > 0 AND mc_req > 0)
    eligible0 = (bar_r > 0) & (mc_r > 0)

    # ── Round loop ─────────────────────────────────────────────────────────────
    round_alloc = np.zeros((n, max_round), dtype=float)
    wh_snap     = {k: [] for k in wh_pool}    # wh balance after each round per icode
    mc_snap     = np.zeros((n, max_round))    # mc_pool balance per row after each round

    for rnd in range(max_round):
        multi = 3 if rnd < 3 else 1          # bulk rounds 1-3, drip rounds 4+

        for i in range(n):
            if not eligible0[i]:
                continue

            ic  = icode_v[i];  st = store_v[i]
            dp  = dept[i];     an = art_nm[i]
            pack = max(int(desc4_g[i]), 1)   # MROUND multiple (pack size)
            grid = max(int(art_g[i]), 1)      # min allocation target

            wh_now  = wh_pool.get(ic, 0.0)
            if wh_now <= 0:
                continue

            mc_rem  = mc_pool.get((dp, st), 0.0)
            art_rem = art_pool.get((an, st), 0.0)
            bar_rem = bar_pool.get((ic, st), 0.0)

            if mc_rem <= 0 or bar_rem <= 0:
                continue

            # eligible_req = min(barcode_req, mc_req, [mrp_req if MRP in option_level])
            cands = [bar_rem, mc_rem]
            if mrp_flag[i] and float(mrp_r[i]) > 0:
                cands.append(float(mrp_r[i]))
            min_req = min(cands)

            if min_req <= 0:
                continue

            # Cap: don't exceed max_grid across all rounds
            already  = float(round_alloc[i, :rnd].sum())
            room     = min(float(max_g[i]) - already, mc_rem)
            if room <= 0:
                continue

            target = min(min_req, float(grid * multi), wh_now, room)
            if target <= 0:
                continue

            # MROUND to nearest PACK SIZE multiple (desc4)
            if wh_now >= pack:
                give = float(_mround(target, pack))
                give = min(give, wh_now)
            else:
                give = min(target, wh_now)   # residual < 1 pack

            if give <= 0:
                continue

            round_alloc[i, rnd] = give
            wh_pool[ic]            = max(0.0, wh_pool.get(ic, 0.0)       - give)
            mc_pool[(dp, st)]      = max(0.0, mc_pool.get((dp,st), 0.0)  - give)
            art_pool[(an, st)]     = max(0.0, art_pool.get((an,st), 0.0) - give)
            bar_pool[(ic, st)]     = max(0.0, bar_pool.get((ic,st), 0.0) - give)

        # Snapshot WH balance after this round (per icode)
        for k in wh_pool:
            wh_snap[k].append(wh_pool[k])

        # Snapshot MC balance after this round (per row)
        for i in range(n):
            dp = dept[i]; st = store_v[i]
            mc_snap[i, rnd] = mc_pool.get((dp, st), 0.0)

    # ── Write columns ──────────────────────────────────────────────────────────
    for rnd in range(max_round):
        base[f"round{rnd+1}_alloc"] = round_alloc[:, rnd].astype(int)
        base[f"balance_wh_r{rnd+1}"] = np.array([
            wh_snap.get(icode_v[i], [0]*max_round)[rnd]
            if rnd < len(wh_snap.get(icode_v[i], [])) else 0
            for i in range(n)
        ], dtype=int)
        base[f"balance_mc_r{rnd+1}"] = mc_snap[:, rnd].astype(int)

    base["final_allocate"] = round_alloc.sum(axis=1).astype(int)

    base["eligible_req"] = np.array([
        round(min([float(bar_r[i]), float(mc_r[i])] +
                  ([float(mrp_r[i])] if mrp_flag[i] and float(mrp_r[i]) > 0 else [])), 2)
        for i in range(n)
    ])
    base["mc_cap"] = mc_r.round(0).astype(int)

    # Reason for not allocating
    reasons = []
    for i in range(n):
        alloc = int(round_alloc[i].sum())
        if alloc > 0:
            reasons.append("ALLOCATED")
        elif float(bar_r[i]) <= 0:
            reasons.append("ICODE REQ ZERO")
        elif float(mc_r[i]) <= 0:
            reasons.append("MC REQ ZERO")
        elif float(wh_q[i]) <= 0:
            reasons.append("NO WH STOCK")
        elif float(wh_q[i]) < float(desc4_g[i]):
            reasons.append("WH STOCK < PACK SIZE")
        else:
            reasons.append("NOT REACHED — WH EXHAUSTED")
    base["reason_not_allocated"] = reasons

    return base


@router.get("/base/status", response_model=APIResponse)
async def base_status():
    """Check if distribution base cache exists."""
    _require_oracle()
    ready = has_output("DIST", "BASE")
    meta  = get_meta("DIST", "BASE") if ready else {}
    return APIResponse.ok(data={"ready": ready, "rows": meta.get("rows", 0), "cached_at": meta.get("cached_at")})


@router.post("/distribute", response_model=APIResponse)
async def run_distribution(body: DistributeRequest = None, wh_col: str = "wh_q", max_round: int = 10):
    """
    Run the min→max grid distribution loop on the cached base (v2).
    Accepts optional JSON body (DistributeRequest) with hold_rules.
    Query params wh_col/max_round used as fallback when no body provided.
    """
    _require_oracle()
    try:
        if not has_output("DIST", "BASE"):
            return APIResponse.fail(message="Base not built yet. Run /build-base first.")

        if body is not None:
            wh_col = body.wh_col
            max_round = body.max_round
            hold_rules = body.hold_rules
            apply_option_listing = body.apply_option_listing
        else:
            hold_rules = []
            apply_option_listing = False

        t0   = time.perf_counter()
        base = read_cache("DIST", "BASE")
        base.columns = [c.lower() for c in base.columns]

        # fallback for old cache without wh_q
        if wh_col not in base.columns:
            for fallback in ("wh_stock_q", "grc_q"):
                if fallback in base.columns:
                    wh_col = fallback
                    break
            else:
                return APIResponse.fail(message=f"Column '{wh_col}' not found. Available: {list(base.columns)}")

        # Apply hold rules — zero out dist_req for held rows before distribution loop
        if hold_rules:
            req_col = "dist_req" if "dist_req" in base.columns else None
            if req_col:
                for rule in hold_rules:
                    if rule.type == "store" and rule.stores:
                        held = base["store_name"].isin([s.upper() for s in rule.stores])
                        base.loc[held, req_col] = 0
                        base.loc[held, "mc_req"] = 0
                    elif rule.type == "attr1" and rule.attr1 and "attribute1" in base.columns:
                        exempt = {s.upper() for s in rule.except_stores}
                        held = (
                            base["attribute1"].str.upper() == rule.attr1.upper()
                        ) & ~base["store_name"].isin(exempt)
                        base.loc[held, req_col] = 0
                        base.loc[held, "mc_req"] = 0

        # Join list_tag from T_CLR_CONCEPT_AW26_V1 (always, if cached)
        ol_held_count = 0
        if has_output(_OL_OWNER, _OL_OBJ) and "concept_new" in base.columns:
            try:
                ol_df = read_cache(_OL_OWNER, _OL_OBJ)
                ol_df.columns = [c.lower() for c in ol_df.columns]
                ol_df["store"] = ol_df["store"].astype(str).str.strip()
                ol_df["concept_new"] = ol_df["concept_new"].astype(str).str.strip()
                # keep one list_tag per store×concept_new (YES wins over NO)
                ol_df["_rank"] = ol_df["list_tag"].str.upper().map({"YES": 0, "NO": 1}).fillna(2)
                ol_tag = (ol_df.sort_values("_rank")
                          .drop_duplicates(subset=["store", "concept_new"])
                          [["store", "concept_new", "list_tag"]])
                base["_store_key"] = base["store_name"].astype(str).str.strip()
                base["_concept_key"] = base["concept_new"].astype(str).str.strip()
                base = base.merge(
                    ol_tag.rename(columns={"store": "_store_key", "concept_new": "_concept_key"}),
                    on=["_store_key", "_concept_key"], how="left"
                )
                base.drop(columns=["_store_key", "_concept_key"], inplace=True)
            except Exception as exc:
                logger.warning("list_tag join failed: %s", exc)

        # Apply Option Listing hold — PREWINTER/LT WINTER × store×concept_new
        if apply_option_listing:
            ol_yes_set = _load_option_listing_set()
            if ol_yes_set is not None and "attribute1" in base.columns and "concept_new" in base.columns:
                req_col = "dist_req" if "dist_req" in base.columns else None
                attr1_in_scope = base["attribute1"].str.upper().isin(_OL_ATTR1_SCOPE)
                in_yes = pd.Series(
                    [(str(s).strip(), str(c).strip()) in ol_yes_set
                     for s, c in zip(base["store_name"], base["concept_new"])],
                    index=base.index, dtype=bool
                )
                ol_hold_mask = attr1_in_scope & ~in_yes
                ol_held_count = int(ol_hold_mask.sum())
                if req_col and ol_held_count:
                    base.loc[ol_hold_mask, req_col] = 0
                    base.loc[ol_hold_mask, "mc_req"] = 0
                    if "reason_not_allocated" not in base.columns:
                        base["reason_not_allocated"] = ""
                    base.loc[ol_hold_mask, "reason_not_allocated"] = "HOLD FOR OPTION_LISTING NO"
                logger.info("Option listing hold: %d rows held (attr1 in scope & not in YES list)", ol_held_count)
            else:
                logger.warning("Option listing hold requested but cache not ready or columns missing")

        max_round = max(1, min(max_round, 20))  # clamp 1-20
        result    = _run_distribution_loop_v2(base, wh_col=wh_col, max_round=max_round)
        elapsed   = round((time.perf_counter() - t0) * 1000, 1)

        # Cache result for fast export
        global _last_dist_result, _last_dist_params
        _last_dist_result = result
        _last_dist_params = {"wh_col": wh_col, "max_round": max_round}

        # ── Summary stats ──────────────────────────────────────────────────────
        total_allocated = int(result["final_allocate"].sum())
        stores_covered  = int((result["final_allocate"] > 0).sum())
        icodes_total    = result["icode"].nunique()
        fully_covered   = result.groupby("icode").apply(
            lambda g: (g["final_allocate"] >= g["art_grid"].fillna(0)).all()
        ).sum()

        # ── Sample: key display columns ────────────────────────────────────────
        display_cols = [
            # identity
            "store_name", "store_grade", "icode", "wh_q", "desc4",
            # product
            "department", "display_type", "article_name", "mrp", "cat4", "cat2",
            # item master extras
            "attribute1", "concept_new", "list_tag",
            # option
            "option_level", "allocation_option",
            # req inputs
            "dist_req", "mc_req", "art_req", "mrp_req", "sz_req", "sparky_req", "option_req",
            # fill & rank
            "mc_fill_rate", "sorting_rank",
            # grid
            "art_grid", "max_grid",
            # computed
            "eligible_req", "mc_cap",
        ]
        round_display = []
        for rnd in range(max_round):
            round_display += [
                f"round{rnd+1}_alloc",
                f"balance_wh_r{rnd+1}",
                f"balance_mc_r{rnd+1}",
            ]
        display_cols += round_display + ["final_allocate", "reason_not_allocated"]

        avail = [c for c in display_cols if c in result.columns]
        sample_df = result[avail].head(20).fillna(0)
        # convert numeric cols to native python types
        for c in sample_df.select_dtypes(include="number").columns:
            sample_df[c] = sample_df[c].round(2)

        return APIResponse.ok(data={
            "rows":                   len(result),
            "elapsed_ms":             elapsed,
            "max_round":              max_round,
            "total_allocated":        total_allocated,
            "stores_covered":         stores_covered,
            "icodes_total":           icodes_total,
            "icodes_fully_covered":   int(fully_covered),
            "ol_held_count":          ol_held_count,
            "columns":                avail,
            "sample":                 sample_df.to_dict(orient="records"),
        })

    except Exception as exc:
        logger.exception("run_distribution error")
        return APIResponse.fail(message=str(exc))


def _get_export_df(wh_col: str, max_round: int) -> "pd.DataFrame":
    """Return the distribution result dataframe, using cache if available."""
    global _last_dist_result, _last_dist_params
    if (
        _last_dist_result is not None
        and _last_dist_params.get("wh_col") == wh_col
        and _last_dist_params.get("max_round") == max_round
    ):
        return _last_dist_result
    if not has_output("DIST", "BASE"):
        from fastapi import HTTPException as _HE
        raise _HE(400, detail="Base not built yet. Run /build-base first.")
    base = read_cache("DIST", "BASE")
    base.columns = [c.lower() for c in base.columns]
    if wh_col not in base.columns:
        for fallback in ("wh_stock_q", "grc_q"):
            if fallback in base.columns:
                wh_col = fallback; break
    max_round = max(1, min(max_round, 20))
    result = _run_distribution_loop_v2(base, wh_col=wh_col, max_round=max_round)
    _last_dist_result = result
    _last_dist_params = {"wh_col": wh_col, "max_round": max_round}
    return result


def _build_export_cols(max_round: int) -> list:
    cols = [
        "store_name", "store_grade", "icode", "wh_q", "desc4",
        "department", "display_type", "article_name", "mrp", "cat4", "cat2",
        "attribute1", "concept_new", "list_tag",
        "option_level", "allocation_option",
        "dist_req", "mc_req", "art_req", "mrp_req", "sz_req", "sparky_req", "option_req",
        "mc_fill_rate", "sorting_rank", "art_grid", "max_grid",
        "eligible_req", "mc_cap",
    ]
    for rnd in range(max_round):
        cols += [f"round{rnd+1}_alloc", f"balance_wh_r{rnd+1}", f"balance_mc_r{rnd+1}"]
    cols += ["final_allocate", "reason_not_allocated"]
    return cols


def _ensure_division_col(out: "pd.DataFrame") -> "pd.DataFrame":
    """Attach 'division' column from base cache if not already present."""
    div_col = next((c for c in ["division", "div"] if c in out.columns), None)
    if div_col is None and has_output("DIST", "BASE"):
        base_cached = read_cache("DIST", "BASE")
        base_cached.columns = [c.lower() for c in base_cached.columns]
        dc = next((c for c in ["division", "div"] if c in base_cached.columns), None)
        if dc:
            out = out.copy()
            out["division"] = base_cached[dc].values[:len(out)]
    return out


@router.get("/division-summary")
async def division_summary(wh_col: str = "wh_q", max_round: int = 10):
    """
    Return per-division row counts:
      { division, rows_total, rows_nonzero }
    rows_nonzero = rows where final_allocate > 0
    """
    _require_oracle()
    try:
        result = _get_export_df(wh_col, max_round)
        cols = _build_export_cols(max_round)
        avail = [c for c in cols if c in result.columns]
        out = result[avail].fillna(0)
        out = _ensure_division_col(out)

        div_col = next((c for c in ["division", "div"] if c in out.columns), None)
        if div_col is None:
            return {"rows_total": len(out), "divisions": []}

        alloc_col = "final_allocate" if "final_allocate" in out.columns else None
        grc_col = "grc_q" if "grc_q" in out.columns else None
        wms_col = "wms_stock" if "wms_stock" in out.columns else ("wms_q" if "wms_q" in out.columns else None)
        rows = []
        for div_name, grp in out.groupby(div_col):
            total = len(grp)
            nonzero = int((grp[alloc_col] > 0).sum()) if alloc_col else total
            rows_grc = int((grp[grc_col] > 0).sum()) if grc_col else None
            rows_wms = int((grp[wms_col] > 0).sum()) if wms_col else None
            rows.append({"division": str(div_name), "rows_total": total, "rows_nonzero": nonzero,
                         "rows_grc": rows_grc, "rows_wms": rows_wms})
        rows.sort(key=lambda x: x["division"])
        return {"rows_total": len(out), "divisions": rows}
    except Exception as exc:
        logger.exception("division_summary error")
        raise


@router.post("/export")
async def export_distribution(
    wh_col:       str  = "wh_q",
    max_round:    int  = 10,
    division:     str  = "",
    exclude_zero: bool = False,
):
    """
    Export distribution result as Excel.
    division: if set, filter to this division only (used for per-division download)
    exclude_zero: if True, only rows where final_allocate > 0
    """
    import io
    from fastapi.responses import StreamingResponse

    _require_oracle()
    try:
        result = _get_export_df(wh_col, max_round)
        cols = _build_export_cols(max_round)
        avail = [c for c in cols if c in result.columns]
        out = result[avail].fillna(0)
        for c in out.select_dtypes(include="number").columns:
            out[c] = out[c].round(2)

        # Apply filters
        if exclude_zero and "final_allocate" in out.columns:
            out = out[out["final_allocate"] > 0]

        if division:
            out = _ensure_division_col(out)
            div_col = next((c for c in ["division", "div"] if c in out.columns), None)
            if div_col:
                out = out[out[div_col] == division]

        ts = time.strftime('%Y%m%d_%H%M%S')
        safe_div = division.replace("/", "_").replace(" ", "_") if division else ""
        suffix = f"_{safe_div}" if safe_div else ("_nonzero" if exclude_zero else "")
        filename = f"distribution{suffix}_{ts}.xlsx"

        buf = io.BytesIO()
        with pd.ExcelWriter(buf, engine="xlsxwriter") as writer:
            out.to_excel(writer, index=False, sheet_name="Distribution")
        buf.seek(0)

        return StreamingResponse(
            buf,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    except Exception as exc:
        logger.exception("export_distribution error")
        raise


@router.post("/export-csv")
async def export_distribution_csv(
    wh_col:       str  = "wh_q",
    max_round:    int  = 10,
    division:     str  = "",
    exclude_zero: bool = False,
):
    """
    Export distribution result as CSV.
    division: if set, filter to this division only
    exclude_zero: if True, only rows where final_allocate > 0
    """
    import io
    from fastapi.responses import StreamingResponse

    _require_oracle()
    try:
        result = _get_export_df(wh_col, max_round)
        cols = _build_export_cols(max_round)
        avail = [c for c in cols if c in result.columns]
        out = result[avail].fillna("")

        # Apply filters
        if exclude_zero and "final_allocate" in out.columns:
            try:
                out = out[pd.to_numeric(out["final_allocate"], errors="coerce").fillna(0) > 0]
            except Exception:
                pass

        if division:
            out = _ensure_division_col(out)
            div_col = next((c for c in ["division", "div"] if c in out.columns), None)
            if div_col:
                out = out[out[div_col] == division]

        ts = time.strftime('%Y%m%d_%H%M%S')
        safe_div = division.replace("/", "_").replace(" ", "_") if division else ""
        suffix = f"_{safe_div}" if safe_div else ("_nonzero" if exclude_zero else "")
        filename = f"distribution{suffix}_{ts}.csv"

        buf = io.StringIO()
        out.to_csv(buf, index=False)
        buf.seek(0)

        return StreamingResponse(
            iter([buf.getvalue()]),
            media_type="text/csv",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    except Exception as exc:
        logger.exception("export_csv error")
        raise
