"""
oracle_refresh.py  —  Oracle ODBC Refresh & Audit API
Tabs: Refresh | Audit | Health Check | Log | Scheduler
"""
import json, threading, uuid, os, sched, time
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/oracle-refresh", tags=["oracle-refresh"])

# ── Persistent config ─────────────────────────────────────────────────────────
_CONFIG_FILE = Path(__file__).resolve().parents[4] / "oracle_refresh_config.json"

def _load_config() -> dict:
    if _CONFIG_FILE.exists():
        try:
            cfg = json.loads(_CONFIG_FILE.read_text(encoding="utf-8"))
            # Migrate old single schedule → schedules list
            if "schedule" in cfg and "schedules" not in cfg:
                s = cfg.pop("schedule")
                cfg["schedules"] = [{"id": str(uuid.uuid4()), "enabled": s.get("enabled", False),
                                      "cron": s.get("cron", "0 8 * * 1-6"), "folder": s.get("folder", "")}]
            if "schedules" not in cfg:
                cfg["schedules"] = []
            return cfg
        except Exception:
            pass
    return {"folder": "", "files": [], "recent_folders": [], "schedules": []}

def _save_config(data: dict):
    _CONFIG_FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")

# ── In-memory stores ──────────────────────────────────────────────────────────
_jobs: dict[str, dict] = {}          # job_id → job
_running_files: set[str] = set()     # absolute paths currently being refreshed
_audit: list[dict]     = []          # completed job summaries (last 200)
_lock  = threading.Lock()

def _make_job(files: list[str]) -> dict:
    return {
        "job_id":      str(uuid.uuid4()),
        "status":      "running",
        "started_at":  datetime.now().isoformat(timespec="seconds"),
        "finished_at": None,
        "files":       files,
        "log":         [],
        "error":       None,
        "refreshed":   0,
        "failed":      0,
        "cancelled":   False,
        "current_file": None,
        "total_files":  0,
        "done_files":   0,
    }

# ── Excel refresh worker ──────────────────────────────────────────────────────
def _refresh_worker(job: dict):
    jid = job["job_id"]

    def log(msg: str):
        ts = datetime.now().strftime("%H:%M:%S")
        with _lock:
            _jobs[jid]["log"].append(f"[{ts}] {msg}")

    try:
        import pythoncom
        pythoncom.CoInitialize()
        import win32com.client

        log("Starting Excel (hidden)…")
        xl = win32com.client.DispatchEx("Excel.Application")
        xl.Visible = False
        xl.DisplayAlerts = False
        xl.AskToUpdateLinks = False

        # Expand folders
        expanded: list[Path] = []
        for fp in job["files"]:
            p = Path(fp.strip().rstrip("\\/"))
            if p.is_dir():
                for ext in ("*.xlsx", "*.xlsm", "*.xlsb", "*.xls"):
                    expanded.extend(p.glob(ext))
                log(f"Folder: {p.name} — {len(expanded)} file(s) found")
            elif p.exists():
                expanded.append(p)
            else:
                log(f"SKIP (not found): {fp}")

        with _lock:
            _jobs[jid]["total_files"] = len(expanded)

        ok, fail = 0, 0
        for path in expanded:
            # Check cancel flag before each file
            with _lock:
                if _jobs[jid].get("cancelled"):
                    log("⛔ Cancelled by user.")
                    break
                _jobs[jid]["current_file"] = path.name
            log(f"Opening: {path.name}")
            try:
                wb = xl.Workbooks.Open(
                    str(path.resolve()),
                    UpdateLinks=False, ReadOnly=False,
                    IgnoreReadOnlyRecommended=True,
                )
                log("  Refreshing ODBC connections…")
                wb.RefreshAll()
                xl.CalculateUntilAsyncQueriesDone()
                # Pivot tables
                pc_count = 0
                try:
                    for pc in wb.PivotCaches():
                        try: pc.Refresh(); pc_count += 1
                        except Exception: pass
                except Exception: pass
                if pc_count:
                    log(f"  Pivot tables refreshed: {pc_count}")
                wb.Save()
                wb.Close(SaveChanges=False)
                log(f"  ✓ Done: {path.name}")
                ok += 1
            except Exception as e:
                log(f"  ✗ ERROR on {path.name}: {e}")
                fail += 1
            with _lock:
                _jobs[jid]["done_files"] = ok + fail
                _running_files.discard(str(path.resolve()))

        xl.Quit()
        pythoncom.CoUninitialize()

        with _lock:
            was_cancelled = _jobs[jid].get("cancelled", False)
        abs_paths = {str(Path(f).resolve()) for f in job["files"]}
        if was_cancelled:
            log(f"Stopped — {ok} refreshed, {fail} failed before cancel.")
            with _lock:
                _jobs[jid].update(status="cancelled", current_file=None,
                                  finished_at=datetime.now().isoformat(timespec="seconds"),
                                  refreshed=ok, failed=fail)
                _audit.append({**_jobs[jid]})
                _running_files.difference_update(abs_paths)
        else:
            log(f"All done — {ok} refreshed, {fail} failed.")
            with _lock:
                _jobs[jid].update(status="done", current_file=None,
                                  finished_at=datetime.now().isoformat(timespec="seconds"),
                                  refreshed=ok, failed=fail)
                _audit.append({**_jobs[jid]})
                _running_files.difference_update(abs_paths)
            if len(_audit) > 200: _audit.pop(0)

    except Exception as e:
        import traceback
        msg = f"{type(e).__name__}: {e}\n{traceback.format_exc()}"
        abs_paths = {str(Path(f).resolve()) for f in job["files"]}
        with _lock:
            _jobs[jid].update(status="error", error=msg,
                              finished_at=datetime.now().isoformat(timespec="seconds"))
            _jobs[jid]["log"].append(msg)
            _audit.append({**_jobs[jid]})
            _running_files.difference_update(abs_paths)

# ── Scheduler (simple background thread) ─────────────────────────────────────
_sched_thread: Optional[threading.Thread] = None
_sched_stop   = threading.Event()

def _cron_matches(cron: str, now: datetime) -> bool:
    parts = cron.split()
    if len(parts) != 5: return False
    m_ok = parts[0] == "*" or int(parts[0]) == now.minute
    h_ok = parts[1] == "*" or int(parts[1]) == now.hour
    d_ok = parts[4] == "*" or str(now.weekday()) in parts[4].split(",") or \
           any(str(now.isoweekday()) in p for p in parts[4].split("-"))
    return m_ok and h_ok and d_ok

def _sched_loop():
    """Checks every minute — fires all enabled schedules whose cron matches now."""
    while not _sched_stop.is_set():
        cfg = _load_config()
        now = datetime.now()
        for s in cfg.get("schedules", []):
            if not s.get("enabled"): continue
            if not _cron_matches(s.get("cron", ""), now): continue
            sched_folder = s.get("folder", "").strip()
            if sched_folder:
                p = Path(sched_folder)
                files_to_run = [str(f) for ext in ("*.xlsx","*.xlsm","*.xlsb","*.xls") for f in p.glob(ext)] if p.is_dir() else []
            else:
                files_to_run = cfg.get("files", [])
            if files_to_run:
                job = _make_job(files_to_run)
                with _lock: _jobs[job["job_id"]] = job
                threading.Thread(target=_refresh_worker, args=(job,), daemon=True).start()
        _sched_stop.wait(60)

def _ensure_scheduler():
    global _sched_thread
    if _sched_thread is None or not _sched_thread.is_alive():
        _sched_stop.clear()
        _sched_thread = threading.Thread(target=_sched_loop, daemon=True)
        _sched_thread.start()

_ensure_scheduler()

# ── Pydantic models ───────────────────────────────────────────────────────────
class ConfigUpdate(BaseModel):
    folder:   Optional[str]       = None
    files:    Optional[list[str]] = None
    schedule: Optional[dict]      = None

class RunRequest(BaseModel):
    files: Optional[list[str]] = None

class ScheduleEntry(BaseModel):
    id:      Optional[str] = None
    enabled: bool          = True
    cron:    str           = "0 8 * * 1-6"
    folder:  str           = ""

# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/config")
def get_config():
    return {"success": True, "data": _load_config()}

@router.post("/config")
def save_config(body: ConfigUpdate):
    cfg = _load_config()
    if body.folder is not None:
        cfg["folder"] = body.folder
        # maintain recent_folders (last 5, no duplicates)
        if body.folder:
            recents = cfg.get("recent_folders", [])
            if body.folder in recents:
                recents.remove(body.folder)
            recents.insert(0, body.folder)
            cfg["recent_folders"] = recents[:5]
    if body.files    is not None: cfg["files"]    = body.files
    if body.schedule is not None: cfg["schedule"] = body.schedule
    _save_config(cfg)
    return {"success": True}

# ── Folder listing ────────────────────────────────────────────────────────────
@router.get("/folder-files")
def list_folder_files(path: str = ""):
    if not path:
        cfg = _load_config()
        path = cfg.get("folder", "")
    if not path:
        return {"success": True, "data": []}
    p = Path(path)
    if not p.exists() or not p.is_dir():
        raise HTTPException(400, f"Folder not found: {path}")
    files = []
    for ext in ("*.xlsx", "*.xlsm", "*.xlsb", "*.xls"):
        for f in sorted(p.glob(ext)):
            stat = f.stat()
            files.append({
                "name": f.name,
                "path": str(f),
                "size": stat.st_size,
                "modified": datetime.fromtimestamp(stat.st_mtime).isoformat(timespec="seconds"),
            })
    files.sort(key=lambda x: x["size"])
    return {"success": True, "data": files}

# ── Health check ──────────────────────────────────────────────────────────────
@router.get("/health")
def health_check():
    results = {}
    # Check Oracle via cx_Oracle (same as pipeline)
    try:
        import cx_Oracle
        conn = cx_Oracle.connect("Report", "Report", "10.0.0.15:1521/Ginesys")
        cur = conn.cursor()
        cur.execute("SELECT SYSDATE FROM DUAL")
        row = cur.fetchone()
        conn.close()
        results["oracle"] = {"status": "ok", "sysdate": str(row[0]) if row else "?"}
    except Exception as e:
        results["oracle"] = {"status": "error", "error": str(e)}
    # Check win32com availability
    try:
        import win32com.client
        results["win32com"] = {"status": "ok"}
    except Exception as e:
        results["win32com"] = {"status": "error", "error": str(e)}
    # Check folder
    cfg = _load_config()
    folder = cfg.get("folder", "")
    if folder:
        p = Path(folder)
        results["folder"] = {"status": "ok" if p.exists() else "error",
                             "path": folder, "accessible": p.exists()}
    else:
        results["folder"] = {"status": "not_set"}
    return {"success": True, "data": results}

# ── Run refresh ───────────────────────────────────────────────────────────────
@router.post("/run")
def run_refresh(body: RunRequest):
    cfg = _load_config()
    files = body.files if body.files is not None else cfg.get("files", [])
    if not files:
        raise HTTPException(400, "No files selected. Select files or configure a folder first.")
    # Check for files already running
    abs_files = [str(Path(f).resolve()) for f in files]
    with _lock:
        conflicts = [Path(f).name for f in abs_files if f in _running_files]
    if conflicts:
        raise HTTPException(409, f"Already running: {', '.join(conflicts)}. Wait for the current job to finish.")
    job = _make_job(files)
    with _lock:
        _jobs[job["job_id"]] = job
        _running_files.update(abs_files)
    threading.Thread(target=_refresh_worker, args=(job,), daemon=True).start()
    return {"success": True, "data": {"job_id": job["job_id"]}}

# ── Job status ────────────────────────────────────────────────────────────────
@router.get("/status/{job_id}")
def job_status(job_id: str):
    with _lock:
        job = _jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    return {"success": True, "data": job}

@router.post("/cancel/{job_id}")
def cancel_job(job_id: str):
    with _lock:
        job = _jobs.get(job_id)
        if not job:
            raise HTTPException(404, "Job not found")
        if job["status"] != "running":
            raise HTTPException(400, f"Job is not running (status: {job['status']})")
        job["cancelled"] = True
    return {"success": True, "message": "Cancel signal sent — will stop after current file."}

@router.get("/jobs")
def list_jobs():
    with _lock:
        jobs = list(_jobs.values())
    jobs.sort(key=lambda j: j["started_at"], reverse=True)
    return {"success": True, "data": jobs[:20]}

# ── Audit log ─────────────────────────────────────────────────────────────────
@router.get("/audit")
def get_audit():
    with _lock:
        data = list(reversed(_audit))
    return {"success": True, "data": data}

# ── Scheduler ─────────────────────────────────────────────────────────────────
@router.delete("/recent-folder")
def delete_recent_folder(path: str):
    cfg = _load_config()
    recents = cfg.get("recent_folders", [])
    cfg["recent_folders"] = [r for r in recents if r != path]
    _save_config(cfg)
    return {"success": True, "data": cfg["recent_folders"]}

@router.get("/schedules")
def get_schedules():
    cfg = _load_config()
    return {"success": True, "data": cfg.get("schedules", [])}

@router.post("/schedules")
def add_schedule(body: ScheduleEntry):
    cfg = _load_config()
    entry = {"id": str(uuid.uuid4()), "enabled": body.enabled, "cron": body.cron, "folder": body.folder}
    cfg.setdefault("schedules", []).append(entry)
    _save_config(cfg)
    _ensure_scheduler()
    return {"success": True, "data": entry}

@router.put("/schedules/{sid}")
def update_schedule(sid: str, body: ScheduleEntry):
    cfg = _load_config()
    schedules = cfg.get("schedules", [])
    for i, s in enumerate(schedules):
        if s["id"] == sid:
            schedules[i] = {"id": sid, "enabled": body.enabled, "cron": body.cron, "folder": body.folder}
            _save_config(cfg)
            _ensure_scheduler()
            return {"success": True}
    raise HTTPException(404, "Schedule not found")

@router.delete("/schedules/{sid}")
def delete_schedule(sid: str):
    cfg = _load_config()
    schedules = cfg.get("schedules", [])
    cfg["schedules"] = [s for s in schedules if s["id"] != sid]
    _save_config(cfg)
    return {"success": True}
