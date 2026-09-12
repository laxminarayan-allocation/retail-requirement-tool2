"""
Option Listing — AW26 Pre-Winter Allocation
Routes: /api/option-listing/...

Provides:
  GET  /api/option-listing/queries              — list all 10 Oracle queries
  GET  /api/option-listing/queries/{name}       — fetch one query
  PUT  /api/option-listing/queries/{name}       — save edited SQL / params
  POST /api/option-listing/queries/{name}/test  — run query, return first 50 rows
  GET  /api/option-listing/pipeline/steps       — list pipeline step metadata
  POST /api/option-listing/pipeline/run         — trigger pipeline steps (background)
  GET  /api/option-listing/pipeline/status      — latest run status
"""

import json
import subprocess
import sys
import threading
from datetime import datetime
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.db.oracle import get_pool

router = APIRouter(prefix="/option-listing", tags=["Option Listing"])

# ── Paths ──────────────────────────────────────────────────────────────────────
HERE         = Path(__file__).resolve().parent
QUERIES_FILE = HERE / "option_listing_queries.json"
CODES_DIR    = Path(r"D:\Prewinter Color Option Listing New Repeat\Codes")

PIPELINE_SCRIPTS = {
    "mc": None,  # Oracle MC Search — handled inline, no script file
    "00": "00_DOWNLOAD_ALL.py",
    "02": "02_PROCESS_GRC.py",
    "03": "03_PROCESS_REQ.py",
    "07": "07_SELLTHROUGH_ANALYSIS.py",
    "08": "08_LISTING_ELIGIBILITY.py",
    "04": "04_COLOUR_DISTRIBUTION.py",
    "05": "05_SUMMARY_EXCEL.py",
    "06": "06_AUDIT.py",
}
PIPELINE_ORDER = ["mc", "00", "02", "03", "07", "08", "04", "05", "06"]
STEP_LABELS = {
    "mc": "Load from Oracle — New MC Search (REPORT.T_GRID × V_ITEM_MASTER)",
    "00": "Download GRC / REQ / SALE / ART_GRID / MC_REQ / COLOR_FAMILY from Oracle",
    "02": "Process GRC + PPO → dispatch/hold split",
    "03": "Process REQ + sale-floor adjustment",
    "07": "LY Sell-Through analysis (Oracle)",
    "08": "Listing eligibility (LIST Y/N/CONDITIONAL)",
    "04": "Colour distribution engine (core allocation)",
    "05": "Management summary workbook",
    "06": "Self-audit against all allocation rules",
}

# ── In-memory run state ────────────────────────────────────────────────────────
_run_log: list[dict] = []
_run_lock = threading.Lock()


# ── Helpers ────────────────────────────────────────────────────────────────────

def _load_queries() -> dict:
    with open(QUERIES_FILE, encoding="utf-8") as f:
        return json.load(f)


def _save_queries(data: dict) -> None:
    with open(QUERIES_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def _ser(v: Any) -> Any:
    if v is None:
        return None
    if isinstance(v, (int, float, str, bool)):
        return v
    return str(v)


# ══════════════════════════════════════════════════════════════════════════════
# QUERY ENDPOINTS
# ══════════════════════════════════════════════════════════════════════════════

@router.get("/queries")
def list_queries():
    data = _load_queries()
    return [
        {
            "name": k,
            "description": v.get("description", ""),
            "table": v.get("table", ""),
            "has_params": bool(v.get("dynamic_params")),
        }
        for k, v in data.items()
    ]


@router.get("/queries/{name}")
def get_query(name: str):
    data = _load_queries()
    if name not in data:
        raise HTTPException(404, f"Query '{name}' not found")
    return {"name": name, **data[name]}


class QueryUpdate(BaseModel):
    sql: str
    dynamic_params: dict[str, str] = {}
    description: str = ""


@router.put("/queries/{name}")
def update_query(name: str, body: QueryUpdate):
    data = _load_queries()
    if name not in data:
        raise HTTPException(404, f"Query '{name}' not found")
    data[name]["sql"] = body.sql
    data[name]["dynamic_params"] = body.dynamic_params
    if body.description:
        data[name]["description"] = body.description
    _save_queries(data)
    return {"ok": True, "name": name}


@router.post("/queries/{name}/test")
def test_query(name: str):
    """Run query against Oracle, return first 50 rows."""
    data = _load_queries()
    if name not in data:
        raise HTTPException(404, f"Query '{name}' not found")

    entry  = data[name]
    sql    = entry["sql"]
    params = entry.get("dynamic_params", {})

    for k, v in params.items():
        sql = sql.replace("{" + k + "}", v)

    test_sql = f"SELECT * FROM ({sql}) WHERE ROWNUM <= 50"

    try:
        pool = get_pool()
        with pool.acquire() as conn:
            with conn.cursor() as cur:
                cur.arraysize = 100
                cur.execute(test_sql)
                cols = [c[0] for c in cur.description]
                rows = cur.fetchall()

        records = [{c: _ser(v) for c, v in zip(cols, row)} for row in rows]
        return {"columns": cols, "rows": records, "count": len(records)}

    except Exception as e:
        raise HTTPException(400, f"Oracle error: {e}")


# ══════════════════════════════════════════════════════════════════════════════
# NEW DEPT CANDIDATE SEARCH
# ══════════════════════════════════════════════════════════════════════════════

_ITEMS_SQL = """
SELECT
    g.DEPARTMENT,
    g.DISPLAY_TYPE,
    g.ARTICLE_NAME,
    MIN(v.MRP) AS MRP
FROM REPORT.T_GRID g
LEFT JOIN REPORT.V_ITEM_MASTER v
    ON  g.DEPARTMENT   = v.DEPARTMENT
    AND g.DISPLAY_TYPE = v.DISPLAY_TYPE
    AND g.ARTICLE_NAME = v.ARTICLE_NAME
    AND v.ATTRIBUTE1   IN ('LT WINTER', 'PREWINTER')
WHERE g.ATTRIBUTE1 IN ('LT WINTER', 'PREWINTER')
GROUP BY g.DEPARTMENT, g.DISPLAY_TYPE, g.ARTICLE_NAME
ORDER BY g.DEPARTMENT, g.ARTICLE_NAME
"""

@router.get("/new-dept-search")
def new_dept_search():
    """
    Return unique DEPARTMENT/DISPLAY_TYPE/ARTICLE_NAME/MRP from REPORT.T_GRID
    joined to V_ITEM_MASTER for MRP lookup.
    """
    try:
        pool = get_pool()
        with pool.acquire() as conn:
            with conn.cursor() as cur:
                cur.arraysize = 1000
                cur.execute(_ITEMS_SQL)
                rows = cur.fetchall()
        return [
            {"DEPARTMENT": r[0], "DISPLAY_TYPE": r[1], "ARTICLE_NAME": r[2],
             "MRP": int(r[3]) if r[3] is not None else None}
            for r in rows
        ]
    except Exception as e:
        raise HTTPException(400, f"Oracle error: {e}")


# ══════════════════════════════════════════════════════════════════════════════
# PIPELINE ENDPOINTS
# ══════════════════════════════════════════════════════════════════════════════

@router.get("/pipeline/steps")
def pipeline_steps():
    return [
        {"step": s, "script": PIPELINE_SCRIPTS[s], "label": STEP_LABELS[s]}
        for s in PIPELINE_ORDER
    ]


class DeptRowItem(BaseModel):
    department: str = ""
    display_type: str = ""
    article_name: str = ""
    mrp_sale: str = ""


class PipelineRun(BaseModel):
    steps: list[str]
    dispatch_ratio: float = 0.60
    dl_args: list[str] = []
    # New Department Launch params
    new_department: bool = False
    dept_rows: list[DeptRowItem] = []
    # legacy single-row fallback fields
    department: str = ""
    display_type: str = ""
    article_name: str = ""
    mrp_sale: float = 0.0


@router.post("/pipeline/run")
def run_pipeline(body: PipelineRun):
    # Step 07 is NOT skipped — it runs for all articles.
    # new_department flag + dept_rows are passed to step 07 so it can
    # set LY sell-through = 0 for those specific articles.
    steps = [s for s in PIPELINE_ORDER if s in body.steps]
    if not steps:
        raise HTTPException(400, "No valid steps specified")

    # Build filter args for scripts that support them (00, 03, 04, 06, 08)
    filter_args: list[str] = []
    if body.new_department:
        filter_args += ["--new-department"]
        # Pass dept_rows as JSON string so scripts can parse per-article overrides
        active_rows = [r for r in body.dept_rows if r.department.strip()]
        if active_rows:
            rows_json = json.dumps([
                {"department": r.department, "display_type": r.display_type,
                 "article_name": r.article_name, "mrp_sale": r.mrp_sale}
                for r in active_rows
            ])
            filter_args += ["--dept-rows", rows_json]
        # Legacy single-row fallback
        elif body.department:
            filter_args += ["--department", body.department]
            if body.display_type:
                filter_args += ["--display-type", body.display_type]
            if body.article_name:
                filter_args += ["--article-name", body.article_name]
            if body.mrp_sale > 0:
                filter_args += ["--mrp-sale", str(body.mrp_sale)]

    run_id = datetime.now().strftime("%Y%m%d_%H%M%S")

    def _run():
        with _run_lock:
            _run_log.clear()
            _run_log.append({
                "run_id": run_id,
                "started": datetime.now().isoformat(),
                "steps": steps,
                "status": "running",
                "new_department": body.new_department,
                "entries": [],
            })

        for step in steps:
            script = PIPELINE_SCRIPTS[step]

            # ── Step MC: Load from Oracle (New MC Search) — inline, no subprocess ──
            if step == "mc":
                try:
                    pool = get_pool()
                    with pool.acquire() as conn:
                        with conn.cursor() as cur:
                            cur.arraysize = 1000
                            cur.execute(_ITEMS_SQL)
                            rows = cur.fetchall()
                    count = len(rows)
                    entry = {"step": step, "script": "Oracle: REPORT.T_GRID × V_ITEM_MASTER",
                             "ok": True, "log": f"Load from Oracle OK — {count} MC articles fetched",
                             "ts": datetime.now().isoformat()}
                except Exception as exc:
                    entry = {"step": step, "script": "Oracle: REPORT.T_GRID × V_ITEM_MASTER",
                             "ok": False, "log": str(exc), "ts": datetime.now().isoformat()}
                with _run_lock:
                    _run_log[0]["entries"].append(entry)
                    if not entry["ok"]:
                        _run_log[0]["status"] = "failed"
                        break
                continue

            cmd = [sys.executable, str(CODES_DIR / script)]
            if step == "00":
                cmd += body.dl_args + filter_args
            elif step in ("04", "06"):
                cmd += ["--dispatch-ratio", str(body.dispatch_ratio)] + filter_args
            elif step in ("03", "07", "08"):
                # step 07 receives --new-department + --dept-rows so it can
                # zero out LY sell-through for those articles only
                cmd += filter_args

            try:
                result = subprocess.run(
                    cmd, cwd=str(CODES_DIR),
                    capture_output=True, text=True,
                    encoding="utf-8", errors="replace", timeout=1800,
                )
                ok  = result.returncode == 0
                log = (result.stdout or "") + ("\n" + result.stderr if result.stderr else "")
                entry = {"step": step, "script": script,
                         "ok": ok, "log": log, "ts": datetime.now().isoformat()}
            except Exception as exc:
                entry = {"step": step, "script": script,
                         "ok": False, "log": str(exc), "ts": datetime.now().isoformat()}

            with _run_lock:
                _run_log[0]["entries"].append(entry)
                if not entry["ok"]:
                    _run_log[0]["status"] = "failed"
                    break

        with _run_lock:
            if _run_log and _run_log[0]["status"] == "running":
                _run_log[0]["status"] = "done"
            if _run_log:
                _run_log[0]["finished"] = datetime.now().isoformat()

    threading.Thread(target=_run, daemon=True).start()
    return {"run_id": run_id, "steps": steps}


@router.get("/pipeline/status")
def pipeline_status():
    with _run_lock:
        if not _run_log:
            return {"status": "idle"}
        return _run_log[0]


# ══════════════════════════════════════════════════════════════════════════════
# SCHEDULER ENDPOINTS
# ══════════════════════════════════════════════════════════════════════════════

class SchedulerConfig(BaseModel):
    enabled: bool | None = None
    hour: int | None = None
    minute: int | None = None
    days: str | None = None   # "daily" | "1-6" | "1-5"


@router.get("/scheduler/status")
def scheduler_status():
    from app.core.pipeline_scheduler import get_status
    return get_status()


@router.put("/scheduler/config")
def scheduler_config(body: SchedulerConfig):
    from app.core.pipeline_scheduler import update_config
    return update_config(enabled=body.enabled, hour=body.hour, minute=body.minute, days=body.days)


@router.post("/scheduler/run-now")
def scheduler_run_now():
    from app.core.pipeline_scheduler import trigger_now
    trigger_now()
    return {"triggered": True}


OUTPUT_DIR = CODES_DIR / "OUTPUT"

@router.get("/output/files")
def list_output_files():
    """List all CSV and XLSX files in the OUTPUT folder, newest first."""
    if not OUTPUT_DIR.exists():
        return []
    files = []
    for f in OUTPUT_DIR.iterdir():
        if f.suffix.lower() in (".csv", ".xlsx") and f.is_file():
            files.append({
                "name": f.name,
                "size_kb": round(f.stat().st_size / 1024, 1),
                "modified": datetime.fromtimestamp(f.stat().st_mtime).isoformat(),
            })
    files.sort(key=lambda x: x["modified"], reverse=True)
    return files


from fastapi.responses import FileResponse as _FileResponse

@router.get("/output/download/{filename}")
def download_output_file(filename: str):
    """Download a single file from the OUTPUT folder."""
    safe = Path(filename).name  # strip any path traversal
    fpath = OUTPUT_DIR / safe
    if not fpath.exists() or not fpath.is_file():
        raise HTTPException(404, "File not found")
    media = "text/csv" if safe.endswith(".csv") else "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    return _FileResponse(str(fpath), media_type=media, filename=safe)
