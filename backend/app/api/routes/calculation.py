"""
Calculation routes — Phase 7.

POST /api/calculation/run                     → launch a background calculation run
GET  /api/calculation/runs                    → list recent runs
GET  /api/calculation/runs/{run_id}           → poll status
GET  /api/calculation/runs/{run_id}/results   → full result rows (paginated)
GET  /api/calculation/runs/{run_id}/export    → Excel download
GET  /api/calculation/runs/{run_id}/exceptions → validation exceptions
"""
import io
import json
import logging
import threading
import uuid
from datetime import datetime, timezone
from typing import Optional

import openpyxl
from fastapi import APIRouter, Query
from fastapi.responses import StreamingResponse

from app.engine import exception_store, run_store
from app.engine.calculator import run_calculation
from app.models.calculation_models import RunRecord, RunRequest, RunStatus
from app.models.response_models import APIResponse
from app.repositories.factor_repository import FactorRepository
from app.repositories.history_repository import (
    delete_history_run, get_history_run, list_history, persist_run,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/calculation", tags=["Calculation"])

_factor_repo = FactorRepository()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _launch(record: RunRecord) -> None:
    """Background thread: run the calculation and update the run record."""
    def on_update(r: RunRecord) -> None:
        run_store.save_run(r)

    try:
        df = run_calculation(record, on_update=on_update)
        run_store.save_results(record.run_id, df)
    except Exception as exc:
        logger.error("[run=%s] FAILED: %s", record.run_id, exc, exc_info=True)
        record.status = RunStatus.ERROR
        record.error = str(exc)
        record.completed_at = _now()
        run_store.save_run(record)

    # Persist to SQLite history regardless of success/failure
    persist_run(record)


# ── Run endpoints ──────────────────────────────────────────────────────────────

@router.post("/run", response_model=APIResponse, status_code=202)
async def start_run(request: RunRequest):
    """Start a background replenishment calculation. Returns run_id immediately."""
    # Validate factor set exists
    fs = _factor_repo.get_set(request.factor_set_id)
    if not fs:
        return APIResponse.fail(message=f"Factor set '{request.factor_set_id}' not found")

    run_id = str(uuid.uuid4())
    label = request.label or f"{fs.name} — {datetime.now().strftime('%d %b %H:%M')}"

    record = RunRecord(
        run_id=run_id,
        status=RunStatus.PENDING,
        label=label,
        request=request,
        factor_set_name=fs.name,
    )
    run_store.save_run(record)

    t = threading.Thread(target=_launch, args=(record,), daemon=True)
    t.start()

    return APIResponse.ok(
        data={"run_id": run_id, "label": label, "status": RunStatus.PENDING},
        message="Calculation started",
    )


@router.get("/runs", response_model=APIResponse)
async def list_runs():
    """List recent calculation runs (newest first)."""
    runs = run_store.list_runs()
    return APIResponse.ok(data={
        "runs": [r.model_dump(exclude={"request"}) for r in runs],
        "count": len(runs),
    })


@router.get("/runs/{run_id}", response_model=APIResponse)
async def get_run(run_id: str):
    """Poll the status of a calculation run."""
    record = run_store.get_run(run_id)
    if not record:
        return APIResponse.fail(message=f"Run '{run_id}' not found")
    return APIResponse.ok(data=record.model_dump(exclude={"request"}))


def _apply_result_filters(df, *, min_req, max_req, division, attribute1, department,
                          store_grade, store_name, req_only, scopes=None):
    """Apply all optional result filters in-place on a DataFrame copy."""
    import json
    import pandas as _pd
    if min_req is not None and "req" in df.columns:
        df = df[df["req"] >= min_req]
    if max_req is not None and "req" in df.columns:
        df = df[df["req"] <= max_req]
    # Multi-scope OR filter (list of {division, attribute1} dicts)
    parsed_scopes = None
    if scopes:
        try:
            parsed_scopes = json.loads(scopes)
        except Exception:
            parsed_scopes = None
    if parsed_scopes:
        masks = []
        for sc in parsed_scopes:
            m = _pd.Series(True, index=df.index)
            if sc.get("division") and "division" in df.columns:
                if sc.get("div_op") == "<>":
                    m &= df["division"] != sc["division"]
                else:
                    m &= df["division"] == sc["division"]
            if sc.get("attribute1") and "attribute1" in df.columns:
                if sc.get("attr_op") == "<>":
                    m &= df["attribute1"] != sc["attribute1"]
                else:
                    m &= df["attribute1"] == sc["attribute1"]
            masks.append(m)
        if masks:
            combined = masks[0]
            for m in masks[1:]:
                combined |= m
            df = df[combined]
    else:
        if division and "division" in df.columns:
            df = df[df["division"] == division]
        if attribute1 and "attribute1" in df.columns:
            df = df[df["attribute1"] == attribute1]
    if department and "department" in df.columns:
        df = df[df["department"] == department]
    if store_grade and "store_grade" in df.columns:
        df = df[df["store_grade"] == store_grade]
    if store_name and "store_name" in df.columns:
        df = df[df["store_name"].str.contains(store_name, case=False, na=False)]
    if req_only and "req" in df.columns:
        df = df[df["req"] > 0]
    return df


@router.get("/runs/{run_id}/results", response_model=APIResponse)
async def get_results(
    run_id: str,
    offset: int = Query(0, ge=0),
    limit: int = Query(500, ge=1, le=5000),
    sort_by: Optional[str] = Query(None),
    sort_desc: bool = Query(False),
    min_req: Optional[float] = Query(None),
    max_req: Optional[float] = Query(None),
    division: Optional[str] = Query(None),
    attribute1: Optional[str] = Query(None),
    department: Optional[str] = Query(None),
    store_grade: Optional[str] = Query(None),
    store_name: Optional[str] = Query(None),
    req_only: bool = Query(False, description="Exclude zero-REQ rows"),
    scopes: Optional[str] = Query(None, description="JSON array of {division,attribute1} for OR-filter"),
):
    """Return paginated result rows for a completed run with rich filtering."""
    record = run_store.get_run(run_id)
    if not record:
        return APIResponse.fail(message=f"Run '{run_id}' not found")
    if record.status != RunStatus.COMPLETE:
        return APIResponse.fail(message=f"Run status is '{record.status}' — results not available yet")

    df = run_store.get_results(run_id)
    if df is None:
        return APIResponse.fail(message="Results not in memory (run may have been evicted)")

    df = _apply_result_filters(
        df, min_req=min_req, max_req=max_req, division=division, attribute1=attribute1,
        department=department, store_grade=store_grade, store_name=store_name,
        req_only=req_only, scopes=scopes,
    )

    # Sort
    if sort_by and sort_by in df.columns:
        df = df.sort_values(sort_by, ascending=not sort_desc)

    total = len(df)
    page = df.iloc[offset: offset + limit]

    # Filtered KPI summary
    filtered_summary = {
        "total_req": float(df["req"].sum()) if "req" in df.columns else 0,
        "total_pbs": float(df["fnl_pbs"].sum()) if "fnl_pbs" in df.columns else 0,
        "stores": int(df["store_name"].nunique()) if "store_name" in df.columns else 0,
        "zero_req": int((df["req"] == 0).sum()) if "req" in df.columns else 0,
        "capped": int(df["req_capped"].sum()) if "req_capped" in df.columns else 0,
    }

    return APIResponse.ok(data={
        "total": total,
        "offset": offset,
        "limit": limit,
        "rows": page.fillna("").to_dict(orient="records"),
        "filtered_summary": filtered_summary,
    })


@router.get("/runs/{run_id}/results/aggregate", response_model=APIResponse)
async def aggregate_results(
    run_id: str,
    group_by: str = Query("division", description="Group by: division | department | store_grade | store_name"),
    min_req: Optional[float] = Query(None),
    max_req: Optional[float] = Query(None),
    division: Optional[str] = Query(None),
    attribute1: Optional[str] = Query(None),
    department: Optional[str] = Query(None),
    store_grade: Optional[str] = Query(None),
    scopes: Optional[str] = Query(None),
):
    """Return aggregated REQ summary grouped by a dimension column."""
    record = run_store.get_run(run_id)
    if not record:
        return APIResponse.fail(message=f"Run '{run_id}' not found")
    if record.status != RunStatus.COMPLETE:
        return APIResponse.fail(message=f"Run not complete")

    df = run_store.get_results(run_id)
    if df is None:
        return APIResponse.fail(message="Results not in memory")

    df = _apply_result_filters(
        df, min_req=min_req, max_req=max_req, division=division, attribute1=attribute1,
        department=department, store_grade=store_grade, store_name=None,
        req_only=False, scopes=scopes,
    )

    allowed = {"division", "department", "store_grade", "store_name", "attribute1"}
    if group_by not in allowed or group_by not in df.columns:
        return APIResponse.fail(message=f"group_by must be one of: {', '.join(allowed)}")

    agg = (
        df.groupby(group_by, dropna=False)
        .agg(
            total_req=("req", "sum"),
            total_pbs=("fnl_pbs", "sum") if "fnl_pbs" in df.columns else ("req", "count"),
            rows=("req", "count"),
            stores=("store_name", "nunique") if "store_name" in df.columns else ("req", "count"),
            zero_req=("req", lambda s: (s == 0).sum()),
            capped=("req_capped", "sum") if "req_capped" in df.columns else ("req", "count"),
            avg_cover=("stock_cover_days", "mean") if "stock_cover_days" in df.columns else ("req", "count"),
        )
        .reset_index()
        .sort_values("total_req", ascending=False)
    )
    agg = agg.fillna(0)

    return APIResponse.ok(data={
        "group_by": group_by,
        "rows": agg.to_dict(orient="records"),
        "total_req": float(df["req"].sum()) if "req" in df.columns else 0,
    })


@router.get("/runs/{run_id}/results/filter-options", response_model=APIResponse)
async def result_filter_options(run_id: str):
    """Return unique values for filter dropdowns (divisions, depts, grades)."""
    record = run_store.get_run(run_id)
    if not record or record.status != RunStatus.COMPLETE:
        return APIResponse.fail(message="Run not found or not complete")
    df = run_store.get_results(run_id)
    if df is None:
        return APIResponse.fail(message="Results not in memory")

    def uniq(col):
        if col not in df.columns:
            return []
        return sorted(df[col].dropna().unique().tolist())

    return APIResponse.ok(data={
        "divisions": uniq("division"),
        "attribute1s": uniq("attribute1"),
        "departments": uniq("department"),
        "store_grades": uniq("store_grade"),
        "display_types": uniq("display_type"),
        "columns": list(df.columns),
        "total_rows": len(df),
    })


@router.get("/runs/{run_id}/export")
async def export_results(
    run_id: str,
    cover: bool = Query(True),
    summary: bool = Query(True),
    results: bool = Query(True),
    breakdown: bool = Query(True),
    exceptions: bool = Query(True),
    factor_config: bool = Query(True),
):
    """
    Download results as a production-quality formatted Excel workbook.
    Use query params (cover, summary, results, breakdown, exceptions, factor_config)
    to control which sheets are included.
    """
    from app.engine.excel_exporter import build_workbook
    from app.repositories.factor_repository import FactorRepository

    record = run_store.get_run(run_id)
    if not record or record.status != RunStatus.COMPLETE:
        return APIResponse.fail(message="Run not complete")

    df = run_store.get_results(run_id)
    if df is None:
        return APIResponse.fail(message="Results not in memory")

    exc_records = exception_store.get_exceptions(run_id) or []

    fs = None
    if record.request and record.request.factor_set_id:
        try:
            fs = FactorRepository().get_set(record.request.factor_set_id)
        except Exception:
            pass

    workbook_bytes = build_workbook(
        record=record,
        result_df=df,
        exceptions=exc_records,
        factor_set=fs,
        include_cover=cover,
        include_summary=summary,
        include_results=results,
        include_breakdown=breakdown,
        include_exceptions=exceptions,
        include_factor_config=factor_config,
    )

    safe = "".join(c if c.isalnum() or c in "-_ " else "_" for c in (record.label or run_id))
    import io as _io
    return StreamingResponse(
        _io.BytesIO(workbook_bytes),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="alloc_{safe}.xlsx"'},
    )


@router.get("/runs/{run_id}/exceptions", response_model=APIResponse)
async def get_exceptions(run_id: str):
    """Return validation exceptions for a completed run."""
    record = run_store.get_run(run_id)
    if not record:
        return APIResponse.fail(message=f"Run '{run_id}' not found")
    if record.status != RunStatus.COMPLETE:
        return APIResponse.fail(message=f"Run status is '{record.status}' — exceptions not available yet")

    records = exception_store.get_exceptions(run_id)
    if records is None:
        return APIResponse.ok(data={"exceptions": [], "count": 0,
                                    "error_count": 0, "warning_count": 0, "info_count": 0})

    serialized = [
        {
            "rule": e.rule,
            "severity": e.severity,
            "title": e.title,
            "message": e.message,
            "row_count": e.row_count,
            "sample_rows": e.sample_rows,
        }
        for e in records
    ]

    return APIResponse.ok(data={
        "exceptions": serialized,
        "count": len(serialized),
        "error_count": sum(1 for e in records if e.severity == "error"),
        "warning_count": sum(1 for e in records if e.severity == "warning"),
        "info_count": sum(1 for e in records if e.severity == "info"),
    })


# ── History endpoints ──────────────────────────────────────────────────────────

@router.get("/history", response_model=APIResponse)
async def list_run_history(
    status: Optional[str] = Query(None, description="Filter by status: complete|error|running|pending"),
    attribute1: Optional[str] = Query(None),
    factor_set_name: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    """List persisted run history from SQLite (survives restarts)."""
    rows, total = list_history(
        status=status,
        attribute1=attribute1,
        factor_set_name=factor_set_name,
        limit=limit,
        offset=offset,
    )
    # Decode steps_json back to list for each row
    for row in rows:
        if row.get("steps_json"):
            try:
                row["steps"] = json.loads(row["steps_json"])
            except Exception:
                row["steps"] = []
        else:
            row["steps"] = []
        del row["steps_json"]

    return APIResponse.ok(data={"runs": rows, "total": total, "offset": offset, "limit": limit})


@router.get("/history/{run_id}", response_model=APIResponse)
async def get_history_detail(run_id: str):
    """Full detail of a single persisted run."""
    row = get_history_run(run_id)
    if not row:
        return APIResponse.fail(message=f"Run '{run_id}' not found in history")
    return APIResponse.ok(data=row)


@router.delete("/history/{run_id}", response_model=APIResponse)
async def delete_history_entry(run_id: str):
    """Remove a run from the persistent history log."""
    deleted = delete_history_run(run_id)
    if not deleted:
        return APIResponse.fail(message=f"Run '{run_id}' not found in history")
    return APIResponse.ok(message=f"Run '{run_id}' deleted from history")


@router.get("/history/export/excel")
async def export_history_excel(
    status: Optional[str] = Query(None),
    attribute1: Optional[str] = Query(None),
):
    """Export the full run history log as Excel."""
    rows, _ = list_history(status=status, attribute1=attribute1, limit=500, offset=0)

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Run History"

    COLS = [
        "run_id", "label", "status", "factor_set_name", "attribute1", "division",
        "department", "started_at", "completed_at", "duration_s",
        "total_rows", "stores", "departments_count", "total_req", "total_pbs",
        "fill_rate_achieved", "zero_req_rows", "capped_rows",
        "exception_errors", "exception_warnings", "exception_infos",
        "result_rows", "error_msg",
    ]
    ws.append(COLS)
    for row in rows:
        ws.append([row.get(c, "") for c in COLS])

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)

    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="run_history.xlsx"'},
    )
