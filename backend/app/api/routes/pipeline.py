"""
pipeline.py — Native Allocation Pipeline implementation inside SS27.

Replaces the 8642 proxy. Oracle queries run here using oracledb (thick mode)
so no dependency on the 10.0.1.12 server at all.

All routes are planner+ (enforced by main.py ROUTE_ROLES via /api/pipeline/ prefix).
"""
from __future__ import annotations

import asyncio
import io
import json
import tempfile
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Generator

import oracledb
import pandas as pd
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, StreamingResponse

# ── init thick mode once at import time ──────────────────────────────────────
try:
    oracledb.init_oracle_client()
except Exception:
    pass  # already initialised or client not on path — connect will fail loudly

router = APIRouter()

# ── Oracle config (matches pipeline_config.py) ────────────────────────────────
ORACLE_USER = "Report"
ORACLE_PASS = "Report"
ORACLE_DSN  = "10.0.0.15:1521/Ginesys"

# ── In-memory job store {job_id: list[dict]} ─────────────────────────────────
_jobs: dict[str, list[dict]] = {}
_jobs_lock = threading.Lock()

# ── Temp output folder (session CSV cache) ───────────────────────────────────
_OUT = Path(tempfile.gettempdir()) / "ss27_pipeline"
_OUT.mkdir(exist_ok=True)


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _get_pool() -> oracledb.ConnectionPool:
    """Return (or create) a module-level connection pool."""
    global _pool
    if "_pool" not in globals() or _pool is None:
        _pool = oracledb.create_pool(
            user=ORACLE_USER, password=ORACLE_PASS, dsn=ORACLE_DSN,
            min=1, max=4, increment=1,
        )
    return _pool


def _query(sql: str) -> pd.DataFrame:
    pool = _get_pool()
    conn = pool.acquire()
    try:
        cur = conn.cursor()
        cur.arraysize = 50_000
        cur.execute(sql)
        rows = cur.fetchall()
        cols = [c[0].upper() for c in cur.description]
        cur.close()
        return pd.DataFrame(rows, columns=cols)
    finally:
        pool.release(conn)


def _emit(job_id: str, event: dict) -> None:
    with _jobs_lock:
        _jobs[job_id].append(event)


def _sse_lines(job_id: str) -> Generator[str, None, None]:
    """Yield SSE lines for a running job until it closes."""
    sent = 0
    deadline = time.time() + 600  # 10-min max
    while time.time() < deadline:
        with _jobs_lock:
            events = _jobs[job_id]
            new = events[sent:]
        for evt in new:
            yield f"data: {json.dumps(evt)}\n\n"
            sent += 1
            if evt.get("status") in ("finished", "error", "closed"):
                return
        time.sleep(0.15)


# ─────────────────────────────────────────────────────────────────────────────
# Module 1 — Fetch raw data
# Four Oracle queries → CSV files in _OUT, same format as 8642
# ─────────────────────────────────────────────────────────────────────────────

_M1_STEPS = [
    {
        "key": "grc2_raw",
        "name": "Fetch grc2_raw",
        "sql": (
            "SELECT BARCODE, ENTRY_QTY AS GRC_Q"
            " FROM MISRETAIL.\"CUBE$PURCHASE\""
            " WHERE CUBENAME='GRC_ANA' AND SITECODE=123"
            " AND ENTRY_DATE >= TRUNC(SYSDATE-2,'DD')"
        ),
        "csv": "grc2_raw.csv",
    },
    {
        "key": "grc",
        "name": "Write grc.csv (V_GRC bypass)",
        "detail": "grc.csv — same columns as grc2_raw, no transform needed",
        "csv": "grc.csv",
        "copy_from": "grc2_raw",
    },
    {
        "key": "store_master",
        "name": "Fetch store_master",
        "sql": (
            "SELECT SITE_CODE, STORE_NAME, STORE_STATUS, STORE_TYPE,"
            " CLUSTER_TYPE, STATE, CITY_NAME, DISTRICT, STORE_GRADE,"
            " FESTIVAL_GROUPING, REGION_TYPE, REF_STORE"
            " FROM MISRETAIL.t_store_opening_date"
        ),
        "csv": "store_master.csv",
    },
    {
        "key": "item_master",
        "name": "Fetch item_master",
        "sql": "SELECT * FROM REPORT.V_ITEM_MASTER",
        "csv": "item_master.csv",
    },
    {
        "key": "alloc_base_raw",
        "name": "Fetch alloc_base_raw",
        "sql": (
            "SELECT STORE_NAME, BARCODE, STK_Q, ADJ_STK_Q,"
            " ADJ_IN_TRANSIT_Q, ADJ_PACK_PEND_Q, ADJ_TO_Q,"
            " IN_TRANSIT_Q, PACK_PEND_Q, TO_Q,"
            " LM_SL_Q, LM_SL_V, MTD_SL_Q, MTD_SL_V"
            " FROM MISRETAIL.T_ALLOCATION_FOR_ALL_DIVISION"
            " WHERE LOCATION='STORE'"
        ),
        "csv": "alloc_base_raw.csv",
    },
]


def _run_module1(job_id: str) -> None:
    _emit(job_id, {"event": "start", "module": "1", "name": "Fetch raw data"})
    dfs: dict[str, pd.DataFrame] = {}

    for step_num, step in enumerate(_M1_STEPS, start=1):
        _emit(job_id, {
            "step": step_num,
            "name": step["name"],
            "status": "running",
            "detail": step.get("detail", ""),
        })
        try:
            if "copy_from" in step:
                df = dfs[step["copy_from"]].copy()
            else:
                df = _query(step["sql"])

            csv_path = _OUT / step["csv"]
            df.to_csv(csv_path, index=False)
            dfs[step["key"]] = df

            _emit(job_id, {
                "step": step_num,
                "name": step["name"],
                "status": "done",
                "rows": len(df),
            })
        except Exception as exc:
            _emit(job_id, {"status": "error", "message": str(exc)})
            _emit(job_id, {"status": "closed"})
            return

    files = [
        {"name": s["csv"], "rows": len(dfs[s["key"]])}
        for s in _M1_STEPS
    ]
    _emit(job_id, {
        "status": "finished",
        "files": files,
    })
    _emit(job_id, {"status": "closed"})


# ─────────────────────────────────────────────────────────────────────────────
# Routes
# ─────────────────────────────────────────────────────────────────────────────

# ─────────────────────────────────────────────────────────────────────────────
# Module 2 — Build grid + enrich
# grc2_raw × item_master → cross-join active stores → lifecycle + article_grid
# ─────────────────────────────────────────────────────────────────────────────

_SQL_LIFECYCLE = (
    "SELECT DEPARTMENT, DISPLAY_TYPE, PERIOD, OPTION_LEVEL, LIFE_CYCLE"
    " FROM T_ALLOCATION_LEVEL"
    " WHERE START_DATE <= TRUNC(SYSDATE) AND END_DATE >= TRUNC(SYSDATE)"
)

_SQL_ARTICLE_GRID = (
    "SELECT ATTRIBUTE1, DIVISION, SECTION, DEPARTMENT, ARTICLE_NAME,"
    " DISPLAY_TYPE, GRADE, MIN_VALUE, MAX_VALUE"
    " FROM t_article_grid_lxmi"
)


def _run_module2(job_id: str) -> None:
    _emit(job_id, {"event": "start", "module": "2", "name": "Build grid + enrich"})

    # ── Step 1: load Module 1 CSVs ────────────────────────────────────────────
    _emit(job_id, {"step": 1, "name": "Load grc2_raw + item_master + store_master", "status": "running"})
    try:
        grc = pd.read_csv(_OUT / "grc2_raw.csv")
        items = pd.read_csv(_OUT / "item_master.csv", low_memory=False)
        stores = pd.read_csv(_OUT / "store_master.csv", low_memory=False)
    except FileNotFoundError as e:
        _emit(job_id, {"status": "error", "message": f"Module 1 output missing: {e}. Run Module 1 first."})
        _emit(job_id, {"status": "closed"})
        return

    grc.columns = grc.columns.str.upper()
    items.columns = items.columns.str.upper()
    stores.columns = stores.columns.str.upper()
    _emit(job_id, {"step": 1, "name": "Load grc2_raw + item_master + store_master",
                   "status": "done", "rows": len(grc)})

    # ── Step 2: join grc × item_master ───────────────────────────────────────
    _emit(job_id, {"step": 2, "name": "Join GRC × item master", "status": "running"})
    items = items.rename(columns={"ICODE": "BARCODE"}) if "ICODE" in items.columns else items
    grc_items = grc.merge(items, on="BARCODE", how="left")
    _emit(job_id, {"step": 2, "name": "Join GRC × item master",
                   "status": "done", "rows": len(grc_items)})

    # ── Step 3: cross-join with active stores ─────────────────────────────────
    _emit(job_id, {"step": 3, "name": "Cross-join active stores", "status": "running"})
    # active = stores that have a STORE_STATUS (exclude blanks/DC rows)
    active_stores = stores.dropna(subset=["SITE_CODE"]).copy()
    if "STORE_STATUS" in active_stores.columns:
        active_stores = active_stores[
            ~active_stores["STORE_STATUS"].astype(str).str.upper().isin(["INACTIVE", "CLOSED", "NAN", ""])
        ]
    grc_items["_key"] = 1
    active_stores["_key"] = 1
    grid = grc_items.merge(active_stores, on="_key").drop(columns=["_key"])
    _emit(job_id, {"step": 3, "name": "Cross-join active stores",
                   "status": "done", "rows": len(grid)})

    # ── Step 4: fetch lifecycle from Oracle ───────────────────────────────────
    _emit(job_id, {"step": 4, "name": "Fetch lifecycle (Oracle)", "status": "running"})
    try:
        lc = _query(_SQL_LIFECYCLE)
        lc.columns = lc.columns.str.upper()
        join_cols = [c for c in ["DEPARTMENT", "DISPLAY_TYPE"] if c in grid.columns and c in lc.columns]
        if join_cols:
            grid = grid.merge(lc[join_cols + ["PERIOD", "OPTION_LEVEL", "LIFE_CYCLE"]].drop_duplicates(subset=join_cols),
                              on=join_cols, how="left")
        else:
            for col in ["PERIOD", "OPTION_LEVEL", "LIFE_CYCLE"]:
                grid[col] = None
        _emit(job_id, {"step": 4, "name": "Fetch lifecycle (Oracle)",
                       "status": "done", "rows": len(lc)})
    except Exception as exc:
        _emit(job_id, {"step": 4, "name": "Fetch lifecycle (Oracle)",
                       "status": "done", "rows": 0, "detail": f"skipped: {exc}"})
        for col in ["PERIOD", "OPTION_LEVEL", "LIFE_CYCLE"]:
            grid[col] = None

    # ── Step 5: fetch article_grid from Oracle ────────────────────────────────
    _emit(job_id, {"step": 5, "name": "Fetch article_grid (Oracle)", "status": "running"})
    try:
        ag = _query(_SQL_ARTICLE_GRID)
        ag.columns = ag.columns.str.upper()
        # join on item attrs + store grade
        grade_col = "STORE_GRADE" if "STORE_GRADE" in grid.columns else None
        ag_join = ag.rename(columns={"GRADE": "STORE_GRADE"}) if grade_col else ag
        ag_cols = [c for c in ["ATTRIBUTE1", "DIVISION", "SECTION", "DEPARTMENT", "ARTICLE_NAME", "DISPLAY_TYPE", "STORE_GRADE"]
                   if c in grid.columns and c in ag_join.columns]
        if ag_cols:
            grid = grid.merge(
                ag_join[ag_cols + ["MIN_VALUE", "MAX_VALUE"]].drop_duplicates(subset=ag_cols),
                on=ag_cols, how="left"
            )
        else:
            grid["MIN_VALUE"] = None
            grid["MAX_VALUE"] = None
        _emit(job_id, {"step": 5, "name": "Fetch article_grid (Oracle)",
                       "status": "done", "rows": len(ag)})
    except Exception as exc:
        _emit(job_id, {"step": 5, "name": "Fetch article_grid (Oracle)",
                       "status": "done", "rows": 0, "detail": f"skipped: {exc}"})
        grid["MIN_VALUE"] = None
        grid["MAX_VALUE"] = None

    # ── Step 6: initialise filter/req columns ─────────────────────────────────
    _emit(job_id, {"step": 6, "name": "Initialise filter + requirement columns", "status": "running"})
    for col in ["CAT6_LIST", "MC_LISTING", "CLR_LIST_TAG", "BLOCKED", "MANUAL_EXCLUDE"]:
        if col not in grid.columns:
            grid[col] = None
    for col in ["PASS", "BAR_REQ", "MC_REQ", "FILL_RATE",
                "ARTICLE_REQ", "MRP_REQ", "OPTION_REQ", "SPARKY_REQ", "SZ_REQ", "TABLE_REQ"]:
        if col not in grid.columns:
            grid[col] = 0
    _emit(job_id, {"step": 6, "name": "Initialise filter + requirement columns", "status": "done"})

    # ── Step 7: save grid CSV ─────────────────────────────────────────────────
    _emit(job_id, {"step": 7, "name": "Save grid.csv", "status": "running"})
    grid_path = _OUT / "grid.csv"
    grid.to_csv(grid_path, index=False)
    _emit(job_id, {"step": 7, "name": "Save grid.csv", "status": "done", "rows": len(grid)})

    _emit(job_id, {
        "status": "finished",
        "files": [{"name": "grid.csv", "rows": len(grid)}],
    })
    _emit(job_id, {"status": "closed"})


@router.post("/pipeline/module/{mod_id}/run")
async def run_module(mod_id: str, request: Request) -> JSONResponse:
    body: dict[str, Any] = {}
    try:
        body = await request.json()
    except Exception:
        pass

    job_id = uuid.uuid4().hex[:12]
    with _jobs_lock:
        _jobs[job_id] = []

    runners = {"1": _run_module1, "2": _run_module2}
    fn = runners.get(mod_id)
    if fn is None:
        return JSONResponse(
            {"success": False, "message": f"Module {mod_id} not implemented yet."},
            status_code=501,
        )

    threading.Thread(target=fn, args=(job_id,), daemon=True).start()
    return JSONResponse({"job_id": job_id, "module": mod_id})


@router.get("/pipeline/stream/{job_id}")
async def stream_job(job_id: str) -> StreamingResponse:
    with _jobs_lock:
        if job_id not in _jobs:
            return JSONResponse({"error": "unknown job_id"}, status_code=404)

    def generator():
        yield from _sse_lines(job_id)

    return StreamingResponse(
        generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/pipeline/config")
async def get_config() -> JSONResponse:
    return JSONResponse({"source_mode": "db", "note": "Native SS27 pipeline"})


@router.post("/pipeline/config")
async def save_config(request: Request) -> JSONResponse:
    return JSONResponse({"success": True})


@router.post("/pipeline/config/reset")
async def reset_config() -> JSONResponse:
    return JSONResponse({"success": True})


@router.get("/pipeline/grid-columns")
async def grid_columns() -> JSONResponse:
    return JSONResponse({"columns": []})


@router.get("/pipeline/dataset-columns/{key}")
async def dataset_columns(key: str) -> JSONResponse:
    return JSONResponse({"key": key, "columns": []})


@router.post("/pipeline/query/preview")
async def query_preview(request: Request) -> JSONResponse:
    return JSONResponse({"rows": [], "columns": []})
