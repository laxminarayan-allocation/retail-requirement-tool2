"""
Integration tests for app.repositories.history_repository using a temp SQLite DB.
"""
import pytest
from app.models.calculation_models import RunRecord, RunRequest, RunStatus, RunSummary, StepLog
from app.repositories import history_repository


def _make_record(run_id: str, status: RunStatus = RunStatus.COMPLETE) -> RunRecord:
    req = RunRequest(factor_set_id="fs-001", attribute1="PREWINTER", season="AW26")
    rec = RunRecord(
        run_id=run_id,
        status=status,
        label=f"Test {run_id}",
        request=req,
        factor_set_name="Test FS",
        started_at="2026-08-01T10:00:00+00:00",
        completed_at="2026-08-01T10:01:00+00:00" if status == RunStatus.COMPLETE else None,
        duration_s=60.0 if status == RunStatus.COMPLETE else None,
        result_rows=10,
    )
    rec.summary = RunSummary(
        total_rows=10, stores=5, departments=2,
        total_req=500.0, total_pbs=600.0,
        fill_rate_achieved=0.85, zero_req_rows=0, capped_rows=1,
    )
    rec.steps = [StepLog(step=i, name=f"Step {i}", status="ok") for i in range(1, 4)]
    return rec


# ── persist_run ───────────────────────────────────────────────────────────────

def test_persist_run_creates_row(sqlite_db):
    rec = _make_record("run-001")
    history_repository.persist_run(rec)
    row = history_repository.get_history_run("run-001")
    assert row is not None
    assert row["run_id"] == "run-001"
    assert row["status"] == "complete"
    assert row["factor_set_name"] == "Test FS"
    assert row["total_req"] == pytest.approx(500.0)


def test_persist_run_upsert(sqlite_db):
    rec = _make_record("run-002", RunStatus.RUNNING)
    history_repository.persist_run(rec)
    rec.status = RunStatus.COMPLETE
    rec.duration_s = 99.0
    history_repository.persist_run(rec)
    row = history_repository.get_history_run("run-002")
    assert row["status"] == "complete"
    assert row["duration_s"] == pytest.approx(99.0)


def test_persist_run_stores_steps(sqlite_db):
    rec = _make_record("run-003")
    history_repository.persist_run(rec)
    row = history_repository.get_history_run("run-003")
    assert isinstance(row["steps"], list)
    assert len(row["steps"]) == 3


# ── list_history ──────────────────────────────────────────────────────────────

def test_list_history_returns_all(sqlite_db):
    for i in range(3):
        history_repository.persist_run(_make_record(f"run-{i:03}"))
    rows, total = history_repository.list_history(limit=50, offset=0)
    assert total == 3
    assert len(rows) == 3


def test_list_history_filter_by_status(sqlite_db):
    history_repository.persist_run(_make_record("run-ok", RunStatus.COMPLETE))
    history_repository.persist_run(_make_record("run-err", RunStatus.ERROR))
    rows, total = history_repository.list_history(status="complete", limit=50, offset=0)
    assert total == 1
    assert rows[0]["run_id"] == "run-ok"


def test_list_history_filter_by_attribute1(sqlite_db):
    history_repository.persist_run(_make_record("run-pw"))
    rows, total = history_repository.list_history(attribute1="PREWINTER", limit=50, offset=0)
    assert total == 1


def test_list_history_pagination(sqlite_db):
    for i in range(5):
        history_repository.persist_run(_make_record(f"run-p{i}"))
    rows, total = history_repository.list_history(limit=2, offset=0)
    assert total == 5
    assert len(rows) == 2
    rows2, _ = history_repository.list_history(limit=2, offset=2)
    assert len(rows2) == 2
    # No overlap
    ids1 = {r["run_id"] for r in rows}
    ids2 = {r["run_id"] for r in rows2}
    assert ids1.isdisjoint(ids2)


def test_list_history_empty(sqlite_db):
    rows, total = history_repository.list_history(limit=50, offset=0)
    assert total == 0
    assert rows == []


# ── get_history_run ───────────────────────────────────────────────────────────

def test_get_history_run_returns_none_for_missing(sqlite_db):
    assert history_repository.get_history_run("ghost-run") is None


def test_get_history_run_steps_decoded(sqlite_db):
    rec = _make_record("run-steps")
    history_repository.persist_run(rec)
    row = history_repository.get_history_run("run-steps")
    assert "steps" in row
    assert "steps_json" not in row


# ── delete_history_run ────────────────────────────────────────────────────────

def test_delete_history_run_removes_row(sqlite_db):
    history_repository.persist_run(_make_record("run-del"))
    deleted = history_repository.delete_history_run("run-del")
    assert deleted is True
    assert history_repository.get_history_run("run-del") is None


def test_delete_missing_run_returns_false(sqlite_db):
    assert history_repository.delete_history_run("no-such-run") is False
