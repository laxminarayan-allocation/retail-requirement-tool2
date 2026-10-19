# -*- coding: utf-8 -*-
"""
Source Backup — weekly automatic zip backup of all backend Python source files.

Backups stored at: backend/data/source_backups/source_YYYY-MM-DD_HH-MM.zip
"""
import logging
import threading
import time
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

logger = logging.getLogger(__name__)

IST = timezone(timedelta(hours=5, minutes=30))

BACKUP_DIR = Path(__file__).resolve().parents[2] / "data" / "source_backups"
BACKEND_ROOT = Path(__file__).resolve().parents[2]  # backend/

# Keep at most this many backups
MAX_BACKUPS = 12

_lock = threading.Lock()
_status: dict = {
    "last_backup_at": None,
    "last_backup_file": None,
    "next_backup_at": None,
}

_run_now_flag = threading.Event()


def _source_files() -> dict[str, Path]:
    """Return {archive_name: abs_path} for all source files to back up."""
    from app.api.routes.system import _SOURCE_FILES, _BACKEND_ROOT, _PROJECT_ROOT
    result = {}
    for key, rel in _SOURCE_FILES.items():
        p = (_BACKEND_ROOT / rel).resolve()
        if p.exists():
            # Use relative-to-project path as the name inside the zip
            try:
                arc_name = p.relative_to(_PROJECT_ROOT)
            except ValueError:
                arc_name = Path(rel)
            result[str(arc_name)] = p
    return result


def create_backup() -> Path:
    """Create a zip backup right now. Returns path to the zip file."""
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    ts = datetime.now(IST).strftime("%Y-%m-%d_%H-%M")
    zip_path = BACKUP_DIR / f"source_{ts}.zip"

    files = _source_files()
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for arc_name, abs_path in files.items():
            zf.write(abs_path, arc_name)

    logger.info("source_backup: created %s (%d files)", zip_path.name, len(files))

    # Prune old backups
    _prune()

    with _lock:
        _status["last_backup_at"] = datetime.now(IST).isoformat()
        _status["last_backup_file"] = zip_path.name

    return zip_path


def _prune() -> None:
    """Remove oldest backups beyond MAX_BACKUPS."""
    zips = sorted(BACKUP_DIR.glob("source_*.zip"), key=lambda p: p.stat().st_mtime)
    while len(zips) > MAX_BACKUPS:
        zips.pop(0).unlink(missing_ok=True)


def list_backups() -> list[dict]:
    """Return list of available backups, newest first."""
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    result = []
    for p in sorted(BACKUP_DIR.glob("source_*.zip"), key=lambda f: f.stat().st_mtime, reverse=True):
        stat = p.stat()
        result.append({
            "filename": p.name,
            "size_kb": round(stat.st_size / 1024, 1),
            "created_at": datetime.fromtimestamp(stat.st_mtime, tz=IST).isoformat(),
        })
    return result


def get_status() -> dict:
    with _lock:
        s = dict(_status)
    s["backups"] = list_backups()
    return s


def _next_weekly_ist() -> datetime:
    """Next Sunday 02:00 IST."""
    now = datetime.now(IST)
    days_until_sunday = (6 - now.weekday()) % 7
    if days_until_sunday == 0 and now.hour >= 2:
        days_until_sunday = 7
    target = now.replace(hour=2, minute=0, second=0, microsecond=0) + timedelta(days=days_until_sunday)
    return target


def _scheduler_loop() -> None:
    while True:
        next_run = _next_weekly_ist()
        with _lock:
            _status["next_backup_at"] = next_run.isoformat()
        logger.info("source_backup: next weekly backup at %s", next_run.isoformat())

        # Wait until next_run or manual trigger
        while True:
            now = datetime.now(IST)
            remaining = (next_run - now).total_seconds()
            if remaining <= 0:
                break
            if _run_now_flag.wait(timeout=min(remaining, 3600)):
                _run_now_flag.clear()
                break

        try:
            create_backup()
        except Exception as exc:
            logger.error("source_backup: backup failed: %s", exc)

        time.sleep(60)  # avoid double-firing in same minute


def start_scheduler() -> None:
    t = threading.Thread(target=_scheduler_loop, daemon=True, name="source-backup-sched")
    t.start()
    logger.info("source_backup: weekly scheduler started")


def trigger_now() -> None:
    """Signal the scheduler to run a backup immediately."""
    _run_now_flag.set()
