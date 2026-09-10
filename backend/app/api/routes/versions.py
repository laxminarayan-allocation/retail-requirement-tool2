"""
Version Control — GET /api/versions, POST /api/versions (admin only)
Changelog stored in backend/versions.json
"""
import json
import logging
import os
import uuid
from datetime import date

from fastapi import APIRouter, Request

from app.models.response_models import APIResponse

import re
import subprocess

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/versions", tags=["Versions"])

# Commit prefix → version type mapping
_PREFIX_TYPE = {
    "feat": "feature", "feature": "feature",
    "fix": "fix", "bugfix": "fix", "hotfix": "fix",
    "perf": "improvement", "refactor": "improvement",
    "improvement": "improvement", "enhance": "improvement",
    "ui": "improvement", "style": "improvement",
    "breaking": "breaking", "break": "breaking",
}

def _commit_type(msg: str) -> str:
    prefix = msg.split(":")[0].strip().lower().lstrip("!")
    return _PREFIX_TYPE.get(prefix, "improvement")

def _next_patch(existing: list) -> str:
    """Auto-increment patch version from latest entry."""
    versions = []
    for e in existing:
        try:
            parts = [int(x) for x in e.get("version", "0.0.0").split(".")]
            if len(parts) == 3:
                versions.append(parts)
        except Exception:
            pass
    if not versions:
        return "1.4.0"
    latest = max(versions)
    latest[2] += 1
    return ".".join(str(x) for x in latest)

def _git_log(since_hash: str | None = None, limit: int = 50) -> list[dict]:
    """Return parsed git commits as list of dicts."""
    repo_root = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
    cmd = ["git", "log", f"--format=%H|%ad|%s|%an", "--date=format:%Y-%m-%d", f"-{limit}"]
    if since_hash:
        cmd.append(f"{since_hash}..HEAD")
    try:
        result = subprocess.run(cmd, cwd=repo_root, capture_output=True, text=True, timeout=10)
        commits = []
        for line in result.stdout.strip().splitlines():
            parts = line.split("|", 3)
            if len(parts) == 4:
                commits.append({"hash": parts[0], "date": parts[1], "msg": parts[2], "author": parts[3]})
        return commits
    except Exception as exc:
        logger.warning("git log failed: %s", exc)
        return []

_VERSIONS_FILE = os.path.normpath(
    os.path.join(os.path.dirname(__file__), "..", "..", "..", "versions.json")
)


def _load() -> list:
    try:
        with open(_VERSIONS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        return sorted(data, key=lambda x: x.get("date", ""), reverse=True)
    except Exception as exc:
        logger.error("versions load failed: %s", exc)
        return []


def _save(data: list) -> None:
    with open(_VERSIONS_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def _is_admin(request: Request) -> bool:
    user = getattr(request.state, "user", None)
    return bool(user and user.get("role") in ("admin", "temp_admin"))


@router.get("", response_model=APIResponse)
async def get_versions():
    """Return all version entries, newest first."""
    return APIResponse.ok(data={"versions": _load()})


@router.post("", response_model=APIResponse)
async def add_version(request: Request):
    """Add a new version entry (admin only)."""
    if not _is_admin(request):
        return APIResponse.fail(message="Admin access required.")
    body = await request.json()

    version = (body.get("version") or "").strip()
    title = (body.get("title") or "").strip()
    desc = (body.get("desc") or "").strip()
    entry_type = (body.get("type") or "feature").strip()
    entry_date = (body.get("date") or str(date.today())).strip()

    if not version or not title:
        return APIResponse.fail(message="version aur title required hain.")

    user = getattr(request.state, "user", None)
    added_by = user.get("email", "unknown") if user else "unknown"

    entry = {
        "id": f"v{version}-{uuid.uuid4().hex[:6]}",
        "version": version,
        "date": entry_date,
        "type": entry_type,
        "title": title,
        "desc": desc,
        "released": body.get("released", False),
        "added_by": added_by,
    }

    data = _load()
    # keep newest-first in file too
    data.insert(0, entry)
    data_sorted = sorted(data, key=lambda x: (x.get("date", ""), x.get("version", "")), reverse=True)
    _save(data_sorted)
    logger.info("Version entry added: %s by %s", version, added_by)
    return APIResponse.ok(data={"entry": entry}, message=f"Version {version} added.")


@router.patch("/{entry_id}", response_model=APIResponse)
async def update_version(entry_id: str, request: Request):
    """Toggle released flag or update fields (admin only)."""
    if not _is_admin(request):
        return APIResponse.fail(message="Admin access required.")
    body = await request.json()
    data = _load()
    for entry in data:
        if entry.get("id") == entry_id:
            for field in ("version", "title", "desc", "type", "date", "released"):
                if field in body:
                    entry[field] = body[field]
            _save(sorted(data, key=lambda x: (x.get("date", ""), x.get("version", "")), reverse=True))
            return APIResponse.ok(data={"entry": entry}, message="Entry updated.")
    return APIResponse.fail(message=f"Entry {entry_id} not found.")


@router.post("/sync-git", response_model=APIResponse)
async def sync_from_git(request: Request):
    """
    Read recent git commits and auto-create version entries for any
    commit not already tracked. Groups same-day commits into one entry.
    Admin only.
    """
    if not _is_admin(request):
        return APIResponse.fail(message="Admin access required.")

    body = {}
    try:
        body = await request.json()
    except Exception:
        pass

    limit = int(body.get("limit", 30))
    data = _load()

    # Build set of already-tracked git hashes and dates
    tracked_hashes: set[str] = set()
    for e in data:
        if e.get("git_hash"):
            tracked_hashes.add(e["git_hash"])

    commits = _git_log(limit=limit)
    if not commits:
        return APIResponse.fail(message="Git log empty or git not available.")

    # Filter commits not yet tracked and skip merge/doc/chore/test commits
    skip_prefixes = ("chore", "docs", "test", "ci", "merge", "wip", "tmp")
    new_commits = []
    for c in commits:
        if c["hash"] in tracked_hashes:
            continue
        prefix = c["msg"].split(":")[0].strip().lower().lstrip("!")
        if prefix in skip_prefixes:
            continue
        new_commits.append(c)

    if not new_commits:
        return APIResponse.ok(message="Koi naya commit nahi mila jo track karna ho.", data={"added": 0})

    # Group by date — same date commits → one entry (newest version per date)
    from collections import defaultdict
    by_date: dict[str, list] = defaultdict(list)
    for c in new_commits:
        by_date[c["date"]].append(c)

    added = 0
    user = getattr(request.state, "user", None)
    added_by = user.get("email", "auto") if user else "auto"

    for entry_date in sorted(by_date.keys(), reverse=True):
        day_commits = by_date[entry_date]
        # Determine dominant type for the day
        types = [_commit_type(c["msg"]) for c in day_commits]
        dominant = max(set(types), key=types.count)
        # Build title from first commit's message (strip prefix)
        first_msg = day_commits[0]["msg"]
        title_body = first_msg.split(":", 1)[-1].strip() if ":" in first_msg else first_msg
        # Build desc listing all commit messages
        desc_lines = []
        for c in day_commits:
            desc_lines.append(f"• {c['msg']}")
        desc = "\n".join(desc_lines)

        version_str = _next_patch(data)
        entry = {
            "id": f"v{version_str}-auto",
            "version": version_str,
            "date": entry_date,
            "type": dominant,
            "title": title_body if len(day_commits) == 1 else f"{len(day_commits)} updates ({entry_date})",
            "desc": desc,
            "released": True,
            "added_by": added_by,
            "git_hash": day_commits[0]["hash"],
            "auto": True,
        }
        data.insert(0, entry)
        added += 1

    data_sorted = sorted(data, key=lambda x: (x.get("date", ""), x.get("version", "")), reverse=True)
    _save(data_sorted)
    logger.info("sync-git: %d new entries added", added)
    return APIResponse.ok(
        data={"added": added, "total": len(data_sorted)},
        message=f"{added} naye entries add kiye git commits se.",
    )


@router.delete("/{entry_id}", response_model=APIResponse)
async def delete_version(entry_id: str, request: Request):
    """Delete a version entry (admin only)."""
    if not _is_admin(request):
        return APIResponse.fail(message="Admin access required.")
    data = _load()
    new_data = [e for e in data if e.get("id") != entry_id]
    if len(new_data) == len(data):
        return APIResponse.fail(message=f"Entry {entry_id} not found.")
    _save(new_data)
    return APIResponse.ok(message="Entry deleted.")
