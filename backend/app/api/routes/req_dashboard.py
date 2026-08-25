"""
Requirements Dashboard API — serves status and preview data for 12 Oracle views
grouped into 9 requirement categories.
"""
import logging
import time
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Query

from app.core.parquet_cache import has_output, get_meta, read_cache

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/req", tags=["req_dashboard"])

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
        import pandas as pd

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
    department: Optional[str] = Query(None),
    article: Optional[str] = Query(None),
    cat4: Optional[str] = Query(None),
):
    """Serve Sparky Req pivot from parquet cache (falls back to live Oracle if not cached)."""
    from app.core.parquet_cache import has_output, read_cache
    import pandas as pd

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
        df = df[df["department"].str.contains(department, case=False, na=False)]
    if article:
        df = df[df["article_name"].str.contains(article, case=False, na=False)]
    if cat4:
        df = df[df["cat4"].str.contains(cat4, case=False, na=False)]

    payload = {
        "columns": list(df.columns),
        "rows": df.where(df.notna(), None).to_dict(orient="records"),
        "total_rows": len(df),
    }
    return {"success": True, "data": payload}


# ── Size Req pivot ─────────────────────────────────────────────────────────────

_SIZE_SQL = """
WITH T_SZ_BASE AS (
    SELECT DEPARTMENT, DISPLAY_TYPE, ARTICLE_NAME, CAT4,
        COUNT(DISTINCT STORE_NAME) STORE_CNT,
        SUM(MTD) MTD_SL_Q, SUM(LM) LM_SL_Q,
        SUM(STK) TTL_STK_Q, SUM(ADJ_STK) ADJ_STK_Q,
        SUM(SZ_PBS) SZ_PBS, SUM(SZ_REQ) SZ_REQ
    FROM CK_A2166.V_SZ_REQ_APPS
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
)
SELECT
    A.DEPARTMENT, A.DISPLAY_TYPE, A.ARTICLE_NAME, A.CAT4,
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
ORDER BY A.DEPARTMENT, A.DISPLAY_TYPE, A.ARTICLE_NAME, A.CAT4
"""

_SIZE_PARQUET_OWNER = "CK_A2166"
_SIZE_PARQUET_OBJ   = "V_SIZE_PIVOT"


@router.get("/size_pivot")
def get_size_pivot(
    department: Optional[str] = Query(None),
    article:    Optional[str] = Query(None),
    cat4:       Optional[str] = Query(None),
):
    """Serve Size Req pivot from parquet cache (falls back to live Oracle if not cached)."""
    import pandas as pd

    if has_output(_SIZE_PARQUET_OWNER, _SIZE_PARQUET_OBJ):
        df = read_cache(_SIZE_PARQUET_OWNER, _SIZE_PARQUET_OBJ)
    else:
        try:
            from app.db.oracle import get_pool
            from app.core.parquet_cache import write_cache as _wc
            pool = get_pool()
            with pool.acquire() as conn:
                with conn.cursor() as cur:
                    cur.execute(_SIZE_SQL)
                    cols = [c[0].lower() for c in cur.description]
                    rows = cur.fetchall()
            df = pd.DataFrame(rows, columns=cols)
            _wc(_SIZE_PARQUET_OWNER, _SIZE_PARQUET_OBJ, df)
        except Exception as exc:
            logger.exception("Size pivot live fetch error")
            raise HTTPException(status_code=500, detail=str(exc))

    if df is None or df.empty:
        raise HTTPException(status_code=404, detail="No Size data cached yet")

    if department:
        df = df[df["department"].str.contains(department, case=False, na=False)]
    if article:
        df = df[df["article_name"].str.contains(article, case=False, na=False)]
    if cat4:
        df = df[df["cat4"].str.contains(cat4, case=False, na=False)]

    return {"success": True, "data": {
        "columns": list(df.columns),
        "rows": df.where(df.notna(), None).to_dict(orient="records"),
        "total_rows": len(df),
    }}
