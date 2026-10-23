"""
Parquet Data Store — Oracle → local .parquet cache layer.

Storage is unified with parquet_cache (backend/data/output/).
Each source is stored as DS__<KEY>.parquet via parquet_cache with owner="DS".

Public API is unchanged; consumers (data_store, item_repository, store_repository,
sale) do not need modification.  The old hardcoded D:\\DataStore path is gone.
"""

from __future__ import annotations

import logging
import threading
from datetime import datetime, timedelta, timezone

logger = logging.getLogger(__name__)

IST = timezone(timedelta(hours=5, minutes=30))

_DS_OWNER = "DS"

# ── Source registry ────────────────────────────────────────────────────────────
SOURCES: list[dict] = [
    {
        "key": "store_master",
        "label": "Store Master",
        "table": "MISRETAIL.T_STORE_OPENING_DATE",
        "schedule": "weekly",
        "sql": """
            SELECT s.SITE_CODE, s.STORE_NAME, s.STORE_GRADE, s.STORE_TAG,
                   s.CITY_NAME, s.STATE, s.DISTRICT, s.CLUSTER_TYPE,
                   s.OPENING_DATE, s.STORE_STATUS,
                   v.ZONE, v.LOCATION, v.STORE_NAME AS VM_STORE_NAME
            FROM MISRETAIL.T_STORE_OPENING_DATE s
            LEFT JOIN CK_A2166.V_STORE_MASTER v ON v.SITECODE = s.SITE_CODE
        """,
    },
    {
        "key": "item_master",
        "label": "Item Master",
        "table": "REPORT.V_ITEM_MASTER",
        "schedule": "daily",
        "sql": """
            SELECT ICODE, DIVISION, SECTION, DEPARTMENT, DISPLAY_TYPE,
                   ARTICLE_NAME, DESC6_FILTER, MRP, SZ_GRP,
                   ATTRIBUTE1, COLOR, CONCEPT_NEW, DESC3, CAT1, SEASON
            FROM REPORT.V_ITEM_MASTER
            WHERE SUBSTR(SEASON,1,4) IN ('AW26','SS26')
              AND DIVISION IN ('KIDS','LADIES','MENS')
              AND ATTRIBUTE1 IN ('LT WINTER','PREWINTER')
        """,
    },
    {
        "key": "grc_raw",
        "label": "GRC Raw",
        "table": "MISRETAIL.CUBE$PURCHASE",
        "schedule": "daily",
        "sql": """
            SELECT TRUNC(ENTRY_DATE,'DD') GRC_DATE, SITECODE, BARCODE,
                   SUM(ENTRY_QTY) AS GRC_QTY, SUM(NETAMT) AS GRC_NETAMT
            FROM MISRETAIL.CUBE$PURCHASE
            WHERE CUBENAME = 'GRC_ANA'
              AND TRUNC(ENTRY_DATE,'DD') >= TRUNC(SYSDATE) - 365
              AND TRUNC(ENTRY_DATE,'DD') <= TRUNC(SYSDATE) - 1
              AND BARCODE IN (
                  SELECT DISTINCT ICODE FROM REPORT.V_ITEM_MASTER
                  WHERE SUBSTR(SEASON,1,4) IN ('AW26','SS26')
                    AND DIVISION IN ('KIDS','LADIES','MENS')
                    AND ATTRIBUTE1 IN ('LT WINTER','PREWINTER')
              )
            GROUP BY TRUNC(ENTRY_DATE,'DD'), SITECODE, BARCODE
        """,
    },
    {
        "key": "sale_raw",
        "label": "SALE Raw",
        "table": "MISRETAIL.T_CUSTOM_COGS",
        "schedule": "daily",
        "sql": """
            SELECT TRUNC(BILLDATE,'DD') SALE_DATE, SITECODE, BARCODE AS ICODE,
                   SUM(CUSTOM_SL_Q) AS SALE_QTY, SUM(CUSTOM_SL_V) AS SALE_NETAMT
            FROM MISRETAIL.T_CUSTOM_COGS
            WHERE TRUNC(BILLDATE,'DD') >= TRUNC(SYSDATE) - 730
              AND TRUNC(BILLDATE,'DD') <= TRUNC(SYSDATE) - 1
            GROUP BY TRUNC(BILLDATE,'DD'), SITECODE, BARCODE
        """,
    },
    {
        "key": "req_raw",
        "label": "REQ Raw (MRP Req)",
        "table": "CK_A2166.V_MRP_REQ_APPS_PW",
        "schedule": "daily",
        "sql": """
            SELECT * FROM CK_A2166.V_MRP_REQ_APPS_PW
            WHERE REQ > 0 AND ATTRIBUTE1 IN ('LT WINTER','PREWINTER')
        """,
    },
    {
        "key": "art_grid",
        "label": "Article Grid",
        "table": "REPORT.T_GRID",
        "schedule": "daily",
        "sql": """
            SELECT ATTRIBUTE1, DIVISION, SECTION, DEPARTMENT,
                   ARTICLE_NAME, DISPLAY_TYPE, DESC6_FILTER,
                   GRADE AS STORE_GRADE, MAX_VALUE AS GRID
            FROM REPORT.T_GRID
            WHERE ATTRIBUTE1 IN ('LT WINTER','PREWINTER')
        """,
    },
    {
        "key": "prepack_avg",
        "label": "Prepack Avg",
        "table": "REPORT.T_PREPACK_AVG",
        "schedule": "daily",
        "sql": "SELECT * FROM REPORT.T_PREPACK_AVG WHERE ATTRIBUTE1 IN ('LT WINTER','PREWINTER')",
    },
    {
        "key": "prev_allocation",
        "label": "Prev Allocation (Option Listing)",
        "table": "REPORT.T_CLR_CONCEPT_AW26_V1",
        "schedule": "daily",
        "sql": "SELECT * FROM REPORT.T_CLR_CONCEPT_AW26_V1",
    },
    {
        "key": "mc_req_apps",
        "label": "MC REQ Apps",
        "table": "CK_A2166.V_MC_REQ_APPS_2",
        "schedule": "daily",
        "sql": "SELECT * FROM CK_A2166.V_MC_REQ_APPS_2 WHERE ATTRIBUTE1 IN ('LT WINTER','PREWINTER')",
    },
    {
        "key": "color_family",
        "label": "Color Family",
        "table": "REPORT.T_COLOR_FAMILY",
        "schedule": "daily",
        "sql": "SELECT * FROM REPORT.T_COLOR_FAMILY",
    },
    {
        "key": "pbs_req",
        "label": "PBS / Sparky REQ",
        "table": "CK_A2166.V_SPARKY_PBS_REQ",
        "schedule": "daily",
        "sql": "SELECT * FROM CK_A2166.V_SPARKY_PBS_REQ",
    },
    {
        "key": "wh_stock",
        "label": "Warehouse Stock",
        "table": "CK_A2166.V_WH_STOCK",
        "schedule": "daily",
        "sql": "SELECT * FROM CK_A2166.V_WH_STOCK WHERE ATTRIBUTE1 IN ('LT WINTER','PREWINTER')",
    },
]

SOURCE_MAP: dict[str, dict] = {s["key"]: s for s in SOURCES}

# ── In-memory download state (imported directly by data_store.py) ──────────────
_dl_lock = threading.Lock()
_dl_status: dict[str, dict] = {}   # key → {status, started_at, finished_at, rows, error}


def _parquet_path(key: str):
    """Physical path of the parquet file — delegates to unified parquet_cache output dir."""
    from app.core.parquet_cache import _pq_path
    return _pq_path(_DS_OWNER, key)


def get_status() -> list[dict]:
    """Return checklist status for every registered source."""
    from app.core.parquet_cache import get_meta, _pq_path

    result = []
    now_ist = datetime.now(IST)

    for src in SOURCES:
        key = src["key"]
        pq_file = _pq_path(_DS_OWNER, key)
        meta = get_meta(_DS_OWNER, key)

        with _dl_lock:
            dl = _dl_status.get(key, {})

        if meta:
            fetched_str = meta.get("fetched_at")
            try:
                fetched_dt = datetime.fromisoformat(fetched_str)
                if fetched_dt.tzinfo is None:
                    fetched_dt = fetched_dt.replace(tzinfo=timezone.utc)
                age_hours = (now_ist - fetched_dt.astimezone(IST)).total_seconds() / 3600
            except Exception:
                age_hours = None
            is_fresh = age_hours is not None and age_hours < 26
            size_mb = round(pq_file.stat().st_size / 1_048_576, 2) if pq_file.exists() else 0
            file_status = "fresh" if is_fresh else "stale"
        else:
            fetched_str = None
            age_hours = None
            is_fresh = False
            size_mb = 0
            file_status = "missing"

        result.append({
            "key": key,
            "label": src["label"],
            "table": src["table"],
            "schedule": src["schedule"],
            "file_status": file_status,
            "download_status": dl.get("status"),
            "downloaded_at": fetched_str,
            "rows": meta["rows"] if meta else None,
            "size_mb": size_mb,
            "error": dl.get("error"),
        })

    return result


def download_source(key: str) -> None:
    """Download one source from Oracle and save via parquet_cache. Runs synchronously — call in a thread."""
    src = SOURCE_MAP.get(key)
    if not src:
        raise ValueError(f"Unknown source key: {key}")

    started = datetime.now(IST).isoformat()

    with _dl_lock:
        _dl_status[key] = {"status": "running", "started_at": started, "finished_at": None, "rows": None, "error": None}

    try:
        import pandas as pd
        from app.db.oracle import get_pool
        from app.core.parquet_cache import write_cache

        pool = get_pool()
        with pool.acquire() as conn:
            df = pd.read_sql(src["sql"].strip(), conn)

        rows = len(df)
        write_cache(_DS_OWNER, key, df)

        finished = datetime.now(IST).isoformat()
        with _dl_lock:
            _dl_status[key] = {"status": "done", "started_at": started, "finished_at": finished, "rows": rows, "error": None}

        logger.info("parquet_store: %s downloaded OK — %d rows", key, rows)

        # Post-download cache invalidation hooks
        if key == "store_master":
            try:
                from app.repositories.store_repository import invalidate_cache as _sr_inv
                _sr_inv()
                logger.info("parquet_store: store_repository cache invalidated after store_master refresh")
            except Exception as _e:
                logger.warning("parquet_store: store_repository invalidate failed: %s", _e)
            try:
                from app.api.routes.dashboard import _fetch_oracle_stats_fresh
                import threading as _t
                _t.Thread(target=_fetch_oracle_stats_fresh, daemon=True).start()
                logger.info("parquet_store: dashboard oracle cache refresh triggered after store_master refresh")
            except Exception as _e:
                logger.warning("parquet_store: dashboard cache refresh failed: %s", _e)

    except Exception as exc:
        finished = datetime.now(IST).isoformat()
        with _dl_lock:
            _dl_status[key] = {"status": "failed", "started_at": started, "finished_at": finished, "rows": None, "error": str(exc)}
        logger.error("parquet_store: %s FAILED — %s", key, exc)
        raise


def download_source_async(key: str) -> None:
    """Start download in a background thread."""
    threading.Thread(target=_download_safe, args=(key,), daemon=True, name=f"pq-dl-{key}").start()


def _download_safe(key: str) -> None:
    try:
        download_source(key)
    except Exception:
        pass  # status already recorded in _dl_status


def download_all_async(keys: list[str] | None = None) -> None:
    """Download all (or specified) sources sequentially in a background thread."""
    targets = keys or [s["key"] for s in SOURCES]

    def _run():
        for k in targets:
            try:
                download_source(k)
            except Exception:
                pass  # continue to next

    threading.Thread(target=_run, daemon=True, name="pq-dl-all").start()


def read_parquet(key: str):
    """Read a cached parquet file as a pandas DataFrame via parquet_cache (LRU-cached)."""
    from app.core.parquet_cache import read_cache
    df = read_cache(_DS_OWNER, key)
    if df is None:
        raise FileNotFoundError(f"Parquet not downloaded yet for: {key}")
    return df


# ── Daily auto-refresh scheduler ─────────────────────────────────────────────

def _store_scheduler_loop() -> None:
    import logging as _log
    logger = _log.getLogger(__name__)
    from datetime import datetime as _dt, timedelta as _td
    from app.core.db_scheduler import get_schedule_time

    while True:
        sched = get_schedule_time()
        h, m = int(sched.split(":")[0]), int(sched.split(":")[1])
        now = _dt.now()
        target = now.replace(hour=h, minute=m, second=0, microsecond=0)
        if now >= target:
            target += _td(days=1)
        wait = (target - now).total_seconds()
        logger.info("parquet_store scheduler: next auto-download in %.0fs at %s", wait, sched)
        time.sleep(wait)
        logger.info("parquet_store scheduler: starting daily auto-download (%d sources)", len(SOURCES))
        download_all_async()


def start_store_scheduler() -> None:
    threading.Thread(target=_store_scheduler_loop, daemon=True, name="parquet-store-scheduler").start()
