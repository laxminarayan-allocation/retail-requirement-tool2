"""
deploy.py — Git pull + smart service restart agent.

POST /api/deploy/run     — pull latest, detect changes, restart as needed
GET  /api/deploy/status  — current git status + last deploy result
GET  /api/deploy/log     — last N lines of deploy log
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path
from typing import Any

from fastapi import APIRouter
from fastapi.responses import JSONResponse

router = APIRouter()

_ROOT = Path(__file__).resolve().parents[4]          # retail_requirement_tool/
_BACKEND = _ROOT / "backend"
_FRONTEND = _ROOT / "frontend"
_LOG_FILE = Path(tempfile.gettempdir()) / "ss27_deploy.log"

_state: dict[str, Any] = {
    "running": False,
    "last_started": None,
    "last_finished": None,
    "last_status": None,   # "ok" | "error"
    "last_summary": "",
    "steps": [],
}
_lock = threading.Lock()


# ── helpers ───────────────────────────────────────────────────────────────────

def _log(msg: str) -> None:
    ts = time.strftime("%H:%M:%S")
    line = f"[{ts}] {msg}"
    with _lock:
        _state["steps"].append(line)
    with open(_LOG_FILE, "a", encoding="utf-8") as f:
        f.write(line + "\n")


def _run(cmd: list[str], cwd: Path | None = None, timeout: int = 120) -> tuple[int, str]:
    try:
        r = subprocess.run(
            cmd, cwd=str(cwd or _ROOT),
            capture_output=True, text=True,
            timeout=timeout, encoding="utf-8", errors="replace",
        )
        return r.returncode, (r.stdout + r.stderr).strip()
    except subprocess.TimeoutExpired:
        return 1, "Timeout"
    except Exception as e:
        return 1, str(e)


def _changed_files(before_sha: str, after_sha: str) -> list[str]:
    if before_sha == after_sha:
        return []
    rc, out = _run(["git", "diff", "--name-only", before_sha, after_sha])
    if rc != 0:
        return []
    return [l.strip() for l in out.splitlines() if l.strip()]


def _restart_uvicorn() -> None:
    """Touch main.py so uvicorn --reload picks it up immediately."""
    main_py = _BACKEND / "app" / "main.py"
    main_py.touch()
    _log("  → Touched main.py — uvicorn --reload will restart the server")


def _deploy() -> None:
    with _lock:
        _state["running"] = True
        _state["last_started"] = time.strftime("%Y-%m-%dT%H:%M:%S")
        _state["steps"] = []

    try:
        # 1. Current HEAD
        _, before_sha = _run(["git", "rev-parse", "HEAD"])
        before_sha = before_sha.strip()
        _log(f"Before: {before_sha[:10]}")

        # 2. Fetch + pull
        _log("git fetch …")
        rc, out = _run(["git", "fetch", "--no-tags"], timeout=30)
        _log(f"  {out[:200]}" if out else "  (no output)")

        _log("git pull …")
        rc, out = _run(["git", "pull", "--ff-only"], timeout=60)
        _log(f"  {out[:300]}")
        if rc != 0:
            _log("ERROR: git pull failed")
            with _lock:
                _state["last_status"] = "error"
                _state["last_summary"] = "git pull failed: " + out[:200]
                _state["running"] = False
                _state["last_finished"] = time.strftime("%Y-%m-%dT%H:%M:%S")
            return

        # 3. New HEAD
        _, after_sha = _run(["git", "rev-parse", "HEAD"])
        after_sha = after_sha.strip()
        _log(f"After:  {after_sha[:10]}")

        if before_sha == after_sha:
            _log("Already up to date — no restarts needed")
            with _lock:
                _state["last_status"] = "ok"
                _state["last_summary"] = "Already up to date"
                _state["running"] = False
                _state["last_finished"] = time.strftime("%Y-%m-%dT%H:%M:%S")
            return

        changed = _changed_files(before_sha, after_sha)
        _log(f"Changed files ({len(changed)}): {', '.join(changed[:10])}")

        backend_changed = any(f.startswith("backend/") for f in changed)
        reqs_changed   = "backend/requirements.txt" in changed
        frontend_changed = any(f.startswith("frontend/") for f in changed)
        pkg_changed    = "frontend/package.json" in changed

        # 4. pip install if requirements changed
        if reqs_changed:
            _log("requirements.txt changed — pip install …")
            rc, out = _run(
                [sys.executable, "-m", "pip", "install", "-r", "requirements.txt", "-q"],
                cwd=_BACKEND, timeout=180,
            )
            _log(f"  pip: {out[:300]}" if out else "  pip: ok")

        # 5. Restart backend (uvicorn auto-reload via file touch)
        if backend_changed:
            _log("Backend files changed — triggering uvicorn reload …")
            _restart_uvicorn()

        # 6. npm install if package.json changed
        if pkg_changed:
            _log("package.json changed — npm install …")
            rc, out = _run(["npm", "install", "--prefer-offline"], cwd=_FRONTEND, timeout=180)
            _log(f"  npm: {out[:200]}" if out else "  npm: ok")

        # 7. Frontend HMR picks up .tsx/.ts changes automatically via vite
        if frontend_changed and not pkg_changed:
            _log("Frontend files changed — Vite HMR will pick them up automatically")

        summary_parts = []
        if backend_changed: summary_parts.append("backend reloaded")
        if frontend_changed: summary_parts.append("frontend HMR active")
        if reqs_changed: summary_parts.append("pip install done")
        if pkg_changed: summary_parts.append("npm install done")
        summary = "; ".join(summary_parts) if summary_parts else "pulled, no service changes"

        _log(f"Deploy done: {summary}")
        with _lock:
            _state["last_status"] = "ok"
            _state["last_summary"] = summary
    except Exception as e:
        _log(f"EXCEPTION: {e}")
        with _lock:
            _state["last_status"] = "error"
            _state["last_summary"] = str(e)
    finally:
        with _lock:
            _state["running"] = False
            _state["last_finished"] = time.strftime("%Y-%m-%dT%H:%M:%S")


# ── endpoints ─────────────────────────────────────────────────────────────────

@router.post("/deploy/run")
def deploy_run() -> JSONResponse:
    with _lock:
        if _state["running"]:
            return JSONResponse({"ok": False, "error": "Deploy already running"})

    threading.Thread(target=_deploy, daemon=True).start()
    return JSONResponse({"ok": True, "message": "Deploy started"})


@router.get("/deploy/status")
def deploy_status() -> JSONResponse:
    # also return git info
    _, current_sha = _run(["git", "rev-parse", "--short", "HEAD"])
    _, branch = _run(["git", "rev-parse", "--abbrev-ref", "HEAD"])
    _, last_msg = _run(["git", "log", "-1", "--format=%s"])
    _, remote_sha = _run(["git", "rev-parse", "--short", "origin/master"])

    with _lock:
        state_copy = dict(_state)
        steps = list(_state["steps"])

    return JSONResponse({
        "ok": True,
        "data": {
            **state_copy,
            "steps": steps,
            "git": {
                "sha": current_sha.strip(),
                "branch": branch.strip(),
                "last_commit": last_msg.strip(),
                "remote_sha": remote_sha.strip(),
                "behind": current_sha.strip() != remote_sha.strip(),
            },
        },
    })


@router.get("/deploy/log")
def deploy_log(lines: int = 100) -> JSONResponse:
    if not _LOG_FILE.exists():
        return JSONResponse({"ok": True, "data": {"lines": []}})
    try:
        all_lines = _LOG_FILE.read_text(encoding="utf-8", errors="ignore").splitlines()
        return JSONResponse({"ok": True, "data": {"lines": all_lines[-lines:]}})
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)})
