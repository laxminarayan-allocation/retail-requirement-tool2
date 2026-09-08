"""
oracle_refresh.py
─────────────────
Background Excel ODBC + Pivot Table refresh via win32com.
Jobs run in a thread pool so FastAPI stays non-blocking.
Job state is in-memory (resets on server restart).
"""
import json
import threading
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.api.routes.auth import get_current_user

router = APIRouter(prefix="/oracle-refresh", tags=["oracle-refresh"])

# ── Config file (stores list of watched Excel files) ──────────────────────────
_CONFIG_FILE = Path(__file__).resolve().parents[4] / "oracle_refresh_config.json"

def _load_config() -> dict:
    if _CONFIG_FILE.exists():
        try:
            return json.loads(_CONFIG_FILE.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {"files": []}

def _save_config(data: dict):
    _CONFIG_FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")

# ── In-memory job store ───────────────────────────────────────────────────────
_jobs: dict[str, dict] = {}
_jobs_lock = threading.Lock()

def _make_job(file_paths: list[str]) -> dict:
    return {
        "job_id":      str(uuid.uuid4()),
        "status":      "running",   # running | done | error
        "started_at":  datetime.now().isoformat(timespec="seconds"),
        "finished_at": None,
        "files":       file_paths,
        "log":         [],
        "error":       None,
    }

# ── Excel refresh worker (runs in a background thread) ───────────────────────
def _refresh_worker(job: dict):
    job_id = job["job_id"]

    def log(msg: str):
        ts = datetime.now().strftime("%H:%M:%S")
        with _jobs_lock:
            _jobs[job_id]["log"].append(f"[{ts}] {msg}")

    try:
        import win32com.client  # pywin32 — already installed on allocation_user's machine
        log("Starting Excel (hidden)...")
        xl = win32com.client.DispatchEx("Excel.Application")
        xl.Visible = False
        xl.DisplayAlerts = False
        xl.AskToUpdateLinks = False

        for fp in job["files"]:
            path = Path(fp)
            if not path.exists():
                log(f"SKIP — file not found: {fp}")
                continue
            log(f"Opening: {path.name}")
            try:
                wb = xl.Workbooks.Open(
                    str(path.resolve()),
                    UpdateLinks=False,
                    ReadOnly=False,
                    IgnoreReadOnlyRecommended=True,
                )
                log(f"  Refreshing all connections (ODBC)...")
                wb.RefreshAll()
                xl.CalculateUntilAsyncQueriesDone()
                log(f"  ODBC refresh done.")
                # Refresh all pivot caches
                pivot_count = 0
                for ws in wb.Worksheets:
                    for pc in wb.PivotCaches():
                        try:
                            pc.Refresh()
                            pivot_count += 1
                        except Exception:
                            pass
                if pivot_count:
                    log(f"  Pivot tables refreshed: {pivot_count}")
                wb.Save()
                wb.Close(SaveChanges=False)
                log(f"  Saved and closed: {path.name}")
            except Exception as e:
                log(f"  ERROR on {path.name}: {e}")

        xl.Quit()
        log("All done.")
        with _jobs_lock:
            _jobs[job_id]["status"]      = "done"
            _jobs[job_id]["finished_at"] = datetime.now().isoformat(timespec="seconds")

    except ImportError:
        with _jobs_lock:
            _jobs[job_id]["status"]      = "error"
            _jobs[job_id]["error"]       = "pywin32 not installed — run: pip install pywin32"
            _jobs[job_id]["finished_at"] = datetime.now().isoformat(timespec="seconds")
    except Exception as e:
        with _jobs_lock:
            _jobs[job_id]["status"]      = "error"
            _jobs[job_id]["error"]       = str(e)
            _jobs[job_id]["finished_at"] = datetime.now().isoformat(timespec="seconds")


# ── Pydantic models ───────────────────────────────────────────────────────────
class FileListUpdate(BaseModel):
    files: list[str]

class RunRequest(BaseModel):
    files: Optional[list[str]] = None   # if None → use saved config


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/config")
def get_config(user=Depends(get_current_user)):
    return {"success": True, "data": _load_config()}


@router.post("/config")
def save_config(body: FileListUpdate, user=Depends(get_current_user)):
    _save_config({"files": body.files})
    return {"success": True}


@router.post("/run")
def run_refresh(body: RunRequest, user=Depends(get_current_user)):
    cfg = _load_config()
    files = body.files if body.files is not None else cfg.get("files", [])
    if not files:
        raise HTTPException(400, "No Excel files configured. Add files first.")

    job = _make_job(files)
    with _jobs_lock:
        _jobs[job["job_id"]] = job

    t = threading.Thread(target=_refresh_worker, args=(job,), daemon=True)
    t.start()

    return {"success": True, "data": {"job_id": job["job_id"]}}


@router.get("/status/{job_id}")
def job_status(job_id: str, user=Depends(get_current_user)):
    with _jobs_lock:
        job = _jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    return {"success": True, "data": job}


@router.get("/jobs")
def list_jobs(user=Depends(get_current_user)):
    with _jobs_lock:
        jobs = list(_jobs.values())
    jobs.sort(key=lambda j: j["started_at"], reverse=True)
    return {"success": True, "data": jobs[:20]}  # last 20
