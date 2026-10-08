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
from app.db.oracle import _ensure_thick_mode  # reuse shared thick-mode initialiser

# ── init thick mode once — delegates to oracle.py to avoid DPY-2017 ──────────
try:
    _ensure_thick_mode()
except Exception:
    pass

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
_LOGS = Path(__file__).parent.parent.parent.parent / "data" / "output" / "logs"
_LOGS.mkdir(parents=True, exist_ok=True)

_log_lock = threading.Lock()


def _append_log(filename: str, record: dict) -> None:
    """Append a JSON record (one line) to a JSONL log file."""
    p = _LOGS / filename
    try:
        with _log_lock:
            with open(p, "a", encoding="utf-8") as f:
                f.write(json.dumps(record, ensure_ascii=False) + "\n")
    except Exception:
        pass


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
    # persist run completion to JSONL log
    status = event.get("status")
    if status in ("finished", "error"):
        # find the run record by job_id and update it
        _append_log("run_events.jsonl", {
            "ts": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "job_id": job_id,
            "status": status,
            "message": event.get("message", ""),
            "files": [f.get("name", "") for f in (event.get("files") or [])],
        })


def _sse_lines(job_id: str, last_id: int = 0) -> Generator[str, None, None]:
    """Yield SSE lines for a running job until it closes.
    last_id: resume from this event index (supports Last-Event-ID reconnect)."""
    sent = last_id
    deadline = time.time() + 600  # 10-min max
    while time.time() < deadline:
        with _jobs_lock:
            events = _jobs[job_id]
            new = events[sent:]
        for evt in new:
            yield f"id: {sent}\ndata: {json.dumps(evt)}\n\n"
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


# ─────────────────────────────────────────────────────────────────────────────
# Module 3 — Apply system filters
# Annotates each grid row with CAT6_LIST, MC_LISTING, CLR_LIST_TAG, BLOCKED.
# Nothing is dropped — rows are marked Y/N so later modules can decide.
# ─────────────────────────────────────────────────────────────────────────────

_SQL_CAT6        = "SELECT CAT6, STORE_NAME, CAT6_LIST FROM CK_A2166.v_cat6_list"
_SQL_MC_LISTING  = "SELECT STORE_NAME, DEPARTMENT, MC_LISTING FROM MISRETAIL.t_store_mc_listing"
_SQL_CLR_CONCEPT = "SELECT STORE, DEPARTMENT, DISPLAY_TYPE, ARTICLE_NAME, MRP, CONCEPT_NEW, COLOR FROM REPORT.T_CLR_CONCEPT_AW26_V1"
_SQL_BLOCK       = "SELECT ST_NM, DEPARTMENT, HOLD_ITEM, HOLD_FIELDS, HOLD_KEYS, HOLD_LIST FROM REPORT.t_store_item_block_list"
_SQL_BLOCK_LIST  = (
    "SELECT K.SHRTNAME AS STORE, I.ICODE FROM MISRETAIL.T_DLT_STR S"
    " JOIN MISRETAIL.T_DLT_ICODE I ON S.STR_DLT_ID = I.ICODE_DLT_ID"
    " JOIN ADMSITE K ON S.STR_CODE = K.CODE"
    " JOIN MISRETAIL.T_DLT_BAR B ON S.STR_DLT_ID = B.DLT_ID"
    " WHERE S.STR_DLT_ID >= 22 AND ROWNUM <= 200000"
)


def _safe_query(sql: str, timeout_s: int = 120) -> pd.DataFrame | None:
    """Run query with a wall-clock timeout; return None on error or timeout."""
    result: list[pd.DataFrame | None] = [None]
    exc_holder: list[Exception | None] = [None]

    def _worker():
        try:
            result[0] = _query(sql)
        except Exception as e:
            exc_holder[0] = e

    t = threading.Thread(target=_worker, daemon=True)
    t.start()
    t.join(timeout=timeout_s)
    if t.is_alive():
        return None  # timed out
    if exc_holder[0]:
        return None
    return result[0]


def _run_module3(job_id: str) -> None:
    _emit(job_id, {"event": "start", "module": "3", "name": "Apply system filters"})

    # ── Step 1: load grid ─────────────────────────────────────────────────────
    _emit(job_id, {"step": 1, "name": "Load grid.csv", "status": "running"})
    try:
        grid = pd.read_csv(_OUT / "grid.csv", low_memory=False)
    except FileNotFoundError:
        _emit(job_id, {"status": "error", "message": "grid.csv missing — run Module 2 first."})
        _emit(job_id, {"status": "closed"})
        return
    grid.columns = grid.columns.str.upper()
    _emit(job_id, {"step": 1, "name": "Load grid.csv", "status": "done", "rows": len(grid)})

    # ── Step 2: CAT6 listing filter ───────────────────────────────────────────
    _emit(job_id, {"step": 2, "name": "CAT6 listing filter (Oracle)", "status": "running"})
    cat6 = _safe_query(_SQL_CAT6)
    if cat6 is not None:
        cat6.columns = cat6.columns.str.upper()
        cat6 = cat6.rename(columns={"STORE_NAME": "_STORE_NAME_C6"})
        if "CAT6" in grid.columns and "STORE_NAME" in grid.columns:
            grid = grid.merge(
                cat6[["CAT6", "_STORE_NAME_C6", "CAT6_LIST"]].drop_duplicates(),
                left_on=["CAT6", "STORE_NAME"], right_on=["CAT6", "_STORE_NAME_C6"],
                how="left"
            ).drop(columns=["_STORE_NAME_C6"], errors="ignore")
        n = int(cat6["CAT6_LIST"].notna().sum()) if "CAT6_LIST" in cat6.columns else 0
        _emit(job_id, {"step": 2, "name": "CAT6 listing filter (Oracle)", "status": "done", "rows": len(cat6)})
    else:
        if "CAT6_LIST" not in grid.columns:
            grid["CAT6_LIST"] = None
        _emit(job_id, {"step": 2, "name": "CAT6 listing filter (Oracle)", "status": "done", "rows": 0, "detail": "skipped"})

    # ── Step 3: MC listing filter ─────────────────────────────────────────────
    _emit(job_id, {"step": 3, "name": "MC listing filter (Oracle)", "status": "running"})
    mc = _safe_query(_SQL_MC_LISTING)
    if mc is not None:
        mc.columns = mc.columns.str.upper()
        mc = mc.rename(columns={"STORE_NAME": "_ST_MC", "DEPARTMENT": "_DEPT_MC"})
        if "STORE_NAME" in grid.columns and "DEPARTMENT" in grid.columns:
            grid = grid.merge(
                mc[["_ST_MC", "_DEPT_MC", "MC_LISTING"]].drop_duplicates(),
                left_on=["STORE_NAME", "DEPARTMENT"], right_on=["_ST_MC", "_DEPT_MC"],
                how="left"
            ).drop(columns=["_ST_MC", "_DEPT_MC"], errors="ignore")
        _emit(job_id, {"step": 3, "name": "MC listing filter (Oracle)", "status": "done", "rows": len(mc)})
    else:
        if "MC_LISTING" not in grid.columns:
            grid["MC_LISTING"] = None
        _emit(job_id, {"step": 3, "name": "MC listing filter (Oracle)", "status": "done", "rows": 0, "detail": "skipped"})

    # ── Step 4: CLR concept filter ────────────────────────────────────────────
    _emit(job_id, {"step": 4, "name": "CLR concept filter (Oracle)", "status": "running"})
    clr = _safe_query(_SQL_CLR_CONCEPT, timeout_s=60)
    if clr is not None:
        clr.columns = clr.columns.str.upper()
        clr["CLR_LIST_TAG"] = "Y"
        join_cols = [c for c in ["STORE", "DEPARTMENT", "CONCEPT_NEW", "COLOR"]
                     if c in grid.columns and c in clr.columns]
        if join_cols:
            store_col = "STORE_NAME" if "STORE_NAME" in grid.columns else None
            if store_col and "STORE" in clr.columns:
                clr = clr.rename(columns={"STORE": "_CLR_STORE"})
                join_cols_g = [store_col if c == "STORE" else c for c in join_cols]
                join_cols_c = ["_CLR_STORE" if c == "STORE" else c for c in join_cols]
                grid = grid.merge(
                    clr[join_cols_c + ["CLR_LIST_TAG"]].drop_duplicates(subset=join_cols_c),
                    left_on=join_cols_g, right_on=join_cols_c, how="left"
                ).drop(columns=["_CLR_STORE"], errors="ignore")
        _emit(job_id, {"step": 4, "name": "CLR concept filter (Oracle)", "status": "done", "rows": len(clr)})
    else:
        if "CLR_LIST_TAG" not in grid.columns:
            grid["CLR_LIST_TAG"] = None
        _emit(job_id, {"step": 4, "name": "CLR concept filter (Oracle)", "status": "done", "rows": 0, "detail": "skipped"})

    # ── Step 5: Block list filter ─────────────────────────────────────────────
    _emit(job_id, {"step": 5, "name": "Block list filter (Oracle)", "status": "running"})
    blk = _safe_query(_SQL_BLOCK)
    if blk is not None:
        blk.columns = blk.columns.str.upper()
        blk["BLOCKED"] = "Y"
        if "ST_NM" in blk.columns and "STORE_NAME" in grid.columns and "DEPARTMENT" in grid.columns:
            grid = grid.merge(
                blk[["ST_NM", "DEPARTMENT", "BLOCKED"]].drop_duplicates(subset=["ST_NM", "DEPARTMENT"]),
                left_on=["STORE_NAME", "DEPARTMENT"], right_on=["ST_NM", "DEPARTMENT"],
                how="left"
            ).drop(columns=["ST_NM"], errors="ignore")
        _emit(job_id, {"step": 5, "name": "Block list filter (Oracle)", "status": "done", "rows": len(blk)})
    else:
        if "BLOCKED" not in grid.columns:
            grid["BLOCKED"] = None
        _emit(job_id, {"step": 5, "name": "Block list filter (Oracle)", "status": "done", "rows": 0, "detail": "skipped"})

    # ── Step 6: DLT block list ────────────────────────────────────────────────
    _emit(job_id, {"step": 6, "name": "DLT block list (Oracle)", "status": "running"})
    dlt = _safe_query(_SQL_BLOCK_LIST, timeout_s=60)
    if dlt is not None and not dlt.empty:
        dlt.columns = dlt.columns.str.upper()
        if "STORE" in dlt.columns and "ICODE" in dlt.columns:
            dlt["_DLT"] = "Y"
            b_col = "BARCODE" if "BARCODE" in grid.columns else None
            s_col = "STORE_NAME" if "STORE_NAME" in grid.columns else None
            if b_col and s_col and len(dlt) <= 100_000:
                dlt_dedup = dlt[["STORE", "ICODE", "_DLT"]].drop_duplicates()
                grid = grid.merge(dlt_dedup, left_on=[s_col, b_col],
                                  right_on=["STORE", "ICODE"], how="left")
                grid["BLOCKED"] = grid["BLOCKED"].fillna(grid["_DLT"])
                grid.drop(columns=["STORE", "ICODE", "_DLT"], errors="ignore", inplace=True)
        _emit(job_id, {"step": 6, "name": "DLT block list (Oracle)", "status": "done", "rows": len(dlt)})
    else:
        _emit(job_id, {"step": 6, "name": "DLT block list (Oracle)", "status": "done", "rows": 0, "detail": "skipped/empty"})

    # ── Step 7: annotate PASS column ──────────────────────────────────────────
    _emit(job_id, {"step": 7, "name": "Annotate PASS column", "status": "running"})
    # PASS = Y when none of the block flags are set
    def _flag(col: str) -> pd.Series:
        if col in grid.columns:
            return grid[col].astype(str).str.upper().isin(["Y", "YES", "1", "BLOCK", "BLOCKED"])
        return pd.Series(False, index=grid.index)

    blocked_mask = _flag("BLOCKED") | _flag("MANUAL_EXCLUDE")
    grid["PASS"] = (~blocked_mask).map({True: "Y", False: "N"})
    pass_y = int((grid["PASS"] == "Y").sum())
    _emit(job_id, {"step": 7, "name": "Annotate PASS column", "status": "done",
                   "detail": f"{pass_y:,} rows PASS=Y"})

    # ── Step 8: save filtered grid ────────────────────────────────────────────
    _emit(job_id, {"step": 8, "name": "Save grid_filtered.csv", "status": "running"})
    out_path = _OUT / "grid_filtered.csv"
    grid.to_csv(out_path, index=False)
    _emit(job_id, {"step": 8, "name": "Save grid_filtered.csv", "status": "done"})

    _emit(job_id, {
        "status": "finished",
        "files": [{"name": "grid_filtered.csv", "rows": len(grid)}],
    })
    _emit(job_id, {"status": "closed"})


# ─────────────────────────────────────────────────────────────────────────────
# Module 4 — Manual filters
# Applies user-defined exclusion rules (column / op / value) to grid_filtered.csv.
# Rows that match any rule get MANUAL_EXCLUDE = "Y"; PASS is re-evaluated.
# Saves grid_manual.csv.
# ─────────────────────────────────────────────────────────────────────────────

def _run_module4(job_id: str, filters: list[dict]) -> None:
    _emit(job_id, {"event": "start", "module": "4", "name": "Manual filters"})

    # ── Step 1: load grid_filtered.csv ────────────────────────────────────────
    _emit(job_id, {"step": 1, "name": "Load grid_filtered.csv", "status": "running"})
    try:
        grid = pd.read_csv(_OUT / "grid_filtered.csv", low_memory=False)
    except FileNotFoundError:
        _emit(job_id, {"status": "error", "message": "grid_filtered.csv missing — run Module 3 first."})
        _emit(job_id, {"status": "closed"})
        return
    grid.columns = grid.columns.str.upper()
    _emit(job_id, {"step": 1, "name": "Load grid_filtered.csv", "status": "done", "rows": len(grid)})

    # ── Step 2: apply each filter rule ───────────────────────────────────────
    _emit(job_id, {"step": 2, "name": f"Apply {len(filters)} manual filter rule(s)", "status": "running"})
    if "MANUAL_EXCLUDE" not in grid.columns:
        grid["MANUAL_EXCLUDE"] = None

    excluded = pd.Series(False, index=grid.index)
    applied = 0
    for rule in filters:
        col = str(rule.get("column", "")).upper()
        op  = str(rule.get("op", "="))
        val = str(rule.get("value", ""))
        if col not in grid.columns:
            continue
        col_s = grid[col].astype(str).str.strip().str.upper()
        if op == "=":
            mask = col_s == val.upper()
        elif op == "!=":
            mask = col_s != val.upper()
        elif op == "in":
            vals = {v.strip().upper() for v in val.split(",")}
            mask = col_s.isin(vals)
        else:
            continue
        excluded |= mask
        applied += 1

    grid.loc[excluded, "MANUAL_EXCLUDE"] = "Y"
    n_excluded = int(excluded.sum())
    _emit(job_id, {"step": 2, "name": f"Apply {applied} manual filter rule(s)",
                   "status": "done", "detail": f"{n_excluded:,} rows marked MANUAL_EXCLUDE=Y"})

    # ── Step 3: re-evaluate PASS ──────────────────────────────────────────────
    _emit(job_id, {"step": 3, "name": "Re-evaluate PASS column", "status": "running"})
    def _flag(col: str) -> pd.Series:
        if col in grid.columns:
            return grid[col].astype(str).str.upper().isin(["Y", "YES", "1", "BLOCK", "BLOCKED"])
        return pd.Series(False, index=grid.index)

    blocked_mask = _flag("BLOCKED") | _flag("MANUAL_EXCLUDE")
    grid["PASS"] = (~blocked_mask).map({True: "Y", False: "N"})
    pass_y = int((grid["PASS"] == "Y").sum())
    _emit(job_id, {"step": 3, "name": "Re-evaluate PASS column", "status": "done",
                   "detail": f"{pass_y:,} rows PASS=Y"})

    # ── Step 4: save grid_manual.csv ──────────────────────────────────────────
    _emit(job_id, {"step": 4, "name": "Save grid_manual.csv", "status": "running"})
    out_path = _OUT / "grid_manual.csv"
    grid.to_csv(out_path, index=False)
    _emit(job_id, {"step": 4, "name": "Save grid_manual.csv", "status": "done", "rows": len(grid)})

    _emit(job_id, {
        "status": "finished",
        "files": [{"name": "grid_manual.csv", "rows": len(grid)}],
    })
    _emit(job_id, {"status": "closed"})


# ─────────────────────────────────────────────────────────────────────────────
# Module 5 — Join requirements
# Fetches 6 Oracle requirement views and attaches BAR_REQ, MC_REQ,
# ARTICLE_REQ, MRP_REQ, OPTION_REQ, SPARKY_REQ to each row in grid_manual.csv.
# Saves grid_req.csv.
# ─────────────────────────────────────────────────────────────────────────────

_SQL_BAR_REQ     = "SELECT ICODE, STORE_NAME, REQ AS BAR_REQ FROM ck_a2166.v_barcode_req_apps_grc_v2"
_SQL_MC_REQ      = "SELECT STORE_NAME, DEPARTMENT, SECTION, REQ AS MC_REQ FROM ck_a2166.v_mc_req_apps_2"
_SQL_ART_REQ     = "SELECT STORE_NAME, DEPARTMENT, ARTICLE_NAME, REQ AS ARTICLE_REQ FROM ck_a2166.v_art_req_apps"
_SQL_MRP_REQ     = "SELECT STORE_NAME, DEPARTMENT, ARTICLE_NAME, MRP, REQ AS MRP_REQ FROM ck_a2166.v_mrp_req_apps"
_SQL_OPTION_REQ  = "SELECT STORE_NAME, DEPARTMENT, DISPLAY_TYPE, ALLOCATION_OPTION, OPTION_REQ FROM ck_a2166.v_option_req_apps"
_SQL_SPARKY_REQ  = "SELECT STORE_NAME, DEPARTMENT, ARTICLE_NAME, SPARKY_REQ FROM ck_a2166.v_sparky_pbs_req"


def _run_module5(job_id: str) -> None:
    _emit(job_id, {"event": "start", "module": "5", "name": "Join requirements"})

    # ── Step 1: load grid_manual.csv ─────────────────────────────────────────
    _emit(job_id, {"step": 1, "name": "Load grid_manual.csv", "status": "running"})
    try:
        grid = pd.read_csv(_OUT / "grid_manual.csv", low_memory=False)
    except FileNotFoundError:
        _emit(job_id, {"status": "error", "message": "grid_manual.csv missing — run Module 4 first."})
        _emit(job_id, {"status": "closed"})
        return
    grid.columns = grid.columns.str.upper()
    _emit(job_id, {"step": 1, "name": "Load grid_manual.csv", "status": "done", "rows": len(grid)})

    def _join_req(step: int, name: str, sql: str, left_on: list, right_on: list,
                  req_col: str, icode_join: bool = False) -> None:
        _emit(job_id, {"step": step, "name": name, "status": "running"})
        df = _safe_query(sql, timeout_s=60)
        if df is not None and not df.empty:
            df.columns = df.columns.str.upper()
            # deduplicate on join keys keeping max REQ
            df = df.drop_duplicates(subset=right_on, keep="last")
            valid_left  = [c for c in left_on  if c in grid.columns]
            valid_right = [c for c in right_on if c in df.columns]
            if len(valid_left) == len(left_on) and len(valid_right) == len(right_on):
                nonlocal grid
                grid = grid.merge(
                    df[right_on + [req_col]],
                    left_on=left_on, right_on=right_on, how="left",
                    suffixes=("", f"__{req_col}")
                )
                # if right_on columns differ from left_on, drop the extra columns
                for rc in right_on:
                    if rc not in left_on and rc in grid.columns:
                        grid.drop(columns=[rc], errors="ignore", inplace=True)
                if req_col not in grid.columns:
                    grid[req_col] = df[req_col] if req_col in df.columns else 0
            _emit(job_id, {"step": step, "name": name, "status": "done", "rows": len(df)})
        else:
            if req_col not in grid.columns:
                grid[req_col] = 0
            _emit(job_id, {"step": step, "name": name, "status": "done",
                           "rows": 0, "detail": "skipped/timeout"})

    # ── Step 2: BAR_REQ (barcode × store) ────────────────────────────────────
    _emit(job_id, {"step": 2, "name": "Fetch BAR_REQ (Oracle)", "status": "running"})
    bar = _safe_query(_SQL_BAR_REQ, timeout_s=60)
    if bar is not None and not bar.empty:
        bar.columns = bar.columns.str.upper()
        bar = bar.drop_duplicates(subset=["ICODE", "STORE_NAME"])
        if "BARCODE" in grid.columns and "STORE_NAME" in grid.columns:
            grid = grid.merge(bar[["ICODE", "STORE_NAME", "BAR_REQ"]],
                              left_on=["BARCODE", "STORE_NAME"],
                              right_on=["ICODE", "STORE_NAME"], how="left")
            grid.drop(columns=["ICODE"], errors="ignore", inplace=True)
        _emit(job_id, {"step": 2, "name": "Fetch BAR_REQ (Oracle)", "status": "done", "rows": len(bar)})
    else:
        if "BAR_REQ" not in grid.columns:
            grid["BAR_REQ"] = 0
        _emit(job_id, {"step": 2, "name": "Fetch BAR_REQ (Oracle)", "status": "done", "rows": 0, "detail": "skipped"})

    # ── Step 3: MC_REQ (store × dept × section) ───────────────────────────────
    _emit(job_id, {"step": 3, "name": "Fetch MC_REQ (Oracle)", "status": "running"})
    mc = _safe_query(_SQL_MC_REQ, timeout_s=60)
    if mc is not None and not mc.empty:
        mc.columns = mc.columns.str.upper()
        join_cols = [c for c in ["STORE_NAME", "DEPARTMENT", "SECTION"] if c in mc.columns and c in grid.columns]
        mc = mc.drop_duplicates(subset=join_cols)
        if join_cols:
            grid = grid.merge(mc[join_cols + ["MC_REQ"]], on=join_cols, how="left")
        _emit(job_id, {"step": 3, "name": "Fetch MC_REQ (Oracle)", "status": "done", "rows": len(mc)})
    else:
        if "MC_REQ" not in grid.columns:
            grid["MC_REQ"] = 0
        _emit(job_id, {"step": 3, "name": "Fetch MC_REQ (Oracle)", "status": "done", "rows": 0, "detail": "skipped"})

    # ── Step 4: ARTICLE_REQ (store × dept × article) ──────────────────────────
    _emit(job_id, {"step": 4, "name": "Fetch ARTICLE_REQ (Oracle)", "status": "running"})
    art = _safe_query(_SQL_ART_REQ, timeout_s=60)
    if art is not None and not art.empty:
        art.columns = art.columns.str.upper()
        join_cols = [c for c in ["STORE_NAME", "DEPARTMENT", "ARTICLE_NAME"] if c in art.columns and c in grid.columns]
        art = art.drop_duplicates(subset=join_cols)
        if join_cols:
            grid = grid.merge(art[join_cols + ["ARTICLE_REQ"]], on=join_cols, how="left")
        _emit(job_id, {"step": 4, "name": "Fetch ARTICLE_REQ (Oracle)", "status": "done", "rows": len(art)})
    else:
        if "ARTICLE_REQ" not in grid.columns:
            grid["ARTICLE_REQ"] = 0
        _emit(job_id, {"step": 4, "name": "Fetch ARTICLE_REQ (Oracle)", "status": "done", "rows": 0, "detail": "skipped"})

    # ── Step 5: MRP_REQ (store × dept × article × mrp) ───────────────────────
    _emit(job_id, {"step": 5, "name": "Fetch MRP_REQ (Oracle)", "status": "running"})
    mrp = _safe_query(_SQL_MRP_REQ, timeout_s=60)
    if mrp is not None and not mrp.empty:
        mrp.columns = mrp.columns.str.upper()
        join_cols = [c for c in ["STORE_NAME", "DEPARTMENT", "ARTICLE_NAME", "MRP"] if c in mrp.columns and c in grid.columns]
        mrp = mrp.drop_duplicates(subset=join_cols)
        if join_cols:
            grid = grid.merge(mrp[join_cols + ["MRP_REQ"]], on=join_cols, how="left")
        _emit(job_id, {"step": 5, "name": "Fetch MRP_REQ (Oracle)", "status": "done", "rows": len(mrp)})
    else:
        if "MRP_REQ" not in grid.columns:
            grid["MRP_REQ"] = 0
        _emit(job_id, {"step": 5, "name": "Fetch MRP_REQ (Oracle)", "status": "done", "rows": 0, "detail": "skipped"})

    # ── Step 6: OPTION_REQ (store × dept × display_type × allocation_option) ──
    _emit(job_id, {"step": 6, "name": "Fetch OPTION_REQ (Oracle)", "status": "running"})
    opt = _safe_query(_SQL_OPTION_REQ, timeout_s=60)
    if opt is not None and not opt.empty:
        opt.columns = opt.columns.str.upper()
        join_cols = [c for c in ["STORE_NAME", "DEPARTMENT", "DISPLAY_TYPE", "ALLOCATION_OPTION"]
                     if c in opt.columns and c in grid.columns]
        opt = opt.drop_duplicates(subset=join_cols)
        if join_cols:
            grid = grid.merge(opt[join_cols + ["OPTION_REQ"]], on=join_cols, how="left")
        _emit(job_id, {"step": 6, "name": "Fetch OPTION_REQ (Oracle)", "status": "done", "rows": len(opt)})
    else:
        if "OPTION_REQ" not in grid.columns:
            grid["OPTION_REQ"] = 0
        _emit(job_id, {"step": 6, "name": "Fetch OPTION_REQ (Oracle)", "status": "done", "rows": 0, "detail": "skipped"})

    # ── Step 7: SPARKY_REQ (store × dept × article) ───────────────────────────
    _emit(job_id, {"step": 7, "name": "Fetch SPARKY_REQ (Oracle)", "status": "running"})
    sparky = _safe_query(_SQL_SPARKY_REQ, timeout_s=60)
    if sparky is not None and not sparky.empty:
        sparky.columns = sparky.columns.str.upper()
        join_cols = [c for c in ["STORE_NAME", "DEPARTMENT", "ARTICLE_NAME"] if c in sparky.columns and c in grid.columns]
        sparky = sparky.drop_duplicates(subset=join_cols)
        if join_cols:
            grid = grid.merge(sparky[join_cols + ["SPARKY_REQ"]], on=join_cols, how="left")
        _emit(job_id, {"step": 7, "name": "Fetch SPARKY_REQ (Oracle)", "status": "done", "rows": len(sparky)})
    else:
        if "SPARKY_REQ" not in grid.columns:
            grid["SPARKY_REQ"] = 0
        _emit(job_id, {"step": 7, "name": "Fetch SPARKY_REQ (Oracle)", "status": "done", "rows": 0, "detail": "skipped"})

    # ── Step 8: fill NaN reqs with 0 ─────────────────────────────────────────
    _emit(job_id, {"step": 8, "name": "Fill NaN requirements → 0", "status": "running"})
    for col in ["BAR_REQ", "MC_REQ", "ARTICLE_REQ", "MRP_REQ", "OPTION_REQ", "SPARKY_REQ", "SZ_REQ"]:
        if col in grid.columns:
            grid[col] = pd.to_numeric(grid[col], errors="coerce").fillna(0)
        else:
            grid[col] = 0
    _emit(job_id, {"step": 8, "name": "Fill NaN requirements → 0", "status": "done"})

    # ── Step 9: save grid_req.csv ─────────────────────────────────────────────
    _emit(job_id, {"step": 9, "name": "Save grid_req.csv", "status": "running"})
    out_path = _OUT / "grid_req.csv"
    grid.to_csv(out_path, index=False)
    _emit(job_id, {"step": 9, "name": "Save grid_req.csv", "status": "done", "rows": len(grid)})

    _emit(job_id, {
        "status": "finished",
        "files": [{"name": "grid_req.csv", "rows": len(grid)}],
    })
    _emit(job_id, {"status": "closed"})



# ─────────────────────────────────────────────────────────────────────────────
# Module 6 — Eligible qty + export
# ELIGIBLE_QTY = min(BAR_REQ, MC_REQ, priority_req where >0)
# Writes final_eligible.csv.
# ─────────────────────────────────────────────────────────────────────────────

def _run_module6(job_id: str) -> None:
    _emit(job_id, {"event": "start", "module": "6", "name": "Eligible qty + export"})

    # ── Step 1: load grid_req.csv ─────────────────────────────────────────────
    _emit(job_id, {"step": 1, "name": "Load grid_req.csv", "status": "running"})
    try:
        grid = pd.read_csv(_OUT / "grid_req.csv", low_memory=False)
    except FileNotFoundError:
        _emit(job_id, {"status": "error", "message": "grid_req.csv missing — run Module 5 first."})
        _emit(job_id, {"status": "closed"})
        return
    grid.columns = grid.columns.str.upper()
    _emit(job_id, {"step": 1, "name": "Load grid_req.csv", "status": "done", "rows": len(grid)})

    # ── Step 2: compute ELIGIBLE_QTY ─────────────────────────────────────────
    _emit(job_id, {"step": 2, "name": "Compute ELIGIBLE_QTY", "status": "running"})
    req_cols = ["BAR_REQ", "MC_REQ", "ARTICLE_REQ", "MRP_REQ", "OPTION_REQ", "SPARKY_REQ"]
    for col in req_cols:
        if col in grid.columns:
            grid[col] = pd.to_numeric(grid[col], errors="coerce").fillna(0)
        else:
            grid[col] = 0

    # ELIGIBLE_QTY = min of all non-zero requirements; if all are 0, result is 0
    req_matrix = grid[req_cols].copy()
    req_matrix[req_matrix == 0] = float("inf")  # treat 0 as "no constraint"
    grid["ELIGIBLE_QTY"] = req_matrix.min(axis=1).replace(float("inf"), 0).astype(int)

    pass_y = int((grid.get("PASS", "Y") == "Y").sum()) if "PASS" in grid.columns else len(grid)
    _emit(job_id, {"step": 2, "name": "Compute ELIGIBLE_QTY", "status": "done",
                   "detail": f"max eligible_qty: {int(grid['ELIGIBLE_QTY'].max())}"})

    # ── Step 3: filter PASS=Y rows ────────────────────────────────────────────
    _emit(job_id, {"step": 3, "name": "Filter PASS=Y rows", "status": "running"})
    if "PASS" in grid.columns:
        eligible = grid[grid["PASS"].astype(str).str.upper() == "Y"].copy()
    else:
        eligible = grid.copy()
    _emit(job_id, {"step": 3, "name": "Filter PASS=Y rows", "status": "done", "rows": len(eligible)})

    # ── Step 4: save final_eligible.csv ───────────────────────────────────────
    _emit(job_id, {"step": 4, "name": "Save final_eligible.csv", "status": "running"})
    out_path = _OUT / "final_eligible.csv"
    eligible.to_csv(out_path, index=False)
    _emit(job_id, {"step": 4, "name": "Save final_eligible.csv", "status": "done", "rows": len(eligible)})

    _emit(job_id, {
        "status": "finished",
        "files": [{"name": "final_eligible.csv", "rows": len(eligible)}],
    })
    _emit(job_id, {"status": "closed"})


# ─────────────────────────────────────────────────────────────────────────────
# Module 7 — Sort + export
# Sort by DEPARTMENT → STORE_NAME → ARTICLE_NAME → BARCODE
# Writes final_sorted.csv (and optionally an Excel file).
# ─────────────────────────────────────────────────────────────────────────────

def _run_module7(job_id: str) -> None:
    _emit(job_id, {"event": "start", "module": "7", "name": "Sort + export"})

    # ── Step 1: load final_eligible.csv ──────────────────────────────────────
    _emit(job_id, {"step": 1, "name": "Load final_eligible.csv", "status": "running"})
    try:
        df = pd.read_csv(_OUT / "final_eligible.csv", low_memory=False)
    except FileNotFoundError:
        _emit(job_id, {"status": "error", "message": "final_eligible.csv missing — run Module 6 first."})
        _emit(job_id, {"status": "closed"})
        return
    df.columns = df.columns.str.upper()
    _emit(job_id, {"step": 1, "name": "Load final_eligible.csv", "status": "done", "rows": len(df)})

    # ── Step 2: sort ──────────────────────────────────────────────────────────
    _emit(job_id, {"step": 2, "name": "Sort DEPT → STORE → ARTICLE → BARCODE", "status": "running"})
    sort_cols = [c for c in ["DEPARTMENT", "STORE_NAME", "ARTICLE_NAME", "BARCODE"] if c in df.columns]
    if sort_cols:
        df = df.sort_values(by=sort_cols).reset_index(drop=True)
    _emit(job_id, {"step": 2, "name": "Sort DEPT → STORE → ARTICLE → BARCODE",
                   "status": "done", "rows": len(df)})

    # ── Step 3: save final_sorted.csv ─────────────────────────────────────────
    _emit(job_id, {"step": 3, "name": "Save final_sorted.csv", "status": "running"})
    csv_path = _OUT / "final_sorted.csv"
    df.to_csv(csv_path, index=False)
    _emit(job_id, {"step": 3, "name": "Save final_sorted.csv", "status": "done", "rows": len(df)})

    # ── Step 4: write Excel ───────────────────────────────────────────────────
    _emit(job_id, {"step": 4, "name": "Write Excel (final_allocation.xlsx)", "status": "running"})
    xlsx_path = _OUT / "final_allocation.xlsx"
    try:
        import openpyxl  # noqa: F401  — check it's available
        # Export key columns only to keep xlsx manageable
        export_cols = [c for c in [
            "DEPARTMENT", "DIVISION", "SECTION", "DISPLAY_TYPE", "ARTICLE_NAME",
            "BARCODE", "MRP", "STORE_NAME", "STORE_GRADE", "STATE",
            "ELIGIBLE_QTY", "BAR_REQ", "MC_REQ", "ARTICLE_REQ", "MRP_REQ",
            "OPTION_REQ", "SPARKY_REQ", "PASS", "CAT6_LIST", "MC_LISTING",
            "BLOCKED", "MANUAL_EXCLUDE",
        ] if c in df.columns]
        df[export_cols].to_excel(str(xlsx_path), index=False, engine="openpyxl")
        _emit(job_id, {"step": 4, "name": "Write Excel (final_allocation.xlsx)",
                       "status": "done", "rows": len(df)})
    except Exception as exc:
        _emit(job_id, {"step": 4, "name": "Write Excel (final_allocation.xlsx)",
                       "status": "done", "rows": 0, "detail": f"skipped: {exc}"})

    _emit(job_id, {
        "status": "finished",
        "files": [
            {"name": "final_sorted.csv", "rows": len(df)},
            {"name": "final_allocation.xlsx", "rows": len(df)},
        ],
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

    _append_log("runs.jsonl", {
        "ts": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "job_id": job_id,
        "module": mod_id,
        "source": body.get("source", ""),
    })

    if mod_id == "4":
        filters = body.get("filters", [])
        threading.Thread(target=_run_module4, args=(job_id, filters), daemon=True).start()
        return JSONResponse({"job_id": job_id, "module": mod_id})

    runners = {
        "1": _run_module1, "2": _run_module2, "3": _run_module3,
        "5": _run_module5, "6": _run_module6, "7": _run_module7,
    }
    fn = runners.get(mod_id)
    if fn is None:
        return JSONResponse(
            {"success": False, "message": f"Module {mod_id} not implemented yet."},
            status_code=501,
        )

    threading.Thread(target=fn, args=(job_id,), daemon=True).start()
    return JSONResponse({"job_id": job_id, "module": mod_id})


@router.get("/pipeline/stream/{job_id}")
async def stream_job(job_id: str, request: Request) -> StreamingResponse:
    with _jobs_lock:
        if job_id not in _jobs:
            return JSONResponse({"error": "unknown job_id"}, status_code=404)

    last_event_id = request.headers.get("Last-Event-ID", "")
    try:
        last_id = int(last_event_id)
    except (ValueError, TypeError):
        last_id = 0

    def generator():
        yield from _sse_lines(job_id, last_id=last_id)

    return StreamingResponse(
        generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


_PARAMS_FILE = Path(__file__).parent.parent.parent.parent / "data" / "output" / "pipeline_params.json"


@router.get("/pipeline/params")
async def get_params() -> JSONResponse:
    if _PARAMS_FILE.exists():
        try:
            data = json.loads(_PARAMS_FILE.read_text(encoding="utf-8"))
            return JSONResponse({"ok": True, "data": data})
        except Exception:
            pass
    return JSONResponse({"ok": True, "data": {}})


@router.post("/pipeline/params")
async def save_params(request: Request) -> JSONResponse:
    try:
        new_vals = await request.json()
        _PARAMS_FILE.parent.mkdir(parents=True, exist_ok=True)

        # Load old values to compute diff
        old_vals: dict = {}
        if _PARAMS_FILE.exists():
            try:
                old_vals = json.loads(_PARAMS_FILE.read_text(encoding="utf-8"))
            except Exception:
                pass

        # Compute changed keys
        all_keys = set(old_vals) | set(new_vals)
        changes = []
        for k in sorted(all_keys):
            o = str(old_vals.get(k, ""))
            n = str(new_vals.get(k, ""))
            if o != n:
                changes.append({"key": k, "old": o, "new": n})

        # Persist new params
        _PARAMS_FILE.write_text(json.dumps(new_vals, ensure_ascii=False, indent=2), encoding="utf-8")

        # Log to param_changes.jsonl
        if changes:
            _logs_dir = Path(__file__).parent.parent.parent.parent / "data" / "output" / "logs"
            _logs_dir.mkdir(parents=True, exist_ok=True)
            with open(_logs_dir / "param_changes.jsonl", "a", encoding="utf-8") as f:
                f.write(json.dumps({
                    "when": time.strftime("%Y-%m-%dT%H:%M:%S"),
                    "run": 0,
                    "changes": changes,
                }, ensure_ascii=False) + "\n")

        return JSONResponse({"ok": True, "changed": len(changes)})
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)})


@router.get("/pipeline/config")
async def get_config() -> JSONResponse:
    return JSONResponse({"source_mode": "db", "note": "Native SS27 pipeline"})


@router.post("/pipeline/config")
async def save_config(request: Request) -> JSONResponse:
    try:
        body = await request.json()
        changes = body.get("changes", [])
        run_no = body.get("run", 1)
        if changes:
            _append_log("param_changes.jsonl", {
                "when": time.strftime("%Y-%m-%dT%H:%M:%S"),
                "run": run_no,
                "changes": changes,
            })
    except Exception:
        pass
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
