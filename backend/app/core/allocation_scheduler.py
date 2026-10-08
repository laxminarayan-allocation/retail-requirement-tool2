"""
Allocation scheduler — runs all Create Allocation modules (1-7) sequentially
at a configurable time (default 06:00 IST, Mon-Sat).
"""
import logging
import threading
import time
from datetime import datetime, timedelta, timezone

logger = logging.getLogger(__name__)

IST = timezone(timedelta(hours=5, minutes=30))
ALL_MODULES = ["1", "2", "3", "4", "5", "6", "7"]

_lock = threading.Lock()

_config: dict = {
    "enabled": True,
    "hour": 6,
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
    with _lock:
        return {**_status, "config": {**_config}}


def update_config(enabled=None, hour=None, minute=None, days=None) -> dict:
    with _lock:
        if enabled is not None:
            _config["enabled"] = bool(enabled)
        if hour is not None:
            _config["hour"] = int(hour)
        if minute is not None:
            _config["minute"] = int(minute)
        if days is not None:
            _config["days"] = days
    return {**_config}


def trigger_now() -> None:
    _run_now_flag.set()


def _log(message: str, level: str = "info") -> None:
    ts = datetime.now(IST).strftime("%Y-%m-%d %H:%M:%S IST")
    entry = {"ts": ts, "message": message, "level": level}
    with _lock:
        _status["log"].append(entry)
        if len(_status["log"]) > 200:
            _status["log"] = _status["log"][-200:]
    if level == "error":
        logger.error("allocation_scheduler: %s", message)
    elif level == "warn":
        logger.warning("allocation_scheduler: %s", message)
    else:
        logger.info("allocation_scheduler: %s", message)


def _is_run_day(dt: datetime, days: str) -> bool:
    wd = dt.weekday()
    if days == "daily":
        return True
    if days == "1-6":
        return wd <= 5
    if days == "1-5":
        return wd <= 4
    return True


def _seconds_until_target() -> float:
    with _lock:
        h, m, days = _config["hour"], _config["minute"], _config["days"]
    now_ist = datetime.now(IST)
    target = now_ist.replace(hour=h, minute=m, second=0, microsecond=0)
    if now_ist >= target:
        target += timedelta(days=1)
    for _ in range(8):
        if _is_run_day(target, days):
            break
        target += timedelta(days=1)
    return (target - now_ist).total_seconds()


def _do_run() -> None:
    with _lock:
        _status["last_run_at"] = datetime.now(IST).strftime("%Y-%m-%d %H:%M:%S IST")
        _status["last_status"] = "running"

    _log(f"▶ Allocation run started (modules: {', '.join(ALL_MODULES)})")

    try:
        from app.api.routes.pipeline import _run_module1, _run_module2, _run_module3, \
            _run_module5, _run_module6, _run_module7, _jobs, _jobs_lock
        import uuid

        failed = False
        for mod_id in ALL_MODULES:
            job_id = uuid.uuid4().hex[:12]
            with _jobs_lock:
                _jobs[job_id] = []

            runners = {
                "1": _run_module1, "2": _run_module2, "3": _run_module3,
                "5": _run_module5, "6": _run_module6, "7": _run_module7,
            }
            fn = runners.get(mod_id)
            if fn is None:
                _log(f"⚠ Module {mod_id} not implemented — skipping", "warn")
                continue

            _log(f"  ▷ Module {mod_id} starting...")
            t = threading.Thread(target=fn, args=(job_id,), daemon=True)
            t.start()
            t.join(timeout=1800)  # max 30 min per module
            if t.is_alive():
                _log(f"✗ Module {mod_id} timed out after 30 min", "error")
                failed = True
                break
            _log(f"  ✓ Module {mod_id} done")

        final = "failed" if failed else "success"
        _log(f"{'✓' if not failed else '✗'} Allocation run {final}")
        with _lock:
            _status["last_status"] = final

    except Exception as exc:
        _log(f"✗ Allocation run failed — {exc}", "error")
        with _lock:
            _status["last_status"] = "failed"


def _scheduler_loop() -> None:
    while True:
        with _lock:
            enabled = _config["enabled"]
            days = _config["days"]

        wait = _seconds_until_target()
        next_ist = (datetime.now(IST) + timedelta(seconds=wait)).strftime("%Y-%m-%d %H:%M IST (%a)")
        with _lock:
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
            with _lock:
                enabled = _config["enabled"]
            if not enabled:
                _log("⏸ Skipping scheduled run (scheduler disabled)")
                time.sleep(61)
                continue

        _do_run()
        time.sleep(61)


def start_scheduler() -> None:
    threading.Thread(target=_scheduler_loop, daemon=True, name="allocation-daily-scheduler").start()
    logger.info("allocation_scheduler: started (06:00 IST Mon-Sat)")
