"""
Pipeline scheduler — triggers all 9 Option Listing pipeline steps
(MC + 00-02-03-07-08-04-05-06) at a configurable time daily (IST).

State (in-memory, reset on restart):
  _config       — enabled flag + hour/minute
  _status       — next_run_at, last_run_at, last_status, log entries
  _sched_lock   — protects both dicts
"""
import logging
import threading
import time
from datetime import datetime, timedelta, timezone

logger = logging.getLogger(__name__)

PIPELINE_ALL_STEPS = ["mc", "00", "02", "03", "07", "08", "04", "05", "06"]
IST = timezone(timedelta(hours=5, minutes=30))

# ── Mutable scheduler state ────────────────────────────────────────────────────
_sched_lock = threading.Lock()

_config: dict = {
    "enabled": True,
    "hour": 9,
    "minute": 0,
}

_status: dict = {
    "next_run_at": None,   # ISO string (IST)
    "last_run_at": None,   # ISO string (IST)
    "last_status": None,   # "success" | "failed" | "running"
    "log": [],             # list of {ts, message, level}
}

_run_now_flag = threading.Event()


def get_status() -> dict:
    with _sched_lock:
        return {**_status, "config": {**_config}}


def update_config(enabled: bool | None = None, hour: int | None = None, minute: int | None = None) -> dict:
    with _sched_lock:
        if enabled is not None:
            _config["enabled"] = enabled
        if hour is not None:
            _config["hour"] = hour
        if minute is not None:
            _config["minute"] = minute
        return {**_config}


def trigger_now() -> None:
    """Signal the scheduler loop to run immediately."""
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


def _seconds_until_target() -> float:
    with _sched_lock:
        h, m = _config["hour"], _config["minute"]
    now_ist = datetime.now(IST)
    target = now_ist.replace(hour=h, minute=m, second=0, microsecond=0)
    if now_ist >= target:
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
        # wait for it to finish (poll status)
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
            _log(f"✓ Pipeline completed successfully (run_id={run_id})", "info")
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
            h, m = _config["hour"], _config["minute"]

        wait = _seconds_until_target()
        next_ist = (datetime.now(IST) + timedelta(seconds=wait)).strftime("%Y-%m-%d %H:%M IST")
        with _sched_lock:
            _status["next_run_at"] = next_ist

        if enabled:
            _log(f"⏰ Next auto-run scheduled at {next_ist}")
        else:
            _log(f"⏸ Scheduler disabled — next would be {next_ist} (skipped until re-enabled)")

        # Wait until target time OR run_now signal
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
        time.sleep(61)  # prevent double-fire within same minute


def start_scheduler() -> None:
    threading.Thread(target=_scheduler_loop, daemon=True, name="pipeline-daily-scheduler").start()
    logger.info("pipeline_scheduler: started (default 09:00 IST daily)")
