"""
Database-Explorer auto-refresh scheduler.
Reads 'daily' freq tables from db_refresh_freq and refreshes them at the configured time (default 06:00).
Runs as a background daemon thread — started from lifespan in main.py.
"""
import logging
import threading
import time
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)

_DEFAULT_TIME = "06:00"  # HH:MM local time


def get_schedule_time() -> str:
    try:
        from app.db.sqlite import get_sqlite
        with get_sqlite() as db:
            row = db.execute(
                "SELECT value FROM db_refresh_settings WHERE key='auto_refresh_time'"
            ).fetchone()
            return row["value"] if row else _DEFAULT_TIME
    except Exception:
        return _DEFAULT_TIME


def set_schedule_time(hhmm: str) -> None:
    from app.db.sqlite import get_sqlite
    with get_sqlite() as db:
        db.execute(
            "INSERT OR REPLACE INTO db_refresh_settings (key, value) VALUES ('auto_refresh_time', ?)",
            (hhmm,)
        )


def get_freq_map() -> dict:
    """Returns {owner__object: freq} for all entries."""
    try:
        from app.db.sqlite import get_sqlite
        with get_sqlite() as db:
            rows = db.execute("SELECT owner, object_name, freq FROM db_refresh_freq").fetchall()
        return {f"{r['owner']}__{r['object_name']}": r["freq"] for r in rows}
    except Exception:
        return {}


def set_freq(owner: str, object_name: str, freq: str) -> None:
    from app.db.sqlite import get_sqlite
    now = datetime.utcnow().isoformat()
    with get_sqlite() as db:
        db.execute(
            """INSERT OR REPLACE INTO db_refresh_freq (owner, object_name, freq, updated_at)
               VALUES (?, ?, ?, ?)""",
            (owner, object_name, freq, now)
        )


def _seconds_until(hhmm: str) -> float:
    h, m = int(hhmm.split(":")[0]), int(hhmm.split(":")[1])
    now = datetime.now()
    target = now.replace(hour=h, minute=m, second=0, microsecond=0)
    if now >= target:
        target += timedelta(days=1)
    return (target - now).total_seconds()


def _object_exists(conn, owner: str, obj: str) -> bool:
    """Check if table/view exists in Oracle for this user."""
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT COUNT(*) FROM ALL_OBJECTS WHERE OWNER=:1 AND OBJECT_NAME=:2 AND OBJECT_TYPE IN ('TABLE','VIEW','MATERIALIZED VIEW')",
            [owner.upper(), obj.upper()]
        )
        return (cur.fetchone() or [0])[0] > 0
    except Exception:
        return False


def _fetch_one(owner: str, obj: str) -> None:
    try:
        from app.db.connection import get_connection
        from app.repositories.base_repository import fetch_df
        from app.core.parquet_cache import write_cache, get_meta

        if owner.upper() == "QUERY":
            meta = get_meta(owner, obj)
            sql = (meta or {}).get("sql_text", "").rstrip("; \t\n")
            if not sql:
                logger.info("db_scheduler: skip QUERY.%s — no sql_text in meta", obj)
                return
            with get_connection() as conn:
                df = fetch_df(conn, sql, label=f"QUERY.{obj}")
        else:
            with get_connection() as conn:
                if not _object_exists(conn, owner, obj):
                    logger.info("db_scheduler: skip %s.%s — not found in Oracle", owner, obj)
                    return
                sql = f"SELECT * FROM {owner.upper()}.{obj.upper()}"
                df = fetch_df(conn, sql, label=f"{owner}.{obj}")
        write_cache(owner, obj, df)
        logger.info("db_scheduler: refreshed %s.%s → %d rows", owner, obj, len(df))
    except Exception as exc:
        logger.warning("db_scheduler: failed %s.%s — %s", owner, obj, exc)


def refresh_daily_files() -> None:
    freq_map = get_freq_map()
    daily = [(k.split("__")[0], k.split("__")[1]) for k, v in freq_map.items() if v == "daily"]
    if not daily:
        logger.info("db_scheduler: no daily files configured")
        return
    logger.info("db_scheduler: refreshing %d daily files", len(daily))
    for owner, obj in daily:
        _fetch_one(owner, obj)
    logger.info("db_scheduler: daily refresh complete (%d files)", len(daily))


def _was_refreshed_today() -> bool:
    """Check if any daily file was refreshed today (from parquet cache mtime)."""
    try:
        from app.core.parquet_cache import get_meta
        freq_map = get_freq_map()
        daily = [(k.split("__")[0], k.split("__")[1]) for k, v in freq_map.items() if v == "daily"]
        if not daily:
            return True  # nothing to refresh
        today = datetime.now().date()
        for owner, obj in daily[:3]:  # check first 3
            meta = get_meta(owner, obj)
            if meta and meta.get("saved_at"):
                saved = datetime.fromisoformat(meta["saved_at"][:10]).date()
                if saved >= today:
                    return True
        return False
    except Exception:
        return False


def _scheduler_loop() -> None:
    # On startup: if today's scheduled time has passed and refresh wasn't done, run immediately
    sched_time = get_schedule_time()
    h, m = int(sched_time.split(":")[0]), int(sched_time.split(":")[1])
    now = datetime.now()
    scheduled_today = now.replace(hour=h, minute=m, second=0, microsecond=0)
    if now > scheduled_today and not _was_refreshed_today():
        logger.info("db_scheduler: missed today's refresh — running catch-up now")
        time.sleep(10)  # let Oracle pool fully settle
        refresh_daily_files()

    while True:
        sched_time = get_schedule_time()
        wait = _seconds_until(sched_time)
        logger.info("db_scheduler: next auto-refresh in %.0fs at %s", wait, sched_time)
        time.sleep(wait)
        refresh_daily_files()


def start_scheduler() -> None:
    threading.Thread(target=_scheduler_loop, daemon=True, name="db-auto-refresh").start()
    logger.info("db_scheduler: started (default time=%s)", get_schedule_time())
