"""
Requirements Dashboard API — serves status and preview data for 12 Oracle views
grouped into 9 requirement categories.
"""
import logging
import time
from typing import Any

from fastapi import APIRouter, HTTPException, Query

from app.core.parquet_cache import has_output, get_meta, read_cache

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/req", tags=["req_dashboard"])

# ── View registry ──────────────────────────────────────────────────────────────
REQ_VIEWS: list[dict] = [
    {"group": "MC_REQ",      "label": "V_MC_REQ_APPS_2",           "desc": "MC Requirement (APPS)",       "owner": "CK_A2166", "obj": "V_MC_REQ_APPS_2"},
    {"group": "MC_REQ",      "label": "V_MC_REQ_GM",               "desc": "MC Requirement (GM)",         "owner": "CK_A2166", "obj": "V_MC_REQ_GM"},
    {"group": "ART_REQ",     "label": "V_ART_REQ_APPS",            "desc": "Article Requirement (APPS)",  "owner": "CK_A2166", "obj": "V_ART_REQ_APPS"},
    {"group": "ART_REQ",     "label": "V_ART_REQ_GM",              "desc": "Article Requirement (GM)",    "owner": "CK_A2166", "obj": "V_ART_REQ_GM"},
    {"group": "MRP_REQ",     "label": "V_MRP_REQ_APPS",            "desc": "MRP Requirement (APPS)",      "owner": "CK_A2166", "obj": "V_MRP_REQ_APPS"},
    {"group": "BARCODE_REQ", "label": "V_BARCODE_REQ_APPS_GRC_V2", "desc": "Barcode Requirement (GRC)",   "owner": "CK_A2166", "obj": "V_BARCODE_REQ_APPS_GRC_V2"},
    {"group": "BARCODE_REQ", "label": "V_BARCODE_REQ_APPS_WMS_V2", "desc": "Barcode Requirement (WMS)",   "owner": "CK_A2166", "obj": "V_BARCODE_REQ_APPS_WMS_V2"},
    {"group": "SIZE_REQ",    "label": "V_SZ_REQ_APPS",             "desc": "Size Requirement (APPS)",     "owner": "CK_A2166", "obj": "V_SZ_REQ_APPS"},
    {"group": "SPARKY_REQ",  "label": "V_SPARKY_PBS_REQ",          "desc": "Sparky PBS Requirement",      "owner": "CK_A2166", "obj": "V_SPARKY_PBS_REQ"},
    {"group": "TABLE_REQ",   "label": "V_TABLE_REQ_APPS",          "desc": "Table Requirement (APPS)",    "owner": "CK_A2166", "obj": "V_TABLE_REQ_APPS"},
    {"group": "OPTION_REQ",  "label": "V_OPTION_REQ_APPS",         "desc": "Option Requirement (APPS)",   "owner": "CK_A2166", "obj": "V_OPTION_REQ_APPS"},
    {"group": "LIST_REQ",    "label": "V_LIST_PBS_REQ",            "desc": "List PBS Requirement",        "owner": "CK_A2166", "obj": "V_LIST_PBS_REQ"},
]

_PREVIEW_CACHE: dict[str, tuple[float, Any]] = {}
_PREVIEW_TTL = 300  # 5 min


@router.post("/refresh")
def trigger_refresh():
    """Manually trigger a full refresh of all 12 views (runs in background thread)."""
    import threading
    from app.core.req_scheduler import refresh_all
    threading.Thread(target=refresh_all, daemon=True, name="req-manual-refresh").start()
    return {"success": True, "message": "Refresh started in background — check /status for progress"}


@router.get("/status")
def get_status():
    """Return cache status for all 12 views."""
    result = []
    for v in REQ_VIEWS:
        meta = get_meta(v["owner"], v["obj"]) if has_output(v["owner"], v["obj"]) else None
        result.append({
            "group":     v["group"],
            "label":     v["label"],
            "desc":      v["desc"],
            "owner":     v["owner"],
            "obj":       v["obj"],
            "cached":    meta is not None,
            "rows":      meta["rows"] if meta else None,
            "columns":   meta["columns"] if meta else None,
            "fetched_at": meta["fetched_at"] if meta else None,
        })
    return {"success": True, "data": result}


@router.get("/preview")
def get_preview(
    owner: str = Query(...),
    obj: str = Query(...),
    limit: int = Query(200, ge=1, le=1000),
):
    """Return first N rows of a cached view as JSON records."""
    key = f"{owner.upper()}__{obj.upper()}__{limit}"
    now = time.time()
    if key in _PREVIEW_CACHE and now - _PREVIEW_CACHE[key][0] < _PREVIEW_TTL:
        return {"success": True, "data": _PREVIEW_CACHE[key][1]}

    if not has_output(owner, obj):
        raise HTTPException(status_code=404, detail="Data not cached yet — run refresh first")

    try:
        df = read_cache(owner, obj)
        if df is None or df.empty:
            raise HTTPException(status_code=404, detail="Cached data is empty")
        rows = df.head(limit).where(df.notna(), None).to_dict(orient="records")
        cols = list(df.columns)
        payload = {"columns": cols, "rows": rows, "total_rows": len(df)}
        _PREVIEW_CACHE[key] = (now, payload)
        return {"success": True, "data": payload}
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Preview error for %s.%s", owner, obj)
        raise HTTPException(status_code=500, detail=str(exc))
