"""
run_logs.py — Run & Parameter Logs for the SS27 allocation pipeline.

Reads append-only JSONL files from <_OUT_BASE>/logs/:
  runs.jsonl          — one record per pipeline run
  param_changes.jsonl — one record per parameter change

GET /pipeline/logs/runs            — paginated run records (newest first)
GET /pipeline/logs/param-changes   — paginated parameter change records (newest first)
GET /pipeline/logs/timeline        — merged timeline of runs + changes (newest first)
"""
from __future__ import annotations

import json
import tempfile
from pathlib import Path

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse

router = APIRouter()

_LOGS = Path(tempfile.gettempdir()) / "ss27_pipeline" / "logs"


_LOGS.mkdir(parents=True, exist_ok=True)


def _read_jsonl(name: str) -> list[dict]:
    p = _LOGS / name
    if not p.exists():
        return []
    out = []
    try:
        with open(p, encoding="utf-8", errors="ignore") as f:
            for line in f:
                line = line.strip()
                if line:
                    try:
                        out.append(json.loads(line))
                    except json.JSONDecodeError:
                        pass
    except Exception:
        pass
    return list(reversed(out))  # newest first


@router.get("/pipeline/logs/runs")
def logs_runs(limit: int = Query(100), offset: int = Query(0)) -> JSONResponse:
    starts = _read_jsonl("runs.jsonl")
    events = {r["job_id"]: r for r in _read_jsonl("run_events.jsonl") if "job_id" in r}
    # merge: attach completion status to each run start record
    rows = []
    for r in starts:
        merged = dict(r)
        ev = events.get(r.get("job_id", ""))
        if ev:
            merged["status"] = ev.get("status", "")
            merged["finished_at"] = ev.get("ts", "")
            merged["files"] = ev.get("files", [])
        else:
            merged["status"] = "running"
        rows.append(merged)
    total = len(rows)
    return JSONResponse({"ok": True, "data": {"total": total, "rows": rows[offset: offset + limit]}})


@router.get("/pipeline/logs/param-changes")
def logs_param_changes(limit: int = Query(200), offset: int = Query(0)) -> JSONResponse:
    rows = _read_jsonl("param_changes.jsonl")
    total = len(rows)
    return JSONResponse({"ok": True, "data": {"total": total, "rows": rows[offset: offset + limit]}})


@router.get("/pipeline/logs/timeline")
def logs_timeline(limit: int = Query(200), offset: int = Query(0)) -> JSONResponse:
    starts = _read_jsonl("runs.jsonl")
    events_map = {r["job_id"]: r for r in _read_jsonl("run_events.jsonl") if "job_id" in r}
    runs = []
    for r in starts:
        ev = events_map.get(r.get("job_id", ""))
        item = {"_type": "run", **r, "status": ev.get("status", "running") if ev else "running"}
        if ev:
            item["finished_at"] = ev.get("ts", "")
            item["files"] = ev.get("files", [])
        runs.append(item)
    changes = [{"_type": "param_change", **r} for r in _read_jsonl("param_changes.jsonl")]
    merged = sorted(runs + changes, key=lambda r: r.get("ts", r.get("when", "")), reverse=True)
    total = len(merged)
    return JSONResponse({"ok": True, "data": {"total": total, "rows": merged[offset: offset + limit]}})
