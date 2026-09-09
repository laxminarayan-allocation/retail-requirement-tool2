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

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

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
        import os, sys
        import pythoncom          # must CoInitialize before any COM call in a background thread
        pythoncom.CoInitialize()
        import win32com.client
        log("Starting Excel (hidden)...")
        xl = win32com.client.DispatchEx("Excel.Application")
        xl.Visible = False
        xl.DisplayAlerts = False
        xl.AskToUpdateLinks = False

        # Expand folders to individual Excel files
        expanded: list[Path] = []
        for fp in job["files"]:
            p = Path(fp.strip().rstrip("\\").rstrip("/"))
            if p.is_dir():
                for ext in ("*.xlsx", "*.xlsm", "*.xlsb", "*.xls"):
                    expanded.extend(p.glob(ext))
                log(f"Folder scanned: {p.name} ({len([x for x in p.glob('*.xls*')])} files)")
            elif p.exists():
                expanded.append(p)
            else:
                log(f"SKIP — not found: {fp}")

        for path in expanded:
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
        pythoncom.CoUninitialize()

    except ImportError as e:
        import traceback
        err_detail = f"ImportError: {e}\n{traceback.format_exc()}"
        with _jobs_lock:
            _jobs[job_id]["status"]      = "error"
            _jobs[job_id]["error"]       = err_detail
            _jobs[job_id]["log"].append(err_detail)
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

@router.get("/test-win32")
def test_win32():
    import os, sys, threading
    result = {}
    def _test():
        from pathlib import Path as P
        _venv_root = P(sys.executable).resolve().parents[1]
        result["venv_root"] = str(_venv_root)
        result["exe"] = sys.executable
        for _d in [_venv_root, _venv_root/"Lib"/"site-packages"/"pywin32_system32", _venv_root/"Lib"/"site-packages"/"win32"]:
            if _d.exists():
                os.environ["PATH"] = str(_d) + os.pathsep + os.environ.get("PATH", "")
                try: os.add_dll_directory(str(_d))
                except Exception: pass
        try:
            import win32com.client
            result["win32"] = "OK"
        except Exception as e:
            result["win32"] = f"ERROR: {type(e).__name__}: {e}"
    t = threading.Thread(target=_test); t.start(); t.join()
    return result

@router.get("/config")
def get_config():
    return {"success": True, "data": _load_config()}


@router.post("/config")
def save_config(body: FileListUpdate):
    _save_config({"files": body.files})
    return {"success": True}


@router.post("/run")
def run_refresh(body: RunRequest):
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
def job_status(job_id: str):
    with _jobs_lock:
        job = _jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    return {"success": True, "data": job}


@router.get("/jobs")
def list_jobs():
    with _jobs_lock:
        jobs = list(_jobs.values())
    jobs.sort(key=lambda j: j["started_at"], reverse=True)
    return {"success": True, "data": jobs[:20]}  # last 20
