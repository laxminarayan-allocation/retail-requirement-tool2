"""
Requirements Dashboard API — serves status and preview data for 12 Oracle views
grouped into 9 requirement categories.
"""
import logging
import time
from typing import Any, List, Optional

import pandas as pd
from fastapi import APIRouter, HTTPException, Query

from app.core.parquet_cache import has_output, get_meta, read_cache

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/req", tags=["req_dashboard"])


def _pivot_response(df: "Any", page: int = 0, limit: int = 500) -> dict:
    """Slice a filtered DataFrame and return a standard paginated pivot payload."""
    total = len(df)
    start = page * limit
    chunk = df.iloc[start: start + limit]
    return {
        "columns": list(chunk.columns),
        "rows": chunk.where(chunk.notna(), None).to_dict(orient="records"),
        "total_rows": total,
        "page": page,
        "limit": limit,
        "pages": max(1, -(-total // limit)),  # ceiling division
    }

# ── View registry ──────────────────────────────────────────────────────────────
REQ_VIEWS: list[dict] = [
    {"group": "WH_STOCK",    "owner": "CK_A2166", "obj": "V_WH_STOCK"},
    {"group": "MC_REQ",      "owner": "CK_A2166", "obj": "V_MC_REQ_APPS_2"},
    {"group": "MC_REQ",      "owner": "CK_A2166", "obj": "V_MC_REQ_GM"},
    {"group": "ART_REQ",     "owner": "CK_A2166", "obj": "V_ART_REQ_APPS"},
    {"group": "ART_REQ",     "owner": "CK_A2166", "obj": "V_ART_REQ_GM"},
    {"group": "MRP_REQ",     "owner": "CK_A2166", "obj": "V_MRP_REQ_APPS"},
    {"group": "BARCODE_REQ", "owner": "CK_A2166", "obj": "V_BARCODE_REQ_APPS_GRC_V2"},
    {"group": "BARCODE_REQ", "owner": "CK_A2166", "obj": "V_BARCODE_REQ_APPS_WMS_V2"},
    {"group": "SIZE_REQ",    "owner": "CK_A2166", "obj": "V_SZ_REQ_APPS"},
    {"group": "SPARKY_REQ",  "owner": "CK_A2166", "obj": "V_SPARKY_PBS_REQ"},
    {"group": "TABLE_REQ",   "owner": "CK_A2166", "obj": "V_TABLE_REQ_APPS"},
    {"group": "OPTION_REQ",  "owner": "CK_A2166", "obj": "V_OPTION_REQ_APPS"},
    {"group": "LIST_REQ",    "owner": "CK_A2166", "obj": "V_LIST_PBS_REQ"},
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


_SPARKY_SQL = """
WITH T_SPARKY_BASE AS (
    SELECT DEPARTMENT, ARTICLE_NAME, CAT4,
        COUNT(DISTINCT STORE_NAME) STORE_CNT,
        SUM(MAX_SLQ) MAX_SLQ, SUM(LM_SL_Q) LM_SL_Q, SUM(MTD_SL_Q) MTD_SL_Q,
        SUM(TTL_STK_Q) TTL_STK_Q, SUM(TO_Q) TO_Q,
        SUM(SPARKY_PBS) SPARKY_PBS, SUM(SPARKY_REQ) SPARKY_REQ
    FROM CK_A2166.V_SPARKY_PBS_REQ
    GROUP BY DEPARTMENT, ARTICLE_NAME, CAT4
),
T_WH_STK AS (
    SELECT DEPARTMENT, ARTICLE_NAME, CAT4,
        SUM(GRC_Q) GRC_Q, SUM(MSA_Q) MSA_Q, SUM(ALLOC_Q) ALLOC_Q,
        SUM(WMS_Q) WMS_Q, SUM(REST_DC_Q) REST_DC_Q
    FROM CK_A2166.V_WH_STOCK
    WHERE CAT2 = 'SPARKY'
    GROUP BY DEPARTMENT, ARTICLE_NAME, CAT4
),
T_PPO AS (
    SELECT DEPARTMENT, ARTICLE_NAME, CAT4, SUM(PPO_Q) PPO_Q
    FROM MISRETAIL.T_ALLOCATION_FOR_ALL_DIVISION
    WHERE CAT2 = 'SPARKY'
    GROUP BY DEPARTMENT, ARTICLE_NAME, CAT4
)
SELECT
    A.DEPARTMENT, A.ARTICLE_NAME, A.CAT4,
    A.STORE_CNT, A.LM_SL_Q, A.MTD_SL_Q, A.TTL_STK_Q, A.MAX_SLQ,
    A.SPARKY_PBS, A.SPARKY_REQ, A.TO_Q,
    NVL(B.GRC_Q,   0) GRC_Q,
    NVL(B.MSA_Q,   0) MSA_Q,
    NVL(B.ALLOC_Q, 0) ALLOC_Q,
    NVL(B.WMS_Q,   0) WMS_Q,
    NVL(B.REST_DC_Q, 0) REST_DC_Q,
    NVL(C.PPO_Q,   0) PPO_Q
FROM T_SPARKY_BASE A
LEFT JOIN T_WH_STK B
    ON A.DEPARTMENT = B.DEPARTMENT AND A.ARTICLE_NAME = B.ARTICLE_NAME AND A.CAT4 = B.CAT4
LEFT JOIN T_PPO C
    ON A.DEPARTMENT = C.DEPARTMENT AND A.ARTICLE_NAME = C.ARTICLE_NAME AND A.CAT4 = C.CAT4
ORDER BY A.DEPARTMENT, A.ARTICLE_NAME, A.CAT4
"""


_SPARKY_PARQUET_OWNER = "CK_A2166"
_SPARKY_PARQUET_OBJ  = "V_SPARKY_PIVOT"


def _fetch_sparky_to_parquet() -> None:
    """Fetch the full Sparky pivot from Oracle and cache to parquet."""
    try:
        from app.db.oracle import get_pool
        from app.core.parquet_cache import write_cache

        pool = get_pool()
        with pool.acquire() as conn:
            with conn.cursor() as cur:
                cur.execute(_SPARKY_SQL)
                cols = [c[0].lower() for c in cur.description]
                rows = cur.fetchall()
        df = pd.DataFrame(rows, columns=cols)
        write_cache(_SPARKY_PARQUET_OWNER, _SPARKY_PARQUET_OBJ, df)
        logger.info("sparky_pivot: cached %d rows to parquet", len(df))
    except Exception as exc:
        logger.warning("sparky_pivot: parquet fetch failed — %s", exc)


@router.get("/sparky_pivot")
def get_sparky_pivot(
    department: List[str] = Query(default=[]),
    article: Optional[str] = Query(None),
    cat4: Optional[str] = Query(None),
    page: int = Query(0, ge=0),
    limit: int = Query(500, ge=1, le=5000),
):
    """Serve Sparky Req pivot from parquet cache (falls back to live Oracle if not cached)."""
    from app.core.parquet_cache import has_output, read_cache

    # serve from parquet if available
    if has_output(_SPARKY_PARQUET_OWNER, _SPARKY_PARQUET_OBJ):
        df = read_cache(_SPARKY_PARQUET_OWNER, _SPARKY_PARQUET_OBJ)
    else:
        # first-time: fetch live and cache
        try:
            from app.db.oracle import get_pool
            pool = get_pool()
            with pool.acquire() as conn:
                with conn.cursor() as cur:
                    cur.execute(_SPARKY_SQL)
                    cols = [c[0].lower() for c in cur.description]
                    rows = cur.fetchall()
            df = pd.DataFrame(rows, columns=cols)
            from app.core.parquet_cache import write_cache
            write_cache(_SPARKY_PARQUET_OWNER, _SPARKY_PARQUET_OBJ, df)
        except Exception as exc:
            logger.exception("Sparky pivot live fetch error")
            raise HTTPException(status_code=500, detail=str(exc))

    if df is None or df.empty:
        raise HTTPException(status_code=404, detail="No Sparky data cached yet")

    if department:
        df = df[df["department"].isin(department)]
    if article:
        df = df[df["article_name"].str.contains(article, case=False, na=False)]
    if cat4:
        df = df[df["cat4"].str.contains(cat4, case=False, na=False)]

    return {"success": True, "data": _pivot_response(df, page, limit)}


# ── Store filter helper ────────────────────────────────────────────────────────

def _store_where(store_names: list) -> tuple:
    """Return (where_clause_str, bind_params_dict) for STORE_NAME IN filter."""
    if not store_names:
        return ("", {})
    placeholders = ", ".join(f":sn{i}" for i in range(len(store_names)))
    params = {f"sn{i}": sn for i, sn in enumerate(store_names)}
    return (f"WHERE STORE_NAME IN ({placeholders})", params)


# ── Size Req pivot ─────────────────────────────────────────────────────────────

def _build_size_sql(store_where: str) -> str:
    sw = store_where if store_where else "WHERE STORE_NAME NOT LIKE '%-WH-%'"
    sw_extra = "AND STORE_NAME NOT LIKE '%-WH-%'" if store_where else ""
    return f"""
WITH T_SZ_BASE AS (
    SELECT DEPARTMENT, DISPLAY_TYPE, ARTICLE_NAME, CAT4,
        COUNT(DISTINCT STORE_NAME) STORE_CNT,
        SUM(MTD) MTD_SL_Q, SUM(LM) LM_SL_Q,
        SUM(STK) TTL_STK_Q, SUM(ADJ_STK) ADJ_STK_Q,
        SUM(SZ_PBS) SZ_PBS, SUM(SZ_REQ) SZ_REQ
    FROM CK_A2166.V_SZ_REQ_APPS
    {sw} {sw_extra}
    GROUP BY DEPARTMENT, DISPLAY_TYPE, ARTICLE_NAME, CAT4
),
T_WH_STK AS (
    SELECT DEPARTMENT, DISPLAY_TYPE, ARTICLE_NAME, CAT4,
        SUM(GRC_Q) GRC_Q, SUM(MSA_Q) MSA_Q,
        SUM(ALLOC_Q) ALLOC_Q, SUM(WMS_Q) WMS_Q,
        SUM(REST_DC_Q) REST_DC_Q
    FROM CK_A2166.V_WH_STOCK
    GROUP BY DEPARTMENT, DISPLAY_TYPE, ARTICLE_NAME, CAT4
),
T_PPO AS (
    SELECT DEPARTMENT, ARTICLE_NAME, CAT4, SUM(PPO_Q) PPO_Q
    FROM MISRETAIL.T_ALLOCATION_FOR_ALL_DIVISION
    GROUP BY DEPARTMENT, ARTICLE_NAME, CAT4
),
T_ITEM_META AS (
    SELECT DISTINCT DEPARTMENT, DIVISION, ATTRIBUTE1
    FROM SSRK.ITEM_MV
)
SELECT
    A.DEPARTMENT, A.DISPLAY_TYPE, A.ARTICLE_NAME, A.CAT4,
    NVL(D.DIVISION,   'N/A') DIVISION,
    NVL(D.ATTRIBUTE1, 'N/A') ATTRIBUTE1,
    A.STORE_CNT, A.LM_SL_Q, A.MTD_SL_Q, A.TTL_STK_Q, A.ADJ_STK_Q,
    A.SZ_PBS, A.SZ_REQ,
    NVL(B.GRC_Q,    0) GRC_Q,
    NVL(B.MSA_Q,    0) MSA_Q,
    NVL(B.ALLOC_Q,  0) ALLOC_Q,
    NVL(B.WMS_Q,    0) WMS_Q,
    NVL(B.REST_DC_Q,0) REST_DC_Q,
    NVL(C.PPO_Q,    0) PPO_Q
FROM T_SZ_BASE A
LEFT JOIN T_WH_STK B
    ON A.DEPARTMENT = B.DEPARTMENT AND A.ARTICLE_NAME = B.ARTICLE_NAME AND A.CAT4 = B.CAT4
LEFT JOIN T_PPO C
    ON A.DEPARTMENT = C.DEPARTMENT AND A.ARTICLE_NAME = C.ARTICLE_NAME AND A.CAT4 = C.CAT4
LEFT JOIN T_ITEM_META D ON A.DEPARTMENT = D.DEPARTMENT
ORDER BY A.DEPARTMENT, A.DISPLAY_TYPE, A.ARTICLE_NAME, A.CAT4
"""

def _build_size_base_sql(store_where: str) -> str:
    """Size SQL without T_WH_STK CTE — WH cols joined from parquet in pandas."""
    sw = store_where if store_where else "WHERE STORE_NAME NOT LIKE '%-WH-%'"
    sw_extra = "AND STORE_NAME NOT LIKE '%-WH-%'" if store_where else ""
    return f"""
WITH T_SZ_BASE AS (
    SELECT DEPARTMENT, DISPLAY_TYPE, ARTICLE_NAME, CAT4,
        COUNT(DISTINCT STORE_NAME) STORE_CNT,
        SUM(MTD) MTD_SL_Q, SUM(LM) LM_SL_Q,
        SUM(STK) TTL_STK_Q, SUM(ADJ_STK) ADJ_STK_Q,
        SUM(SZ_PBS) SZ_PBS, SUM(SZ_REQ) SZ_REQ
    FROM CK_A2166.V_SZ_REQ_APPS
    {sw} {sw_extra}
    GROUP BY DEPARTMENT, DISPLAY_TYPE, ARTICLE_NAME, CAT4
),
T_PPO AS (
    SELECT DEPARTMENT, ARTICLE_NAME, CAT4, SUM(PPO_Q) PPO_Q
    FROM MISRETAIL.T_ALLOCATION_FOR_ALL_DIVISION
    GROUP BY DEPARTMENT, ARTICLE_NAME, CAT4
),
T_ITEM_META AS (
    SELECT DISTINCT DEPARTMENT, DIVISION, ATTRIBUTE1
    FROM SSRK.ITEM_MV
)
SELECT
    A.DEPARTMENT, A.DISPLAY_TYPE, A.ARTICLE_NAME, A.CAT4,
    NVL(D.DIVISION,   'N/A') DIVISION,
    NVL(D.ATTRIBUTE1, 'N/A') ATTRIBUTE1,
    A.STORE_CNT, A.LM_SL_Q, A.MTD_SL_Q, A.TTL_STK_Q, A.ADJ_STK_Q,
    A.SZ_PBS, A.SZ_REQ,
    NVL(C.PPO_Q, 0) PPO_Q
FROM T_SZ_BASE A
LEFT JOIN T_PPO C
    ON A.DEPARTMENT=C.DEPARTMENT AND A.ARTICLE_NAME=C.ARTICLE_NAME AND A.CAT4=C.CAT4
LEFT JOIN T_ITEM_META D ON A.DEPARTMENT=D.DEPARTMENT
ORDER BY A.DEPARTMENT, A.DISPLAY_TYPE, A.ARTICLE_NAME, A.CAT4
"""

_SIZE_PARQUET_OWNER = "CK_A2166"
_SIZE_PARQUET_OBJ   = "V_SIZE_PIVOT"


@router.get("/size_pivot")
def get_size_pivot(
    department:  Optional[str] = Query(None),
    article:     Optional[str] = Query(None),
    cat4:        Optional[str] = Query(None),
    division:    List[str]     = Query(default=[]),
    attribute1:  List[str]     = Query(default=[]),
    store_names: List[str]     = Query(default=[]),
    page: int = Query(0, ge=0),
    limit: int = Query(500, ge=1, le=5000),
):
    """Serve Size Req pivot from parquet cache (falls back to live Oracle if not cached)."""

    sw, sp = _store_where(store_names)

    def _fetch_size(sql_fn, params=None):
        from app.db.oracle import get_pool
        pool = get_pool()
        with pool.acquire() as conn:
            with conn.cursor() as cur:
                cur.execute(sql_fn, params or {})
                cols = [c[0].lower() for c in cur.description]
                rows = cur.fetchall()
        return _merge_wh(pd.DataFrame(rows, columns=cols), ["department", "article_name", "cat4"])

    if store_names:
        try:
            df = _fetch_size(_build_size_base_sql(sw), sp)
        except Exception as exc:
            logger.exception("Size pivot store-filtered fetch error")
            raise HTTPException(status_code=500, detail=str(exc))
    elif has_output(_SIZE_PARQUET_OWNER, _SIZE_PARQUET_OBJ):
        df = read_cache(_SIZE_PARQUET_OWNER, _SIZE_PARQUET_OBJ)
    else:
        try:
            from app.core.parquet_cache import write_cache as _wc
            df = _fetch_size(_build_size_base_sql(""))
            _wc(_SIZE_PARQUET_OWNER, _SIZE_PARQUET_OBJ, df)
        except Exception as exc:
            logger.exception("Size pivot live fetch error")
            raise HTTPException(status_code=500, detail=str(exc))

    if df is None or df.empty:
        raise HTTPException(status_code=404, detail="No Size data found")

    if department:
        df = df[df["department"].isin(department)]
    if article:
        df = df[df["article_name"].str.contains(article, case=False, na=False)]
    if cat4:
        df = df[df["cat4"].str.contains(cat4, case=False, na=False)]
    if division:
        df = df[df["division"].isin(division)]
    if attribute1:
        df = df[df["attribute1"].isin(attribute1)]

    return {"success": True, "data": _pivot_response(df, page, limit)}


# ── MRP Req pivot ──────────────────────────────────────────────────────────────

def _build_mrp_sql(store_where: str) -> str:
  sw = store_where if store_where else "WHERE STORE_NAME NOT LIKE '%-WH-%'"
  sw_extra = "AND STORE_NAME NOT LIKE '%-WH-%'" if store_where else ""
  return f"""
WITH T_MRP_BASE AS (
    SELECT DEPARTMENT, DISPLAY_TYPE, MRP, ARTICLE_NAME,
        COUNT(DISTINCT STORE_NAME) STORE_CNT,
        SUM(LM_SL_Q) LM_SL_Q, SUM(MTD_SL_Q) MTD_SL_Q,
        SUM(TTL_STK_Q) TTL_STK_Q, SUM(TO_Q) TO_Q,
        SUM(PBS) PBS, SUM(REQ) REQ
    FROM CK_A2166.V_MRP_REQ_APPS
    {sw} {sw_extra}
    GROUP BY DEPARTMENT, DISPLAY_TYPE, MRP, ARTICLE_NAME
),
T_WH_STK AS (
    SELECT DEPARTMENT, ARTICLE_NAME,
        SUM(GRC_Q) GRC_Q, SUM(MSA_Q) MSA_Q, SUM(ALLOC_Q) ALLOC_Q,
        SUM(WMS_Q) WMS_Q, SUM(REST_DC_Q) REST_DC_Q
    FROM CK_A2166.V_WH_STOCK
    GROUP BY DEPARTMENT, ARTICLE_NAME
),
T_PPO AS (
    SELECT DEPARTMENT, ARTICLE_NAME, SUM(PPO_Q) PPO_Q
    FROM MISRETAIL.T_ALLOCATION_FOR_ALL_DIVISION
    GROUP BY DEPARTMENT, ARTICLE_NAME
),
T_ITEM_META AS (
    SELECT DISTINCT DEPARTMENT, DIVISION, ATTRIBUTE1
    FROM SSRK.ITEM_MV
)
SELECT
    A.DEPARTMENT, A.DISPLAY_TYPE, A.MRP, A.ARTICLE_NAME,
    NVL(D.DIVISION,   'N/A') DIVISION,
    NVL(D.ATTRIBUTE1, 'N/A') ATTRIBUTE1,
    A.STORE_CNT, A.LM_SL_Q, A.MTD_SL_Q, A.TTL_STK_Q, A.TO_Q,
    A.PBS, A.REQ,
    NVL(B.GRC_Q,    0) GRC_Q,
    NVL(B.MSA_Q,    0) MSA_Q,
    NVL(B.ALLOC_Q,  0) ALLOC_Q,
    NVL(B.WMS_Q,    0) WMS_Q,
    NVL(B.REST_DC_Q,0) REST_DC_Q,
    NVL(C.PPO_Q,    0) PPO_Q
FROM T_MRP_BASE A
LEFT JOIN T_WH_STK B ON A.DEPARTMENT=B.DEPARTMENT AND A.ARTICLE_NAME=B.ARTICLE_NAME
LEFT JOIN T_PPO C ON A.DEPARTMENT=C.DEPARTMENT AND A.ARTICLE_NAME=C.ARTICLE_NAME
LEFT JOIN T_ITEM_META D ON A.DEPARTMENT=D.DEPARTMENT
ORDER BY A.DEPARTMENT, A.DISPLAY_TYPE, A.MRP, A.ARTICLE_NAME
"""

def _build_mrp_base_sql(store_where: str) -> str:
    sw = store_where if store_where else "WHERE STORE_NAME NOT LIKE '%-WH-%'"
    sw_extra = "AND STORE_NAME NOT LIKE '%-WH-%'" if store_where else ""
    return f"""
WITH T_MRP_BASE AS (
    SELECT DEPARTMENT, DISPLAY_TYPE, MRP, ARTICLE_NAME,
        COUNT(DISTINCT STORE_NAME) STORE_CNT,
        SUM(LM_SL_Q) LM_SL_Q, SUM(MTD_SL_Q) MTD_SL_Q,
        SUM(TTL_STK_Q) TTL_STK_Q, SUM(TO_Q) TO_Q,
        SUM(PBS) PBS, SUM(REQ) REQ
    FROM CK_A2166.V_MRP_REQ_APPS
    {sw} {sw_extra}
    GROUP BY DEPARTMENT, DISPLAY_TYPE, MRP, ARTICLE_NAME
),
T_PPO AS (
    SELECT DEPARTMENT, ARTICLE_NAME, SUM(PPO_Q) PPO_Q
    FROM MISRETAIL.T_ALLOCATION_FOR_ALL_DIVISION
    GROUP BY DEPARTMENT, ARTICLE_NAME
),
T_ITEM_META AS (
    SELECT DISTINCT DEPARTMENT, DIVISION, ATTRIBUTE1
    FROM SSRK.ITEM_MV
)
SELECT
    A.DEPARTMENT, A.DISPLAY_TYPE, A.MRP, A.ARTICLE_NAME,
    NVL(D.DIVISION,   'N/A') DIVISION,
    NVL(D.ATTRIBUTE1, 'N/A') ATTRIBUTE1,
    A.STORE_CNT, A.LM_SL_Q, A.MTD_SL_Q, A.TTL_STK_Q, A.TO_Q,
    A.PBS, A.REQ,
    NVL(C.PPO_Q, 0) PPO_Q
FROM T_MRP_BASE A
LEFT JOIN T_PPO C ON A.DEPARTMENT=C.DEPARTMENT AND A.ARTICLE_NAME=C.ARTICLE_NAME
LEFT JOIN T_ITEM_META D ON A.DEPARTMENT=D.DEPARTMENT
ORDER BY A.DEPARTMENT, A.DISPLAY_TYPE, A.MRP, A.ARTICLE_NAME
"""

_MRP_PARQUET_OWNER = "CK_A2166"
_MRP_PARQUET_OBJ   = "V_MRP_PIVOT"


@router.get("/mrp_pivot")
def get_mrp_pivot(
    department:   List[str]     = Query(default=[]),
    display_type: List[str]     = Query(default=[]),
    article:      Optional[str] = Query(None),
    division:     List[str]     = Query(default=[]),
    attribute1:   List[str]     = Query(default=[]),
    store_names:  List[str]     = Query(default=[]),
    page: int = Query(0, ge=0),
    limit: int = Query(500, ge=1, le=5000),
):
    sw, sp = _store_where(store_names)

    def _fetch_mrp(sql_fn, params=None):
        from app.db.oracle import get_pool
        pool = get_pool()
        with pool.acquire() as conn:
            with conn.cursor() as cur:
                cur.execute(sql_fn, params or {})
                cols = [c[0].lower() for c in cur.description]
                rows = cur.fetchall()
        return _merge_wh(pd.DataFrame(rows, columns=cols), ["department", "article_name"])

    if store_names:
        try:
            df = _fetch_mrp(_build_mrp_base_sql(sw), sp)
        except Exception as exc:
            logger.exception("MRP pivot store-filtered fetch error")
            raise HTTPException(status_code=500, detail=str(exc))
    elif has_output(_MRP_PARQUET_OWNER, _MRP_PARQUET_OBJ):
        df = read_cache(_MRP_PARQUET_OWNER, _MRP_PARQUET_OBJ)
    else:
        try:
            from app.core.parquet_cache import write_cache as _wc
            df = _fetch_mrp(_build_mrp_base_sql(""))
            _wc(_MRP_PARQUET_OWNER, _MRP_PARQUET_OBJ, df)
        except Exception as exc:
            logger.exception("MRP pivot live fetch error")
            raise HTTPException(status_code=500, detail=str(exc))
    if df is None or df.empty:
        raise HTTPException(status_code=404, detail="No MRP data found")
    if department:
        df = df[df["department"].isin(department)]
    if display_type:
        df = df[df["display_type"].isin(display_type)]
    if article:
        df = df[df["article_name"].str.contains(article, case=False, na=False)]
    if division:
        df = df[df["division"].isin(division)]
    if attribute1:
        df = df[df["attribute1"].isin(attribute1)]
    return {"success": True, "data": _pivot_response(df, page, limit)}


# ── Article Req pivot ──────────────────────────────────────────────────────────

def _build_art_sql(store_where: str) -> str:
  sw = store_where if store_where else "WHERE STORE_NAME NOT LIKE '%-WH-%'"
  sw_extra = "AND STORE_NAME NOT LIKE '%-WH-%'" if store_where else ""
  return f"""
WITH T_ART_BASE AS (
    SELECT DEPARTMENT, DISPLAY_TYPE, ARTICLE_NAME,
        COUNT(DISTINCT STORE_NAME) STORE_CNT,
        SUM(LM_SL_Q) LM_SL_Q, SUM(MTD_SL_Q) MTD_SL_Q,
        SUM(TTL_STK_Q) TTL_STK_Q, SUM(TO_Q) TO_Q,
        SUM(PBS) PBS, SUM(REQ) REQ
    FROM (
        SELECT STORE_NAME, DEPARTMENT, DISPLAY_TYPE, ARTICLE_NAME, LM_SL_Q, MTD_SL_Q, TTL_STK_Q, TO_Q, PBS, REQ FROM CK_A2166.V_ART_REQ_APPS
        UNION ALL
        SELECT STORE_NAME, DEPARTMENT, DISPLAY_TYPE, ARTICLE_NAME, LM_SL_Q, MTD_SL_Q, TTL_STK_Q, TO_Q, PBS, REQ FROM CK_A2166.V_ART_REQ_GM
    ) SRC
    {sw} {sw_extra}
    GROUP BY DEPARTMENT, DISPLAY_TYPE, ARTICLE_NAME
),
T_WH_STK AS (
    SELECT DEPARTMENT, ARTICLE_NAME,
        SUM(GRC_Q) GRC_Q, SUM(MSA_Q) MSA_Q, SUM(ALLOC_Q) ALLOC_Q,
        SUM(WMS_Q) WMS_Q, SUM(REST_DC_Q) REST_DC_Q
    FROM CK_A2166.V_WH_STOCK
    GROUP BY DEPARTMENT, ARTICLE_NAME
),
T_PPO AS (
    SELECT DEPARTMENT, ARTICLE_NAME, SUM(PPO_Q) PPO_Q
    FROM MISRETAIL.T_ALLOCATION_FOR_ALL_DIVISION
    GROUP BY DEPARTMENT, ARTICLE_NAME
),
T_ITEM_META AS (
    SELECT DISTINCT DEPARTMENT, DIVISION, ATTRIBUTE1
    FROM SSRK.ITEM_MV
)
SELECT
    A.DEPARTMENT, A.DISPLAY_TYPE, A.ARTICLE_NAME,
    NVL(D.DIVISION,   'N/A') DIVISION,
    NVL(D.ATTRIBUTE1, 'N/A') ATTRIBUTE1,
    A.STORE_CNT, A.LM_SL_Q, A.MTD_SL_Q, A.TTL_STK_Q, A.TO_Q,
    A.PBS, A.REQ,
    NVL(B.GRC_Q,    0) GRC_Q,
    NVL(B.MSA_Q,    0) MSA_Q,
    NVL(B.ALLOC_Q,  0) ALLOC_Q,
    NVL(B.WMS_Q,    0) WMS_Q,
    NVL(B.REST_DC_Q,0) REST_DC_Q,
    NVL(C.PPO_Q,    0) PPO_Q
FROM T_ART_BASE A
LEFT JOIN T_WH_STK B ON A.DEPARTMENT=B.DEPARTMENT AND A.ARTICLE_NAME=B.ARTICLE_NAME
LEFT JOIN T_PPO C ON A.DEPARTMENT=C.DEPARTMENT AND A.ARTICLE_NAME=C.ARTICLE_NAME
LEFT JOIN T_ITEM_META D ON A.DEPARTMENT=D.DEPARTMENT
ORDER BY A.DEPARTMENT, A.DISPLAY_TYPE, A.ARTICLE_NAME
"""

def _build_art_base_sql(store_where: str) -> str:
    sw = store_where if store_where else "WHERE STORE_NAME NOT LIKE '%-WH-%'"
    sw_extra = "AND STORE_NAME NOT LIKE '%-WH-%'" if store_where else ""
    return f"""
WITH T_ART_BASE AS (
    SELECT DEPARTMENT, DISPLAY_TYPE, ARTICLE_NAME,
        COUNT(DISTINCT STORE_NAME) STORE_CNT,
        SUM(LM_SL_Q) LM_SL_Q, SUM(MTD_SL_Q) MTD_SL_Q,
        SUM(TTL_STK_Q) TTL_STK_Q, SUM(TO_Q) TO_Q,
        SUM(PBS) PBS, SUM(REQ) REQ
    FROM (
        SELECT STORE_NAME, DEPARTMENT, DISPLAY_TYPE, ARTICLE_NAME, LM_SL_Q, MTD_SL_Q, TTL_STK_Q, TO_Q, PBS, REQ FROM CK_A2166.V_ART_REQ_APPS
        UNION ALL
        SELECT STORE_NAME, DEPARTMENT, DISPLAY_TYPE, ARTICLE_NAME, LM_SL_Q, MTD_SL_Q, TTL_STK_Q, TO_Q, PBS, REQ FROM CK_A2166.V_ART_REQ_GM
    ) SRC
    {sw} {sw_extra}
    GROUP BY DEPARTMENT, DISPLAY_TYPE, ARTICLE_NAME
),
T_PPO AS (
    SELECT DEPARTMENT, ARTICLE_NAME, SUM(PPO_Q) PPO_Q
    FROM MISRETAIL.T_ALLOCATION_FOR_ALL_DIVISION
    GROUP BY DEPARTMENT, ARTICLE_NAME
),
T_ITEM_META AS (
    SELECT DISTINCT DEPARTMENT, DIVISION, ATTRIBUTE1
    FROM SSRK.ITEM_MV
)
SELECT
    A.DEPARTMENT, A.DISPLAY_TYPE, A.ARTICLE_NAME,
    NVL(D.DIVISION,   'N/A') DIVISION,
    NVL(D.ATTRIBUTE1, 'N/A') ATTRIBUTE1,
    A.STORE_CNT, A.LM_SL_Q, A.MTD_SL_Q, A.TTL_STK_Q, A.TO_Q,
    A.PBS, A.REQ,
    NVL(C.PPO_Q, 0) PPO_Q
FROM T_ART_BASE A
LEFT JOIN T_PPO C ON A.DEPARTMENT=C.DEPARTMENT AND A.ARTICLE_NAME=C.ARTICLE_NAME
LEFT JOIN T_ITEM_META D ON A.DEPARTMENT=D.DEPARTMENT
ORDER BY A.DEPARTMENT, A.DISPLAY_TYPE, A.ARTICLE_NAME
"""

_ART_PARQUET_OWNER = "CK_A2166"
_ART_PARQUET_OBJ   = "V_ART_PIVOT_V2"


@router.get("/art_pivot")
def get_art_pivot(
    department:   List[str]     = Query(default=[]),
    display_type: List[str]     = Query(default=[]),
    article:      Optional[str] = Query(None),
    division:     List[str]     = Query(default=[]),
    attribute1:   List[str]     = Query(default=[]),
    store_names:  List[str]     = Query(default=[]),
    page: int = Query(0, ge=0),
    limit: int = Query(500, ge=1, le=5000),
):
    sw, sp = _store_where(store_names)

    def _fetch_art(sql_fn, params=None):
        from app.db.oracle import get_pool
        pool = get_pool()
        with pool.acquire() as conn:
            with conn.cursor() as cur:
                cur.execute(sql_fn, params or {})
                cols = [c[0].lower() for c in cur.description]
                rows = cur.fetchall()
        return _merge_wh(pd.DataFrame(rows, columns=cols), ["department", "article_name"])

    if store_names:
        try:
            df = _fetch_art(_build_art_base_sql(sw), sp)
        except Exception as exc:
            logger.exception("Art pivot store-filtered fetch error")
            raise HTTPException(status_code=500, detail=str(exc))
    elif has_output(_ART_PARQUET_OWNER, _ART_PARQUET_OBJ):
        df = read_cache(_ART_PARQUET_OWNER, _ART_PARQUET_OBJ)
    else:
        try:
            from app.core.parquet_cache import write_cache as _wc
            df = _fetch_art(_build_art_base_sql(""))
            _wc(_ART_PARQUET_OWNER, _ART_PARQUET_OBJ, df)
        except Exception as exc:
            logger.exception("Art pivot live fetch error")
            raise HTTPException(status_code=500, detail=str(exc))
    if df is None or df.empty:
        raise HTTPException(status_code=404, detail="No Article Req data found")
    if department:
        df = df[df["department"].isin(department)]
    if display_type:
        df = df[df["display_type"].isin(display_type)]
    if article:
        df = df[df["article_name"].str.contains(article, case=False, na=False)]
    if division:
        df = df[df["division"].isin(division)]
    if attribute1:
        df = df[df["attribute1"].isin(attribute1)]
    return {"success": True, "data": _pivot_response(df, page, limit)}


# ── MC Req pivot ───────────────────────────────────────────────────────────────

def _build_mc_sql(store_where: str) -> str:
  sw = store_where if store_where else "WHERE STORE_NAME NOT LIKE '%-WH-%'"
  sw_extra = "AND STORE_NAME NOT LIKE '%-WH-%'" if store_where else ""
  return f"""
WITH T_MC_BASE AS (
    SELECT DEPARTMENT, DISPLAY_TYPE,
        COUNT(DISTINCT STORE_NAME) STORE_CNT,
        SUM(LM_SL_Q) LM_SL_Q, SUM(MTD_SL_Q) MTD_SL_Q,
        SUM(TTL_STK_Q) TTL_STK_Q, SUM(TO_Q) TO_Q,
        SUM(PBS) PBS, SUM(REQ) REQ
    FROM (
        SELECT STORE_NAME, DEPARTMENT, DISPLAY_TYPE, LM_SL_Q, MTD_SL_Q, TTL_STK_Q, TO_Q, PBS, REQ FROM CK_A2166.V_MC_REQ_APPS_2
        UNION ALL
        SELECT STORE_NAME, DEPARTMENT, DISPLAY_TYPE, LM_SL_Q, MTD_SL_Q, TTL_STK_Q, TO_Q, PBS, REQ FROM CK_A2166.V_MC_REQ_GM
    ) SRC
    {sw} {sw_extra}
    GROUP BY DEPARTMENT, DISPLAY_TYPE
),
T_WH_STK AS (
    SELECT DEPARTMENT, DISPLAY_TYPE,
        SUM(GRC_Q) GRC_Q, SUM(MSA_Q) MSA_Q, SUM(ALLOC_Q) ALLOC_Q,
        SUM(WMS_Q) WMS_Q, SUM(REST_DC_Q) REST_DC_Q
    FROM CK_A2166.V_WH_STOCK
    GROUP BY DEPARTMENT, DISPLAY_TYPE
),
T_PPO AS (
    SELECT DEPARTMENT, SUM(PPO_Q) PPO_Q
    FROM MISRETAIL.T_ALLOCATION_FOR_ALL_DIVISION
    GROUP BY DEPARTMENT
),
T_ITEM_META AS (
    SELECT DISTINCT DEPARTMENT, DIVISION, ATTRIBUTE1
    FROM SSRK.ITEM_MV
)
SELECT
    A.DEPARTMENT, A.DISPLAY_TYPE,
    NVL(D.DIVISION,   'N/A') DIVISION,
    NVL(D.ATTRIBUTE1, 'N/A') ATTRIBUTE1,
    A.STORE_CNT, A.LM_SL_Q, A.MTD_SL_Q, A.TTL_STK_Q, A.TO_Q,
    A.PBS, A.REQ,
    NVL(B.GRC_Q,    0) GRC_Q,
    NVL(B.MSA_Q,    0) MSA_Q,
    NVL(B.ALLOC_Q,  0) ALLOC_Q,
    NVL(B.WMS_Q,    0) WMS_Q,
    NVL(B.REST_DC_Q,0) REST_DC_Q,
    NVL(C.PPO_Q,    0) PPO_Q
FROM T_MC_BASE A
LEFT JOIN T_WH_STK B ON A.DEPARTMENT=B.DEPARTMENT AND A.DISPLAY_TYPE=B.DISPLAY_TYPE
LEFT JOIN T_PPO C ON A.DEPARTMENT=C.DEPARTMENT
LEFT JOIN T_ITEM_META D ON A.DEPARTMENT=D.DEPARTMENT
ORDER BY A.DEPARTMENT, A.DISPLAY_TYPE
"""

def _build_mc_base_sql(store_where: str) -> str:
    sw = store_where if store_where else "WHERE STORE_NAME NOT LIKE '%-WH-%'"
    sw_extra = "AND STORE_NAME NOT LIKE '%-WH-%'" if store_where else ""
    return f"""
WITH T_MC_BASE AS (
    SELECT DEPARTMENT, DISPLAY_TYPE,
        COUNT(DISTINCT STORE_NAME) STORE_CNT,
        SUM(LM_SL_Q) LM_SL_Q, SUM(MTD_SL_Q) MTD_SL_Q,
        SUM(TTL_STK_Q) TTL_STK_Q, SUM(TO_Q) TO_Q,
        SUM(PBS) PBS, SUM(REQ) REQ
    FROM (
        SELECT STORE_NAME, DEPARTMENT, DISPLAY_TYPE, LM_SL_Q, MTD_SL_Q, TTL_STK_Q, TO_Q, PBS, REQ FROM CK_A2166.V_MC_REQ_APPS_2
        UNION ALL
        SELECT STORE_NAME, DEPARTMENT, DISPLAY_TYPE, LM_SL_Q, MTD_SL_Q, TTL_STK_Q, TO_Q, PBS, REQ FROM CK_A2166.V_MC_REQ_GM
    ) SRC
    {sw} {sw_extra}
    GROUP BY DEPARTMENT, DISPLAY_TYPE
),
T_PPO AS (
    SELECT DEPARTMENT, SUM(PPO_Q) PPO_Q
    FROM MISRETAIL.T_ALLOCATION_FOR_ALL_DIVISION
    GROUP BY DEPARTMENT
),
T_ITEM_META AS (
    SELECT DISTINCT DEPARTMENT, DIVISION, ATTRIBUTE1
    FROM SSRK.ITEM_MV
)
SELECT
    A.DEPARTMENT, A.DISPLAY_TYPE,
    NVL(D.DIVISION,   'N/A') DIVISION,
    NVL(D.ATTRIBUTE1, 'N/A') ATTRIBUTE1,
    A.STORE_CNT, A.LM_SL_Q, A.MTD_SL_Q, A.TTL_STK_Q, A.TO_Q,
    A.PBS, A.REQ,
    NVL(C.PPO_Q, 0) PPO_Q
FROM T_MC_BASE A
LEFT JOIN T_PPO C ON A.DEPARTMENT=C.DEPARTMENT
LEFT JOIN T_ITEM_META D ON A.DEPARTMENT=D.DEPARTMENT
ORDER BY A.DEPARTMENT, A.DISPLAY_TYPE
"""

_MC_PARQUET_OWNER = "CK_A2166"
_MC_PARQUET_OBJ   = "V_MC_PIVOT_V2"


@router.get("/mc_pivot")
def get_mc_pivot(
    department:   List[str]     = Query(default=[]),
    display_type: List[str]     = Query(default=[]),
    division:     List[str]     = Query(default=[]),
    attribute1:   List[str]     = Query(default=[]),
    store_names:  List[str]     = Query(default=[]),
    page: int = Query(0, ge=0),
    limit: int = Query(500, ge=1, le=5000),
):
    sw, sp = _store_where(store_names)

    def _fetch_mc(sql_fn, params=None):
        from app.db.oracle import get_pool
        pool = get_pool()
        with pool.acquire() as conn:
            with conn.cursor() as cur:
                cur.execute(sql_fn, params or {})
                cols = [c[0].lower() for c in cur.description]
                rows = cur.fetchall()
        return _merge_wh(pd.DataFrame(rows, columns=cols), ["department", "display_type"])

    if store_names:
        try:
            df = _fetch_mc(_build_mc_base_sql(sw), sp)
        except Exception as exc:
            logger.exception("MC pivot store-filtered fetch error")
            raise HTTPException(status_code=500, detail=str(exc))
    elif has_output(_MC_PARQUET_OWNER, _MC_PARQUET_OBJ):
        df = read_cache(_MC_PARQUET_OWNER, _MC_PARQUET_OBJ)
    else:
        try:
            from app.core.parquet_cache import write_cache as _wc
            df = _fetch_mc(_build_mc_base_sql(""))
            _wc(_MC_PARQUET_OWNER, _MC_PARQUET_OBJ, df)
        except Exception as exc:
            logger.exception("MC pivot live fetch error")
            raise HTTPException(status_code=500, detail=str(exc))
    if df is None or df.empty:
        raise HTTPException(status_code=404, detail="No MC Req data found")
    if department:
        df = df[df["department"].isin(department)]
    if display_type:
        df = df[df["display_type"].isin(display_type)]
    if division:
        df = df[df["division"].isin(division)]
    if attribute1:
        df = df[df["attribute1"].isin(attribute1)]
    return {"success": True, "data": _pivot_response(df, page, limit)}


# ── Filter meta (DIVISION + ATTRIBUTE1 options) ────────────────────────────────

_FILTER_META_SQL = """
SELECT DISTINCT DIVISION, ATTRIBUTE1, DEPARTMENT
FROM SSRK.ITEM_MV
WHERE DIVISION IS NOT NULL
ORDER BY DIVISION, ATTRIBUTE1, DEPARTMENT
"""
_FILTER_META_PARQUET_OWNER = "SSRK"
_FILTER_META_PARQUET_OBJ   = "ITEM_MV_FILTER_META_V2"


@router.get("/filter_meta")
def get_filter_meta():
    if has_output(_FILTER_META_PARQUET_OWNER, _FILTER_META_PARQUET_OBJ):
        df = read_cache(_FILTER_META_PARQUET_OWNER, _FILTER_META_PARQUET_OBJ)
    else:
        try:
            from app.db.oracle import get_pool
            from app.core.parquet_cache import write_cache as _wc
            pool = get_pool()
            with pool.acquire() as conn:
                with conn.cursor() as cur:
                    cur.execute(_FILTER_META_SQL)
                    cols = [c[0].lower() for c in cur.description]
                    rows = cur.fetchall()
            df = pd.DataFrame(rows, columns=cols)
            _wc(_FILTER_META_PARQUET_OWNER, _FILTER_META_PARQUET_OBJ, df)
        except Exception as exc:
            logger.exception("Filter meta fetch error")
            raise HTTPException(status_code=500, detail=str(exc))
    if df is None or df.empty:
        return {"success": True, "data": {"divisions": [], "attribute1s": [], "departments": [], "display_types": []}}
    divisions   = sorted(df["division"].dropna().unique().tolist())
    attribute1s = sorted(df["attribute1"].dropna().unique().tolist())
    departments = sorted(df["department"].dropna().unique().tolist()) if "department" in df.columns else []
    # derive display_types from MRP parquet cache (fast, no extra Oracle query)
    display_types: list = []
    try:
        if has_output(_MRP_PARQUET_OWNER, _MRP_PARQUET_OBJ):
            mrp_df = read_cache(_MRP_PARQUET_OWNER, _MRP_PARQUET_OBJ)
            if mrp_df is not None and "display_type" in mrp_df.columns:
                display_types = sorted(mrp_df["display_type"].dropna().unique().tolist())
    except Exception:
        pass
    return {"success": True, "data": {"divisions": divisions, "attribute1s": attribute1s, "departments": departments, "display_types": display_types}}


# ── Store names list ───────────────────────────────────────────────────────────

_STORE_NAMES_SQL = "SELECT DISTINCT STORE_NAME FROM CK_A2166.V_SZ_REQ_APPS WHERE STORE_NAME IS NOT NULL ORDER BY STORE_NAME"
_STORE_NAMES_PARQUET_OWNER = "CK_A2166"
_STORE_NAMES_PARQUET_OBJ   = "V_STORE_NAMES"


@router.get("/store_names")
def get_store_names():
    if has_output(_STORE_NAMES_PARQUET_OWNER, _STORE_NAMES_PARQUET_OBJ):
        df = read_cache(_STORE_NAMES_PARQUET_OWNER, _STORE_NAMES_PARQUET_OBJ)
    else:
        try:
            from app.db.oracle import get_pool
            from app.core.parquet_cache import write_cache as _wc
            pool = get_pool()
            with pool.acquire() as conn:
                with conn.cursor() as cur:
                    cur.execute(_STORE_NAMES_SQL)
                    rows = [r[0] for r in cur.fetchall()]
            df = pd.DataFrame(rows, columns=["store_name"])
            _wc(_STORE_NAMES_PARQUET_OWNER, _STORE_NAMES_PARQUET_OBJ, df)
        except Exception as exc:
            logger.exception("Store names fetch error")
            raise HTTPException(status_code=500, detail=str(exc))
    if df is None or df.empty:
        return {"success": True, "data": {"stores": []}}
    return {"success": True, "data": {"stores": df["store_name"].dropna().tolist()}}


# ── Barcode Req pivot (GRC + WMS combined) ─────────────────────────────────────

def _build_barcode_sql(store_where: str) -> str:
    sw = store_where if store_where else "WHERE STORE_NAME NOT LIKE '%-WH-%'"
    sw_extra = "AND STORE_NAME NOT LIKE '%-WH-%'" if store_where else ""
    return f"""
WITH T_GRC_BASE AS (
    SELECT DEPARTMENT, DISPLAY_TYPE, ARTICLE_NAME, MRP,
        COUNT(DISTINCT STORE_NAME) STORE_CNT,
        SUM(LM_SL_Q) LM_SL_Q, SUM(MTD_SL_Q) MTD_SL_Q,
        SUM(TTL_STK_Q) TTL_STK_Q, SUM(TO_Q) TO_Q,
        SUM(PBS) PBS, SUM(REQ) GRC_REQ,
        MAX(DIVISION) DIVISION, MAX(ATTRIBUTE1) ATTRIBUTE1
    FROM CK_A2166.V_BARCODE_REQ_APPS_GRC_V2
    {sw} {sw_extra}
    GROUP BY DEPARTMENT, DISPLAY_TYPE, ARTICLE_NAME, MRP
),
T_WMS_BASE AS (
    SELECT DEPARTMENT, ARTICLE_NAME, MRP,
        SUM(REQ) WMS_REQ
    FROM CK_A2166.V_BARCODE_REQ_APPS_WMS_V2
    {sw} {sw_extra}
    GROUP BY DEPARTMENT, ARTICLE_NAME, MRP
),
T_WH_STK AS (
    SELECT DEPARTMENT, ARTICLE_NAME,
        SUM(GRC_Q) GRC_Q, SUM(MSA_Q) MSA_Q, SUM(ALLOC_Q) ALLOC_Q,
        SUM(WMS_Q) WMS_Q, SUM(REST_DC_Q) REST_DC_Q
    FROM CK_A2166.V_WH_STOCK
    GROUP BY DEPARTMENT, ARTICLE_NAME
),
T_PPO AS (
    SELECT DEPARTMENT, ARTICLE_NAME, SUM(PPO_Q) PPO_Q
    FROM MISRETAIL.T_ALLOCATION_FOR_ALL_DIVISION
    GROUP BY DEPARTMENT, ARTICLE_NAME
)
SELECT
    A.DEPARTMENT, A.DISPLAY_TYPE, A.ARTICLE_NAME, A.MRP,
    NVL(A.DIVISION,   'N/A') DIVISION,
    NVL(A.ATTRIBUTE1, 'N/A') ATTRIBUTE1,
    A.STORE_CNT, A.LM_SL_Q, A.MTD_SL_Q, A.TTL_STK_Q, A.TO_Q,
    A.PBS, A.GRC_REQ,
    NVL(W.WMS_REQ,   0) WMS_REQ,
    NVL(B.GRC_Q,     0) GRC_Q,
    NVL(B.MSA_Q,     0) MSA_Q,
    NVL(B.ALLOC_Q,   0) ALLOC_Q,
    NVL(B.WMS_Q,     0) WMS_Q,
    NVL(B.REST_DC_Q, 0) REST_DC_Q,
    NVL(C.PPO_Q,     0) PPO_Q
FROM T_GRC_BASE A
LEFT JOIN T_WMS_BASE W ON A.DEPARTMENT=W.DEPARTMENT AND A.ARTICLE_NAME=W.ARTICLE_NAME AND A.MRP=W.MRP
LEFT JOIN T_WH_STK B ON A.DEPARTMENT=B.DEPARTMENT AND A.ARTICLE_NAME=B.ARTICLE_NAME
LEFT JOIN T_PPO C ON A.DEPARTMENT=C.DEPARTMENT AND A.ARTICLE_NAME=C.ARTICLE_NAME
ORDER BY A.DEPARTMENT, A.DISPLAY_TYPE, A.ARTICLE_NAME, A.MRP
"""

def _build_barcode_base_sql(store_where: str) -> str:
    sw = store_where if store_where else "WHERE STORE_NAME NOT LIKE '%-WH-%'"
    sw_extra = "AND STORE_NAME NOT LIKE '%-WH-%'" if store_where else ""
    return f"""
WITH T_GRC_BASE AS (
    SELECT DEPARTMENT, DISPLAY_TYPE, ARTICLE_NAME, MRP,
        COUNT(DISTINCT STORE_NAME) STORE_CNT,
        SUM(LM_SL_Q) LM_SL_Q, SUM(MTD_SL_Q) MTD_SL_Q,
        SUM(TTL_STK_Q) TTL_STK_Q, SUM(TO_Q) TO_Q,
        SUM(PBS) PBS, SUM(REQ) GRC_REQ,
        MAX(DIVISION) DIVISION, MAX(ATTRIBUTE1) ATTRIBUTE1
    FROM CK_A2166.V_BARCODE_REQ_APPS_GRC_V2
    {sw} {sw_extra}
    GROUP BY DEPARTMENT, DISPLAY_TYPE, ARTICLE_NAME, MRP
),
T_WMS_BASE AS (
    SELECT DEPARTMENT, ARTICLE_NAME, MRP,
        SUM(REQ) WMS_REQ
    FROM CK_A2166.V_BARCODE_REQ_APPS_WMS_V2
    {sw} {sw_extra}
    GROUP BY DEPARTMENT, ARTICLE_NAME, MRP
),
T_PPO AS (
    SELECT DEPARTMENT, ARTICLE_NAME, SUM(PPO_Q) PPO_Q
    FROM MISRETAIL.T_ALLOCATION_FOR_ALL_DIVISION
    GROUP BY DEPARTMENT, ARTICLE_NAME
)
SELECT
    A.DEPARTMENT, A.DISPLAY_TYPE, A.ARTICLE_NAME, A.MRP,
    NVL(A.DIVISION,   'N/A') DIVISION,
    NVL(A.ATTRIBUTE1, 'N/A') ATTRIBUTE1,
    A.STORE_CNT, A.LM_SL_Q, A.MTD_SL_Q, A.TTL_STK_Q, A.TO_Q,
    A.PBS, A.GRC_REQ,
    NVL(W.WMS_REQ,   0) WMS_REQ,
    NVL(C.PPO_Q,     0) PPO_Q
FROM T_GRC_BASE A
LEFT JOIN T_WMS_BASE W ON A.DEPARTMENT=W.DEPARTMENT AND A.ARTICLE_NAME=W.ARTICLE_NAME AND A.MRP=W.MRP
LEFT JOIN T_PPO C ON A.DEPARTMENT=C.DEPARTMENT AND A.ARTICLE_NAME=C.ARTICLE_NAME
ORDER BY A.DEPARTMENT, A.DISPLAY_TYPE, A.ARTICLE_NAME, A.MRP
"""

_BARCODE_PARQUET_OWNER = "CK_A2166"
_BARCODE_PARQUET_OBJ   = "V_BARCODE_PIVOT"
_OPTION_PARQUET_OWNER  = "CK_A2166"
_OPTION_PARQUET_OBJ    = "V_OPTION_PIVOT"
_LIST_PARQUET_OWNER    = "CK_A2166"
_LIST_PARQUET_OBJ      = "V_LIST_PIVOT"

# In-memory pivot cache: key -> (mtime, DataFrame)
# Auto-invalidated when the underlying parquet file changes (mtime differs).
_pivot_mem_cache: dict = {}


def _get_pivot_df(owner: str, obj: str):
    """Return cached DataFrame or read from parquet; invalidates when file is refreshed."""
    from app.core.parquet_cache import _pq_path
    key = f"{owner}__{obj}"
    pp = _pq_path(owner, obj)
    if not pp.exists():
        return None
    try:
        mtime = pp.stat().st_mtime
    except OSError:
        return None
    cached = _pivot_mem_cache.get(key)
    if cached is not None and cached[0] == mtime:
        return cached[1]  # cache hit
    df = read_cache(owner, obj)
    if df is not None:
        _pivot_mem_cache[key] = (mtime, df)
    return df


def invalidate_pivot_cache():
    """Clear all in-memory pivot caches (call after a parquet refresh)."""
    _pivot_mem_cache.clear()


_WH_STOCK_COLS = ["grc_q", "msa_q", "alloc_q", "wms_q", "rest_dc_q"]


def _wh_stock_agg(group_cols: list, cat2_filter: str = None) -> "Optional[pd.DataFrame]":
    """Aggregate V_WH_STOCK parquet by group_cols. Returns None if not cached."""
    wh = _get_pivot_df("CK_A2166", "V_WH_STOCK")
    if wh is None:
        return None
    wh = wh.copy()
    wh.columns = [c.lower() for c in wh.columns]
    if cat2_filter and "cat2" in wh.columns:
        wh = wh[wh["cat2"] == cat2_filter]
    avail_group = [c for c in group_cols if c in wh.columns]
    agg_cols = [c for c in _WH_STOCK_COLS if c in wh.columns]
    if not avail_group or not agg_cols:
        return None
    return wh.groupby(avail_group)[agg_cols].sum().reset_index()


def _merge_wh(df: pd.DataFrame, join_cols: list, cat2_filter: str = None) -> pd.DataFrame:
    """Left-join aggregated WH_STOCK parquet to df; fill missing WH cols with 0."""
    wh_agg = _wh_stock_agg(join_cols, cat2_filter)
    if wh_agg is None:
        for col in _WH_STOCK_COLS:
            if col not in df.columns:
                df[col] = 0
        return df
    wh_cols = [c for c in _WH_STOCK_COLS if c in wh_agg.columns]
    merged = df.merge(wh_agg, on=join_cols, how="left", suffixes=("", "_wh"))
    for col in wh_cols:
        merged[col] = merged[col].fillna(0)
    return merged


def warm_req_pivots():
    """Pre-load barcode/option/list pivot parquets into memory. Call from startup warmup."""
    pairs = [
        (_BARCODE_PARQUET_OWNER, _BARCODE_PARQUET_OBJ),
        (_OPTION_PARQUET_OWNER,  _OPTION_PARQUET_OBJ),
        (_LIST_PARQUET_OWNER,    _LIST_PARQUET_OBJ),
    ]
    loaded = []
    for owner, obj in pairs:
        try:
            df = _get_pivot_df(owner, obj)
            if df is not None:
                loaded.append(f"{obj}({len(df)}rows)")
        except Exception as exc:
            logger.warning("Warmup: failed to load %s__%s: %s", owner, obj, exc)
    return loaded


@router.get("/barcode_pivot")
def get_barcode_pivot(
    department:   List[str]     = Query(default=[]),
    display_type: List[str]     = Query(default=[]),
    article:      Optional[str] = Query(None),
    division:     List[str]     = Query(default=[]),
    attribute1:   List[str]     = Query(default=[]),
    store_names:  List[str]     = Query(default=[]),
    page: int = Query(0, ge=0),
    limit: int = Query(500, ge=1, le=5000),
):
    sw, sp = _store_where(store_names)

    def _fetch_barcode(sql_fn, params=None):
        from app.db.oracle import get_pool
        pool = get_pool()
        with pool.acquire() as conn:
            with conn.cursor() as cur:
                cur.execute(sql_fn, params or {})
                cols = [c[0].lower() for c in cur.description]
                rows = cur.fetchall()
        return _merge_wh(pd.DataFrame(rows, columns=cols), ["department", "article_name"])

    if store_names:
        try:
            df = _fetch_barcode(_build_barcode_base_sql(sw), sp)
        except Exception as exc:
            logger.exception("Barcode pivot store-filtered fetch error")
            raise HTTPException(status_code=500, detail=str(exc))
    else:
        df = _get_pivot_df(_BARCODE_PARQUET_OWNER, _BARCODE_PARQUET_OBJ)
        if df is None:
            try:
                from app.core.parquet_cache import write_cache as _wc
                df = _fetch_barcode(_build_barcode_base_sql(""))
                _wc(_BARCODE_PARQUET_OWNER, _BARCODE_PARQUET_OBJ, df)
            except Exception as exc:
                logger.exception("Barcode pivot live fetch error")
                raise HTTPException(status_code=500, detail=str(exc))
    if df is None or df.empty:
        raise HTTPException(status_code=404, detail="No Barcode Req data found")
    if department:
        df = df[df["department"].isin(department)]
    if display_type:
        df = df[df["display_type"].isin(display_type)]
    if article:
        df = df[df["article_name"].str.contains(article, case=False, na=False)]
    if division:
        df = df[df["division"].isin(division)]
    if attribute1:
        df = df[df["attribute1"].isin(attribute1)]
    return {"success": True, "data": _pivot_response(df, page, limit)}


# ── Option Req pivot ───────────────────────────────────────────────────────────

def _build_option_sql(store_where: str) -> str:
    sw = store_where if store_where else "WHERE STORE_NAME NOT LIKE '%-WH-%'"
    sw_extra = "AND STORE_NAME NOT LIKE '%-WH-%'" if store_where else ""
    return f"""
WITH T_OPTION_BASE AS (
    SELECT DEPARTMENT, DISPLAY_TYPE, OPTION_LEVEL, ALLOCATION_OPTION,
        COUNT(DISTINCT STORE_NAME) STORE_CNT,
        SUM(LM_SL_Q) LM_SL_Q, SUM(MTD_SL_Q) MTD_SL_Q,
        SUM(TTL_STK_Q) TTL_STK_Q, SUM(TTL_STK_Q_ADJ) TTL_STK_Q_ADJ,
        SUM(PBS) PBS, SUM(OPTION_PBS) OPTION_PBS, SUM(OPTION_REQ) OPTION_REQ,
        MAX(DIVISION) DIVISION, MAX(ATTRIBUTE1) ATTRIBUTE1
    FROM CK_A2166.V_OPTION_REQ_APPS
    {sw} {sw_extra}
    GROUP BY DEPARTMENT, DISPLAY_TYPE, OPTION_LEVEL, ALLOCATION_OPTION
)
SELECT
    A.DEPARTMENT, A.DISPLAY_TYPE, A.OPTION_LEVEL, A.ALLOCATION_OPTION,
    NVL(A.DIVISION,   'N/A') DIVISION,
    NVL(A.ATTRIBUTE1, 'N/A') ATTRIBUTE1,
    A.STORE_CNT, A.LM_SL_Q, A.MTD_SL_Q, A.TTL_STK_Q, A.TTL_STK_Q_ADJ,
    A.PBS, A.OPTION_PBS, A.OPTION_REQ
FROM T_OPTION_BASE A
ORDER BY A.DEPARTMENT, A.DISPLAY_TYPE, A.OPTION_LEVEL, A.ALLOCATION_OPTION
"""

_OPTION_PARQUET_OWNER = "CK_A2166"
_OPTION_PARQUET_OBJ   = "V_OPTION_PIVOT"


@router.get("/option_pivot")
def get_option_pivot(
    department:   List[str]     = Query(default=[]),
    display_type: List[str]     = Query(default=[]),
    division:     List[str]     = Query(default=[]),
    attribute1:   List[str]     = Query(default=[]),
    store_names:  List[str]     = Query(default=[]),
    page: int = Query(0, ge=0),
    limit: int = Query(500, ge=1, le=5000),
):
    sw, sp = _store_where(store_names)
    if store_names:
        try:
            from app.db.oracle import get_pool
            pool = get_pool()
            with pool.acquire() as conn:
                with conn.cursor() as cur:
                    cur.execute(_build_option_sql(sw), sp)
                    cols = [c[0].lower() for c in cur.description]
                    rows = cur.fetchall()
            df = pd.DataFrame(rows, columns=cols)
        except Exception as exc:
            logger.exception("Option pivot store-filtered fetch error")
            raise HTTPException(status_code=500, detail=str(exc))
    else:
        df = _get_pivot_df(_OPTION_PARQUET_OWNER, _OPTION_PARQUET_OBJ)
        if df is None:
            try:
                from app.db.oracle import get_pool
                from app.core.parquet_cache import write_cache as _wc
                pool = get_pool()
                with pool.acquire() as conn:
                    with conn.cursor() as cur:
                        cur.execute(_build_option_sql(""))
                        cols = [c[0].lower() for c in cur.description]
                        rows = cur.fetchall()
                df = pd.DataFrame(rows, columns=cols)
                _wc(_OPTION_PARQUET_OWNER, _OPTION_PARQUET_OBJ, df)
            except Exception as exc:
                logger.exception("Option pivot live fetch error")
                raise HTTPException(status_code=500, detail=str(exc))
    if df is None or df.empty:
        raise HTTPException(status_code=404, detail="No Option Req data found")
    if department:
        df = df[df["department"].isin(department)]
    if display_type:
        df = df[df["display_type"].isin(display_type)]
    if division:
        df = df[df["division"].isin(division)]
    if attribute1:
        df = df[df["attribute1"].isin(attribute1)]
    return {"success": True, "data": _pivot_response(df, page, limit)}


# ── List Req pivot ─────────────────────────────────────────────────────────────

def _build_list_sql(store_where: str) -> str:
    sw = store_where if store_where else "WHERE STORE_NAME NOT LIKE '%-WH-%'"
    sw_extra = "AND STORE_NAME NOT LIKE '%-WH-%'" if store_where else ""
    return f"""
WITH T_LIST_BASE AS (
    SELECT DEPARTMENT, DISPLAY_TYPE, ARTICLE_NAME, MRP, LIST_TAG,
        COUNT(DISTINCT STORE_NAME) STORE_CNT,
        SUM(LIST_Q) LIST_Q, SUM(ADJ_TTL_STK_Q) ADJ_TTL_STK_Q,
        SUM(LIST_REQ) LIST_REQ
    FROM CK_A2166.V_LIST_PBS_REQ
    {sw} {sw_extra}
    GROUP BY DEPARTMENT, DISPLAY_TYPE, ARTICLE_NAME, MRP, LIST_TAG
)
SELECT
    A.DEPARTMENT, A.DISPLAY_TYPE, A.ARTICLE_NAME, A.MRP, A.LIST_TAG,
    A.STORE_CNT, A.LIST_Q, A.ADJ_TTL_STK_Q, A.LIST_REQ
FROM T_LIST_BASE A
ORDER BY A.DEPARTMENT, A.DISPLAY_TYPE, A.ARTICLE_NAME, A.MRP, A.LIST_TAG
"""

_LIST_PARQUET_OWNER = "CK_A2166"
_LIST_PARQUET_OBJ   = "V_LIST_PIVOT"


@router.get("/list_pivot")
def get_list_pivot(
    department:   List[str]     = Query(default=[]),
    display_type: List[str]     = Query(default=[]),
    article:      Optional[str] = Query(None),
    store_names:  List[str]     = Query(default=[]),
    page: int = Query(0, ge=0),
    limit: int = Query(500, ge=1, le=5000),
):
    sw, sp = _store_where(store_names)
    if store_names:
        try:
            from app.db.oracle import get_pool
            pool = get_pool()
            with pool.acquire() as conn:
                with conn.cursor() as cur:
                    cur.execute(_build_list_sql(sw), sp)
                    cols = [c[0].lower() for c in cur.description]
                    rows = cur.fetchall()
            df = pd.DataFrame(rows, columns=cols)
        except Exception as exc:
            logger.exception("List pivot store-filtered fetch error")
            raise HTTPException(status_code=500, detail=str(exc))
    else:
        df = _get_pivot_df(_LIST_PARQUET_OWNER, _LIST_PARQUET_OBJ)
        if df is None:
            try:
                from app.db.oracle import get_pool
                from app.core.parquet_cache import write_cache as _wc
                pool = get_pool()
                with pool.acquire() as conn:
                    with conn.cursor() as cur:
                        cur.execute(_build_list_sql(""))
                        cols = [c[0].lower() for c in cur.description]
                        rows = cur.fetchall()
                df = pd.DataFrame(rows, columns=cols)
                _wc(_LIST_PARQUET_OWNER, _LIST_PARQUET_OBJ, df)
            except Exception as exc:
                logger.exception("List pivot live fetch error")
                raise HTTPException(status_code=500, detail=str(exc))
    if df is None or df.empty:
        raise HTTPException(status_code=404, detail="No List Req data found")
    if department:
        df = df[df["department"].isin(department)]
    if display_type:
        df = df[df["display_type"].isin(display_type)]
    if article:
        df = df[df["article_name"].str.contains(article, case=False, na=False)]
    return {"success": True, "data": _pivot_response(df, page, limit)}
