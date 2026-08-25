"""
Requirements scheduler — fetches all 12 Oracle views daily at 06:00 local time
and writes them to the parquet cache. Also auto-registers them in SQLite
custom_master_tables so they appear in Master Data.
"""
import logging
import threading
import time
from datetime import datetime

logger = logging.getLogger(__name__)

REQ_VIEWS = [
    {"owner": "CK_A2166", "obj": "V_MC_REQ_APPS_2",           "label": "V_MC_REQ_APPS_2"},
    {"owner": "CK_A2166", "obj": "V_MC_REQ_GM",               "label": "V_MC_REQ_GM"},
    {"owner": "CK_A2166", "obj": "V_ART_REQ_APPS",            "label": "V_ART_REQ_APPS"},
    {"owner": "CK_A2166", "obj": "V_ART_REQ_GM",              "label": "V_ART_REQ_GM"},
    {"owner": "CK_A2166", "obj": "V_MRP_REQ_APPS",            "label": "V_MRP_REQ_APPS"},
    {"owner": "CK_A2166", "obj": "V_BARCODE_REQ_APPS_GRC_V2", "label": "V_BARCODE_REQ_APPS_GRC_V2"},
    {"owner": "CK_A2166", "obj": "V_BARCODE_REQ_APPS_WMS_V2", "label": "V_BARCODE_REQ_APPS_WMS_V2"},
    {"owner": "CK_A2166", "obj": "V_SZ_REQ_APPS",             "label": "V_SZ_REQ_APPS"},
    {"owner": "CK_A2166", "obj": "V_SPARKY_PBS_REQ",          "label": "V_SPARKY_PBS_REQ"},
    {"owner": "CK_A2166", "obj": "V_TABLE_REQ_APPS",          "label": "V_TABLE_REQ_APPS"},
    {"owner": "CK_A2166", "obj": "V_OPTION_REQ_APPS",         "label": "V_OPTION_REQ_APPS"},
    {"owner": "CK_A2166", "obj": "V_LIST_PBS_REQ",            "label": "V_LIST_PBS_REQ"},
]

_SYSTEM_USER = "system"


def register_views_in_master_data() -> None:
    """Insert all req views into custom_master_tables if not already present."""
    try:
        from app.db.sqlite import get_sqlite
        with get_sqlite() as db:
            db.execute(
                """CREATE TABLE IF NOT EXISTS custom_master_tables (
                   id INTEGER PRIMARY KEY AUTOINCREMENT,
                   schema_owner TEXT NOT NULL,
                   object_name  TEXT NOT NULL,
                   label        TEXT NOT NULL,
                   added_by     TEXT NOT NULL DEFAULT 'system',
                   added_at     TEXT NOT NULL,
                   UNIQUE(schema_owner, object_name)
                )"""
            )
            now = datetime.utcnow().isoformat()
            for v in REQ_VIEWS:
                db.execute(
                    """INSERT INTO custom_master_tables
                       (schema_owner, object_name, label, added_by, added_at)
                       VALUES (?, ?, ?, ?, ?)
                       ON CONFLICT(schema_owner, object_name) DO UPDATE SET label=excluded.label""",
                    (v["owner"], v["obj"], v["label"], _SYSTEM_USER, now),
                )
        logger.info("req_scheduler: registered %d views in custom_master_tables", len(REQ_VIEWS))
    except Exception as exc:
        logger.warning("req_scheduler: master-data registration failed: %s", exc)


def _fetch_one(owner: str, obj: str, label: str) -> None:
    try:
        from app.db.oracle import get_pool
        from app.core.parquet_cache import write_cache
        import oracledb

        pool = get_pool()
        with pool.acquire() as conn:
            sql = f"SELECT * FROM {owner}.{obj}"
            with conn.cursor() as cur:
                cur.execute(sql)
                cols = [c[0].lower() for c in cur.description]
                import pandas as pd
                df = pd.DataFrame(cur.fetchall(), columns=cols)
        write_cache(owner, obj, df)
        logger.info("req_scheduler: refreshed %s.%s → %d rows", owner, obj, len(df))
    except Exception as exc:
        logger.warning("req_scheduler: failed to fetch %s.%s — %s", owner, obj, exc)


def refresh_all() -> None:
    logger.info("req_scheduler: starting daily refresh of %d views", len(REQ_VIEWS))
    for v in REQ_VIEWS:
        _fetch_one(v["owner"], v["obj"], v["label"])
    logger.info("req_scheduler: daily refresh complete")


def _seconds_until_6am() -> float:
    now = datetime.now()
    target = now.replace(hour=6, minute=0, second=0, microsecond=0)
    if now >= target:
        # next day
        from datetime import timedelta
        target += timedelta(days=1)
    return (target - now).total_seconds()


def _scheduler_loop() -> None:
    while True:
        wait = _seconds_until_6am()
        logger.info("req_scheduler: next refresh in %.0f seconds (at 06:00)", wait)
        time.sleep(wait)
        refresh_all()


def start_scheduler() -> None:
    threading.Thread(target=_scheduler_loop, daemon=True, name="req-daily-refresh").start()
    logger.info("req_scheduler: daily 6 AM refresh thread started")
