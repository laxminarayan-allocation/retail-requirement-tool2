"""
Pipeline scheduler — triggers all 8 Option Listing pipeline steps
automatically at 09:00 IST every day.

IST = UTC+5:30. The scheduler computes seconds-until-9am-IST from the
current UTC clock so it works regardless of the server's local timezone.
"""
import logging
import threading
import time
from datetime import datetime, timedelta, timezone

logger = logging.getLogger(__name__)

PIPELINE_ALL_STEPS = ["00", "02", "03", "07", "08", "04", "05", "06"]
IST = timezone(timedelta(hours=5, minutes=30))


def _seconds_until_9am_ist() -> float:
    now_ist = datetime.now(IST)
    target = now_ist.replace(hour=9, minute=0, second=0, microsecond=0)
    if now_ist >= target:
        target += timedelta(days=1)
    return (target - now_ist).total_seconds()


def _trigger_pipeline() -> None:
    try:
        from app.api.routes.option_listing import run_pipeline, PipelineRun
        body = PipelineRun(steps=PIPELINE_ALL_STEPS)
        result = run_pipeline(body)
        logger.info("pipeline_scheduler: triggered run %s with steps %s", result.get("run_id"), result.get("steps"))
    except Exception as exc:
        logger.error("pipeline_scheduler: failed to trigger pipeline — %s", exc)


def _scheduler_loop() -> None:
    while True:
        wait = _seconds_until_9am_ist()
        next_run = (datetime.now(IST) + timedelta(seconds=wait)).strftime("%Y-%m-%d %H:%M IST")
        logger.info("pipeline_scheduler: next auto-run in %.0f seconds (at %s)", wait, next_run)
        time.sleep(wait)
        logger.info("pipeline_scheduler: 09:00 IST — starting all 8 pipeline steps")
        _trigger_pipeline()
        time.sleep(60)  # prevent double-fire within same minute


def start_scheduler() -> None:
    threading.Thread(target=_scheduler_loop, daemon=True, name="pipeline-daily-9am").start()
    logger.info("pipeline_scheduler: daily 09:00 IST auto-run thread started")
