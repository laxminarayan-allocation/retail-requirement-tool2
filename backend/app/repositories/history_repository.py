"""
Persistent history repository — stores completed run records in SQLite.

Keeps the last 500 runs. Results DataFrames are NOT persisted (stay in-memory
in run_store); this table is for the audit trail only.
"""
import json
import logging
from typing import Optional

from app.db.sqlite import get_sqlite
from app.engine import exception_store
from app.models.calculation_models import RunRecord, RunStatus

logger = logging.getLogger(__name__)

MAX_HISTORY = 500


def persist_run(record: RunRecord) -> None:
    """Upsert a run record into run_history. Call after status = COMPLETE or ERROR."""
    try:
        req = record.request
        exc_records = exception_store.get_exceptions(record.run_id) or []
        err_count = sum(1 for e in exc_records if e.severity == "error")
        warn_count = sum(1 for e in exc_records if e.severity == "warning")
        info_count = sum(1 for e in exc_records if e.severity == "info")

        steps_json = json.dumps([s.model_dump() for s in record.steps])

        with get_sqlite() as conn:
            conn.execute("""
                INSERT INTO run_history (
                    run_id, label, status, factor_set_id, factor_set_name,
                    attribute1, season, division, department,
                    include_transit, include_pack_pending, include_transfer_out,
                    started_at, completed_at, duration_s,
                    total_rows, stores, departments_count,
                    total_req, total_pbs, fill_rate_achieved,
                    zero_req_rows, capped_rows,
                    exception_errors, exception_warnings, exception_infos,
                    error_msg, result_rows, steps_json
                ) VALUES (
                    ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?
                )
                ON CONFLICT(run_id) DO UPDATE SET
                    status              = excluded.status,
                    completed_at        = excluded.completed_at,
                    duration_s          = excluded.duration_s,
                    total_rows          = excluded.total_rows,
                    stores              = excluded.stores,
                    departments_count   = excluded.departments_count,
                    total_req           = excluded.total_req,
                    total_pbs           = excluded.total_pbs,
                    fill_rate_achieved  = excluded.fill_rate_achieved,
                    zero_req_rows       = excluded.zero_req_rows,
                    capped_rows         = excluded.capped_rows,
                    exception_errors    = excluded.exception_errors,
                    exception_warnings  = excluded.exception_warnings,
                    exception_infos     = excluded.exception_infos,
                    error_msg           = excluded.error_msg,
                    result_rows         = excluded.result_rows,
                    steps_json          = excluded.steps_json
            """, (
                record.run_id, record.label, record.status,
                req.factor_set_id if req else None, record.factor_set_name,
                req.attribute1 if req else None, req.season if req else None,
                req.division if req else None, req.department if req else None,
                int(req.include_transit) if req else 1,
                int(req.include_pack_pending) if req else 1,
                int(req.include_transfer_out) if req else 1,
                record.started_at, record.completed_at, record.duration_s,
                record.summary.total_rows if record.summary else 0,
                record.summary.stores if record.summary else 0,
                record.summary.departments if record.summary else 0,
                record.summary.total_req if record.summary else 0,
                record.summary.total_pbs if record.summary else 0,
                record.summary.fill_rate_achieved if record.summary else 0,
                record.summary.zero_req_rows if record.summary else 0,
                record.summary.capped_rows if record.summary else 0,
                err_count, warn_count, info_count,
                record.error, record.result_rows, steps_json,
            ))

            # Prune oldest beyond MAX_HISTORY
            conn.execute("""
                DELETE FROM run_history WHERE run_id NOT IN (
                    SELECT run_id FROM run_history ORDER BY started_at DESC LIMIT ?
                )
            """, (MAX_HISTORY,))

        logger.debug("Persisted run %s to history", record.run_id)
    except Exception as exc:
        logger.warning("Failed to persist run %s to history: %s", record.run_id, exc)


def list_history(
    status: Optional[str] = None,
    attribute1: Optional[str] = None,
    factor_set_name: Optional[str] = None,
    limit: int = 100,
    offset: int = 0,
) -> tuple[list[dict], int]:
    """Return (rows, total_count) with optional filters."""
    clauses = []
    params: list = []
    if status:
        clauses.append("status = ?")
        params.append(status)
    if attribute1:
        clauses.append("attribute1 = ?")
        params.append(attribute1)
    if factor_set_name:
        clauses.append("factor_set_name LIKE ?")
        params.append(f"%{factor_set_name}%")

    where = ("WHERE " + " AND ".join(clauses)) if clauses else ""

    with get_sqlite() as conn:
        total = conn.execute(f"SELECT COUNT(*) FROM run_history {where}", params).fetchone()[0]
        rows = conn.execute(
            f"SELECT * FROM run_history {where} ORDER BY started_at DESC LIMIT ? OFFSET ?",
            params + [limit, offset],
        ).fetchall()

    return [dict(r) for r in rows], total


def get_history_run(run_id: str) -> Optional[dict]:
    with get_sqlite() as conn:
        row = conn.execute("SELECT * FROM run_history WHERE run_id = ?", (run_id,)).fetchone()
    if not row:
        return None
    d = dict(row)
    d["steps"] = json.loads(d.pop("steps_json") or "[]")
    return d


def delete_history_run(run_id: str) -> bool:
    with get_sqlite() as conn:
        cur = conn.execute("DELETE FROM run_history WHERE run_id = ?", (run_id,))
    return cur.rowcount > 0
