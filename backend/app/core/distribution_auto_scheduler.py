# -*- coding: utf-8 -*-
"""
Distribution auto-scheduler — runs distribution at 8 AM daily using the
cached base, then saves all CSVs to data/output/auto_runs/YYYY-MM-DD/.
"""
import json
import logging
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

logger = logging.getLogger(__name__)

IST = timezone(timedelta(hours=5, minutes=30))

_lock = threading.Lock()

_config: dict = {
    "enabled": False,
    "hour": 8,
    "minute": 0,
    "wh_col": "wh_q",
    "max_round": 10,
}

_status: dict = {
    "next_run_at": None,
    "last_run_at": None,
    "last_status": None,
    "last_save_path": None,
    "saved_files": [],
    "log": [],
}

_run_now_flag = threading.Event()

_CFG_FILE = Path(__file__).parent.parent.parent / "data" / "dist_auto_sched.json"


def _load_config() -> None:
    try:
        if _CFG_FILE.exists():
            saved = json.loads(_CFG_FILE.read_text(encoding="utf-8"))
            with _lock:
                for k, v in saved.items():
                    if k in _config:
                        _config[k] = v
    except Exception as exc:
        logger.warning("dist_auto_sched: config load failed: %s", exc)


def _save_config() -> None:
    try:
        _CFG_FILE.parent.mkdir(parents=True, exist_ok=True)
        _CFG_FILE.write_text(json.dumps(_config), encoding="utf-8")
    except Exception as exc:
        logger.warning("dist_auto_sched: config save failed: %s", exc)


def get_status() -> dict:
    with _lock:
        return {**_status, "config": {**_config}}


def update_config(**kwargs) -> dict:
    with _lock:
        for k, v in kwargs.items():
            if k in _config:
                _config[k] = v
        result = {**_config}
    _save_config()
    return result


def trigger_now() -> None:
    _run_now_flag.set()


def get_auto_runs_base() -> Path:
    date_str = datetime.now(IST).strftime("%Y-%m-%d")
    p = Path(__file__).parent.parent.parent / "data" / "output" / "auto_runs" / date_str
    p.mkdir(parents=True, exist_ok=True)
    return p


def save_result_to_disk(result_df, max_round: int = 10) -> tuple:
    """Save distribution result to auto_runs/YYYY-MM-DD/. Returns (folder, [files])."""
    import pandas as pd
    out_dir = get_auto_runs_base()
    ts = datetime.now(IST).strftime("%H%M%S")
    saved = []

    full_path = out_dir / f"distribution_full_{ts}.csv"
    result_df.to_csv(str(full_path), index=False, encoding="utf-8-sig")
    saved.append(str(full_path))

    if "final_allocate" in result_df.columns:
        nz = result_df[pd.to_numeric(result_df["final_allocate"], errors="coerce").fillna(0) > 0]
        if len(nz) > 0:
            nz_path = out_dir / f"distribution_nonzero_{ts}.csv"
            nz.to_csv(str(nz_path), index=False, encoding="utf-8-sig")
            saved.append(str(nz_path))

    return str(out_dir), saved


def _log(msg: str, level: str = "info") -> None:
    ts = datetime.now(IST).strftime("%Y-%m-%d %H:%M:%S IST")
    with _lock:
        _status["log"].append({"ts": ts, "message": msg, "level": level})
        if len(_status["log"]) > 100:
            _status["log"] = _status["log"][-100:]
    getattr(logger, level if level in ("info", "warning", "error") else "info")(
        "dist_auto_sched: %s", msg
    )


def _seconds_until_target() -> float:
    with _lock:
        h, m = _config["hour"], _config["minute"]
    now = datetime.now(IST)
    target = now.replace(hour=h, minute=m, second=0, microsecond=0)
    if now >= target:
        target += timedelta(days=1)
    return (target - now).total_seconds()


def _do_run() -> None:
    with _lock:
        _status["last_run_at"] = datetime.now(IST).strftime("%Y-%m-%d %H:%M:%S IST")
        _status["last_status"] = "running"
        wh_col = _config.get("wh_col", "wh_q")
        max_round = int(_config.get("max_round", 10))

    _log("▶ Auto distribution run started")
    try:
        from app.core.parquet_cache import has_output, read_cache
        from app.api.routes.distribution import _run_distribution_loop_v2

        if not has_output("DIST", "BASE"):
            raise RuntimeError("DIST/BASE not cached — run a manual Build+Run first")

        base = read_cache("DIST", "BASE")
        base.columns = [c.lower() for c in base.columns]
        if wh_col not in base.columns:
            for fb in ("wh_stock_q", "grc_q"):
                if fb in base.columns:
                    wh_col = fb; break

        _log(f"  ▷ Running loop (wh_col={wh_col}, max_round={max_round})...")
        result = _run_distribution_loop_v2(base, wh_col=wh_col, max_round=max_round)

        _log("  ▷ Saving CSVs...")
        save_dir, saved_files = save_result_to_disk(result, max_round)

        with _lock:
            _status["last_status"] = "success"
            _status["last_save_path"] = save_dir
            _status["saved_files"] = saved_files

        _log(f"✓ Done — {len(saved_files)} file(s) → {save_dir}")

    except Exception as exc:
        _log(f"✗ Failed — {exc}", "error")
        with _lock:
            _status["last_status"] = "failed"


def _loop() -> None:
    while True:
        with _lock:
            enabled = _config["enabled"]

        wait = _seconds_until_target()
        next_ist = (datetime.now(IST) + timedelta(seconds=wait)).strftime("%Y-%m-%d %H:%M IST")
        with _lock:
            _status["next_run_at"] = next_ist

        if enabled:
            _log(f"⏰ Next auto-run: {next_ist}")
        else:
            _log(f"⏸ Disabled — would run at {next_ist}")

        fired = _run_now_flag.wait(timeout=wait)
        if fired:
            _run_now_flag.clear()
            _log("▶ Manual trigger")
        else:
            with _lock:
                enabled = _config["enabled"]
            if not enabled:
                time.sleep(61)
                continue

        _do_run()
        time.sleep(61)


def start_scheduler() -> None:
    _load_config()
    threading.Thread(target=_loop, daemon=True, name="dist-auto-sched").start()
    logger.info("dist_auto_sched: started")
