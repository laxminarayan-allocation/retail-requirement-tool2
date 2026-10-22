"""
Pipeline scheduler — triggers all 9 Option Listing pipeline steps
(MC + 00-02-03-07-08-04-05-06) at a configurable time on configured days (IST).

days: "daily" | "1-6" (Mon-Sat) | "1-5" (Mon-Fri)
"""
import logging
import threading
import time
from datetime import datetime, timedelta, timezone

logger = logging.getLogger(__name__)

PIPELINE_ALL_STEPS = ["mc", "00", "02", "03", "07", "08", "04", "05", "06"]
IST = timezone(timedelta(hours=5, minutes=30))

_sched_lock = threading.Lock()

_config: dict = {
    "enabled": True,
    "hour": 9,
    "minute": 0,
    "days": "1-6",   # "daily" | "1-6" Mon-Sat | "1-5" Mon-Fri
}

_status: dict = {
    "next_run_at": None,
    "last_run_at": None,
    "last_status": None,
    "log": [],
}

_run_now_flag = threading.Event()


def get_status() -> dict:
    with _sched_lock:
        return {**_status, "config": {**_config}}


def update_config(enabled=None, hour=None, minute=None, days=None) -> dict:
    with _sched_lock:
        if enabled is not None:
            _config["enabled"] = enabled
        if hour is not None:
            _config["hour"] = int(hour)
        if minute is not None:
            _config["minute"] = int(minute)
        if days is not None:
            _config["days"] = days
        cfg = {**_config}
    # Immediately recalculate next_run_at so UI reflects the new time without waiting for loop cycle
    wait = _seconds_until_target()
    next_ist = (datetime.now(IST) + timedelta(seconds=wait)).strftime("%Y-%m-%d %H:%M IST (%a)")
    with _sched_lock:
        _status["next_run_at"] = next_ist
    return cfg


def trigger_now() -> None:
    _run_now_flag.set()


def _log(message: str, level: str = "info") -> None:
    ts = datetime.now(IST).strftime("%Y-%m-%d %H:%M:%S IST")
    entry = {"ts": ts, "message": message, "level": level}
    with _sched_lock:
        _status["log"].append(entry)
        if len(_status["log"]) > 200:
            _status["log"] = _status["log"][-200:]
    if level == "error":
        logger.error("pipeline_scheduler: %s", message)
    elif level == "warn":
        logger.warning("pipeline_scheduler: %s", message)
    else:
        logger.info("pipeline_scheduler: %s", message)


def _is_run_day(dt: datetime, days: str) -> bool:
    """Monday=0 ... Sunday=6 in Python weekday()."""
    wd = dt.weekday()  # 0=Mon, 6=Sun
    if days == "daily":
        return True
    if days == "1-6":   # Mon(0)–Sat(5)
        return wd <= 5
    if days == "1-5":   # Mon(0)–Fri(4)
        return wd <= 4
    return True


def _seconds_until_target() -> float:
    """Return seconds until the next configured run time on a valid day."""
    with _sched_lock:
        h, m, days = _config["hour"], _config["minute"], _config["days"]
    now_ist = datetime.now(IST)
    target = now_ist.replace(hour=h, minute=m, second=0, microsecond=0)
    if now_ist >= target:
        target += timedelta(days=1)
    # Advance until we hit a run day
    for _ in range(8):
        if _is_run_day(target, days):
            break
        target += timedelta(days=1)
    return (target - now_ist).total_seconds()


def _do_run() -> None:
    with _sched_lock:
        _status["last_run_at"] = datetime.now(IST).strftime("%Y-%m-%d %H:%M:%S IST")
        _status["last_status"] = "running"

    _log("▶ Pipeline run started (9 steps: mc + 00 02 03 07 08 04 05 06)")

    try:
        from app.api.routes.option_listing import run_pipeline, PipelineRun
        body = PipelineRun(steps=PIPELINE_ALL_STEPS)
        result = run_pipeline(body)
        run_id = result.get("run_id", "?")
        _log(f"✓ Pipeline triggered — run_id={run_id}")

        import time as _t
        from app.api.routes.option_listing import pipeline_status
        for _ in range(360):  # max 30 min
            _t.sleep(5)
            st = pipeline_status()
            if st.get("status") in ("done", "failed", "idle"):
                final = st.get("status", "unknown")
                break
        else:
            final = "timeout"

        if final == "done":
            _log(f"✓ Pipeline completed successfully (run_id={run_id})")
            with _sched_lock:
                _status["last_status"] = "success"
        else:
            _log(f"✗ Pipeline ended with status={final} (run_id={run_id})", "error")
            with _sched_lock:
                _status["last_status"] = "failed"

    except Exception as exc:
        _log(f"✗ Failed to trigger pipeline — {exc}", "error")
        with _sched_lock:
            _status["last_status"] = "failed"


def _scheduler_loop() -> None:
    while True:
        with _sched_lock:
            enabled = _config["enabled"]
            days = _config["days"]

        wait = _seconds_until_target()
        next_ist = (datetime.now(IST) + timedelta(seconds=wait)).strftime("%Y-%m-%d %H:%M IST (%a)")
        with _sched_lock:
            _status["next_run_at"] = next_ist

        days_label = {"daily": "Every day", "1-6": "Mon–Sat", "1-5": "Mon–Fri"}.get(days, days)
        if enabled:
            _log(f"⏰ Next auto-run: {next_ist}  [{days_label}]")
        else:
            _log(f"⏸ Disabled — next would be {next_ist} [{days_label}]")

        fired = _run_now_flag.wait(timeout=wait)

        if fired:
            _run_now_flag.clear()
            _log("▶ Manual 'Run Now' triggered")
        else:
            with _sched_lock:
                enabled = _config["enabled"]
            if not enabled:
                _log("⏸ Skipping scheduled run (scheduler disabled)")
                time.sleep(61)
                continue

        _do_run()
        time.sleep(61)


def start_scheduler() -> None:
    threading.Thread(target=_scheduler_loop, daemon=True, name="pipeline-daily-scheduler").start()
    logger.info("pipeline_scheduler: started (09:00 IST Mon-Sat)")
