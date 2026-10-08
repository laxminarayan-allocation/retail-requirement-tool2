"""
deploy.py — Git pull + smart service restart agent.

POST /api/deploy/run          — pull latest, detect changes, restart as needed
POST /api/deploy/webhook      — GitHub webhook auto-deploy trigger
GET  /api/deploy/status       — current git status + last deploy result
GET  /api/deploy/log          — last N lines of deploy log
GET  /api/deploy/history      — all past deploy runs
"""
from __future__ import annotations

import json
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

router = APIRouter()

_ROOT    = Path(__file__).resolve().parents[4]          # retail_requirement_tool/
_BACKEND = _ROOT / "backend"
_FRONTEND = _ROOT / "frontend"

# Git executable — full path so it works regardless of PATH in the server process
_GIT = "C:/Users/allocation_user/AppData/Local/Programs/Git/cmd/git.exe"
_LOGS_DIR = _ROOT / "data" / "output" / "logs"
_LOGS_DIR.mkdir(parents=True, exist_ok=True)
_LOG_FILE     = _LOGS_DIR / "deploy.log"
_HISTORY_FILE = _LOGS_DIR / "deploy_history.jsonl"

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


def _append_history(record: dict) -> None:
    with open(_HISTORY_FILE, "a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")


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
    rc, out = _run([_GIT, "diff", "--name-only", before_sha, after_sha])
    if rc != 0:
        return []
    return [l.strip() for l in out.splitlines() if l.strip()]


def _restart_uvicorn() -> None:
    """Touch main.py so uvicorn --reload picks it up immediately."""
    main_py = _BACKEND / "app" / "main.py"
    main_py.touch()
    _log("  → Touched main.py — uvicorn --reload will restart the server")


def _deploy(build_frontend: bool = False) -> None:
    with _lock:
        _state["running"] = True
        _state["last_started"] = time.strftime("%Y-%m-%dT%H:%M:%S")
        _state["steps"] = []

    started_at = time.strftime("%Y-%m-%dT%H:%M:%S")

    try:
        # 1. Current HEAD
        _, before_sha = _run([_GIT, "rev-parse", "HEAD"])
        before_sha = before_sha.strip()
        _log(f"Before: {before_sha[:10]}")

        # 2. Fetch + pull
        _log("git fetch …")
        rc, out = _run([_GIT, "fetch", "--no-tags"], timeout=30)
        _log(f"  {out[:200]}" if out else "  (no output)")

        _log("git pull …")
        rc, out = _run([_GIT, "pull", "--ff-only"], timeout=60)
        _log(f"  {out[:300]}")
        if rc != 0:
            _log("ERROR: git pull failed")
            summary = "git pull failed: " + out[:200]
            with _lock:
                _state["last_status"] = "error"
                _state["last_summary"] = summary
                _state["running"] = False
                _state["last_finished"] = time.strftime("%Y-%m-%dT%H:%M:%S")
            _append_history({"ts": started_at, "status": "error", "summary": summary, "build_frontend": build_frontend})
            return

        # 3. New HEAD
        _, after_sha = _run([_GIT, "rev-parse", "HEAD"])
        after_sha = after_sha.strip()
        _log(f"After:  {after_sha[:10]}")

        if before_sha == after_sha and not build_frontend:
            _log("Already up to date — no restarts needed")
            summary = "Already up to date"
            with _lock:
                _state["last_status"] = "ok"
                _state["last_summary"] = summary
                _state["running"] = False
                _state["last_finished"] = time.strftime("%Y-%m-%dT%H:%M:%S")
            _append_history({"ts": started_at, "status": "ok", "summary": summary, "build_frontend": build_frontend})
            return

        changed = _changed_files(before_sha, after_sha)

        _log(f"Changed files ({len(changed)}): {', '.join(changed[:10])}")

        backend_changed  = any(f.startswith("backend/") for f in changed)
        reqs_changed     = "backend/requirements.txt" in changed
        frontend_changed = any(f.startswith("frontend/") for f in changed)
        pkg_changed      = "frontend/package.json" in changed

        # 4. pip install if requirements changed
        if reqs_changed:
            _log("requirements.txt changed — pip install …")
            rc, out = _run(
                [sys.executable, "-m", "pip", "install", "-r", "requirements.txt", "-q"],
                cwd=_BACKEND, timeout=180,
            )
            _log(f"  pip: {out[:300]}" if out else "  pip: ok")

        # 5. Restart backend
        if backend_changed:
            _log("Backend files changed — triggering uvicorn reload …")
            _restart_uvicorn()

        # 6. npm install if package.json changed
        if pkg_changed:
            _log("package.json changed — npm install …")
            rc, out = _run(["npm", "install", "--prefer-offline"], cwd=_FRONTEND, timeout=180)
            _log(f"  npm: {out[:200]}" if out else "  npm: ok")

        # 7. Vite build for mobile (Tailscale)
        if build_frontend or (frontend_changed and not pkg_changed):
            if build_frontend:
                _log("Building frontend for mobile (vite build) …")
                rc, out = _run(["npx", "vite", "build"], cwd=_FRONTEND, timeout=300)
                _log(f"  vite build: {'ok' if rc == 0 else 'FAILED'}")
                if out:
                    _log(f"  {out[-300:]}")
            else:
                _log("Frontend files changed — Vite HMR will pick them up automatically")

        summary_parts = []
        if backend_changed:     summary_parts.append("backend reloaded")
        if frontend_changed:    summary_parts.append("frontend updated")
        if reqs_changed:        summary_parts.append("pip install done")
        if pkg_changed:         summary_parts.append("npm install done")
        if build_frontend:      summary_parts.append("mobile build done")
        summary = "; ".join(summary_parts) if summary_parts else "pulled, no service changes"

        _log(f"Deploy done: {summary}")
        with _lock:
            _state["last_status"] = "ok"
            _state["last_summary"] = summary
        _append_history({
            "ts": started_at,
            "status": "ok",
            "summary": summary,
            "build_frontend": build_frontend,
            "changed_files": changed,
            "before_sha": before_sha[:10],
            "after_sha": after_sha[:10],
        })

    except Exception as e:
        _log(f"EXCEPTION: {e}")
        with _lock:
            _state["last_status"] = "error"
            _state["last_summary"] = str(e)
        _append_history({"ts": started_at, "status": "error", "summary": str(e), "build_frontend": build_frontend})
    finally:
        with _lock:
            _state["running"] = False
            _state["last_finished"] = time.strftime("%Y-%m-%dT%H:%M:%S")


# ── endpoints ─────────────────────────────────────────────────────────────────

@router.post("/deploy/run")
def deploy_run(request: Request) -> JSONResponse:
    with _lock:
        if _state["running"]:
            return JSONResponse({"ok": False, "error": "Deploy already running"})

    # optional ?build_frontend=true query param
    build_frontend = request.query_params.get("build_frontend", "false").lower() == "true"
    threading.Thread(target=_deploy, args=(build_frontend,), daemon=True).start()
    return JSONResponse({"ok": True, "message": "Deploy started", "build_frontend": build_frontend})


@router.post("/deploy/webhook")
async def deploy_webhook(request: Request) -> JSONResponse:
    """GitHub webhook — auto-deploy on push to master/main."""
    with _lock:
        if _state["running"]:
            return JSONResponse({"ok": False, "error": "Deploy already running"})

    try:
        payload = await request.json()
    except Exception:
        payload = {}

    ref = payload.get("ref", "")
    # Only trigger on master or main branch pushes
    if ref and ref not in ("refs/heads/master", "refs/heads/main", ""):
        return JSONResponse({"ok": False, "message": f"Ignored ref: {ref}"})

    threading.Thread(target=_deploy, args=(False,), daemon=True).start()
    return JSONResponse({"ok": True, "message": "Webhook deploy started"})


@router.get("/deploy/status")
def deploy_status() -> JSONResponse:
    _, current_sha  = _run([_GIT, "rev-parse", "--short", "HEAD"])
    _, branch       = _run([_GIT, "rev-parse", "--abbrev-ref", "HEAD"])
    _, last_msg     = _run([_GIT, "log", "-1", "--format=%s"])
    _, remote_sha   = _run([_GIT, "rev-parse", "--short", "origin/master"])

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


@router.get("/deploy/history")
def deploy_history(limit: int = 50) -> JSONResponse:
    if not _HISTORY_FILE.exists():
        return JSONResponse({"ok": True, "data": {"rows": []}})
    try:
        rows = []
        for line in _HISTORY_FILE.read_text(encoding="utf-8", errors="ignore").splitlines():
            line = line.strip()
            if line:
                try:
                    rows.append(json.loads(line))
                except json.JSONDecodeError:
                    pass
        rows.reverse()  # newest first
        return JSONResponse({"ok": True, "data": {"rows": rows[:limit]}})
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)})
