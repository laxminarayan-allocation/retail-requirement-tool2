"""
API integration tests for calculation routes.

The calculator and Oracle are mocked — these tests verify routing, request
validation, response envelope shape, and state management only.
"""
import pytest
from unittest.mock import patch, MagicMock
from httpx import AsyncClient, ASGITransport

from app.main import app
from app.engine import run_store, exception_store
from app.models.calculation_models import RunRecord, RunRequest, RunStatus, RunSummary, StepLog
from app.engine.validator import ExceptionRecord


# ── helpers ───────────────────────────────────────────────────────────────────

async def _client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


def _complete_record(run_id: str = "run-test") -> RunRecord:
    req = RunRequest(factor_set_id="fs-001", attribute1="PREWINTER")
    rec = RunRecord(
        run_id=run_id, status=RunStatus.COMPLETE,
        label="Test Run", request=req, factor_set_name="Test FS",
        started_at="2026-08-01T10:00:00+00:00",
        completed_at="2026-08-01T10:01:00+00:00",
        duration_s=60.0, result_rows=5,
    )
    rec.summary = RunSummary(
        total_rows=5, stores=5, departments=2,
        total_req=311.0, total_pbs=460.0,
        fill_rate_achieved=0.795, zero_req_rows=0, capped_rows=0,
    )
    rec.steps = [StepLog(step=i, name=f"Step {i}", status="ok") for i in range(1, 4)]
    return rec


# ── GET /api/calculation/runs ─────────────────────────────────────────────────

async def test_list_runs_empty():
    async with await _client() as c:
        r = await c.get("/api/calculation/runs")
    assert r.status_code == 200
    body = r.json()
    assert body["success"] is True
    assert body["data"]["runs"] == []
    assert body["data"]["count"] == 0


async def test_list_runs_shows_saved_run():
    run_store.save_run(_complete_record("r-list"))
    async with await _client() as c:
        r = await c.get("/api/calculation/runs")
    body = r.json()
    assert body["data"]["count"] == 1
    assert body["data"]["runs"][0]["run_id"] == "r-list"


# ── GET /api/calculation/runs/{id} ────────────────────────────────────────────

async def test_get_run_not_found():
    async with await _client() as c:
        r = await c.get("/api/calculation/runs/ghost")
    body = r.json()
    assert body["success"] is False
    assert "not found" in body["message"].lower()


async def test_get_run_found():
    run_store.save_run(_complete_record("r-get"))
    async with await _client() as c:
        r = await c.get("/api/calculation/runs/r-get")
    body = r.json()
    assert body["success"] is True
    assert body["data"]["run_id"] == "r-get"
    assert body["data"]["status"] == "complete"


async def test_get_run_does_not_expose_request_in_envelope():
    """request field is excluded from the poll response (contains factor_set_id)."""
    run_store.save_run(_complete_record("r-noreq"))
    async with await _client() as c:
        r = await c.get("/api/calculation/runs/r-noreq")
    body = r.json()
    assert "request" not in body["data"]


# ── GET /api/calculation/runs/{id}/results ────────────────────────────────────

async def test_get_results_run_not_found():
    async with await _client() as c:
        r = await c.get("/api/calculation/runs/ghost/results")
    body = r.json()
    assert body["success"] is False


async def test_get_results_run_not_complete():
    rec = _complete_record("r-running")
    rec.status = RunStatus.RUNNING
    run_store.save_run(rec)
    async with await _client() as c:
        r = await c.get("/api/calculation/runs/r-running/results")
    body = r.json()
    assert body["success"] is False
    assert "running" in body["message"].lower() or "complete" in body["message"].lower()


async def test_get_results_paginated(clean_df):
    import pandas as pd
    run_store.save_run(_complete_record("r-res"))
    run_store.save_results("r-res", clean_df)
    async with await _client() as c:
        r = await c.get("/api/calculation/runs/r-res/results", params={"limit": 2, "offset": 0})
    body = r.json()
    assert body["success"] is True
    assert body["data"]["total"] == 5
    assert len(body["data"]["rows"]) == 2
    assert body["data"]["offset"] == 0


async def test_get_results_filter_by_req_only(clean_df):
    import pandas as pd
    df = clean_df.copy()
    df.loc[0, "req"] = 0.0
    run_store.save_run(_complete_record("r-filt"))
    run_store.save_results("r-filt", df)
    async with await _client() as c:
        r = await c.get("/api/calculation/runs/r-filt/results", params={"req_only": "true", "limit": 100})
    body = r.json()
    assert body["success"] is True
    assert body["data"]["total"] == 4   # one row was zeroed


async def test_get_results_filter_by_division(clean_df):
    run_store.save_run(_complete_record("r-div"))
    run_store.save_results("r-div", clean_df)
    async with await _client() as c:
        r = await c.get("/api/calculation/runs/r-div/results", params={"division": "WOVEN", "limit": 100})
    body = r.json()
    assert body["data"]["total"] == 5   # all rows are WOVEN in clean_df


async def test_get_results_filter_division_no_match(clean_df):
    run_store.save_run(_complete_record("r-nodiv"))
    run_store.save_results("r-nodiv", clean_df)
    async with await _client() as c:
        r = await c.get("/api/calculation/runs/r-nodiv/results", params={"division": "NONEXISTENT"})
    body = r.json()
    assert body["data"]["total"] == 0


# ── GET /api/calculation/runs/{id}/results/filter-options ────────────────────

async def test_filter_options(clean_df):
    run_store.save_run(_complete_record("r-opts"))
    run_store.save_results("r-opts", clean_df)
    async with await _client() as c:
        r = await c.get("/api/calculation/runs/r-opts/results/filter-options")
    body = r.json()
    assert body["success"] is True
    data = body["data"]
    assert "divisions" in data
    assert "departments" in data
    assert "store_grades" in data
    assert "WOVEN" in data["divisions"]
    assert data["total_rows"] == 5


# ── GET /api/calculation/runs/{id}/results/aggregate ─────────────────────────

async def test_aggregate_by_division(clean_df):
    run_store.save_run(_complete_record("r-agg"))
    run_store.save_results("r-agg", clean_df)
    async with await _client() as c:
        r = await c.get("/api/calculation/runs/r-agg/results/aggregate", params={"group_by": "division"})
    body = r.json()
    assert body["success"] is True
    rows = body["data"]["rows"]
    assert len(rows) >= 1
    assert "total_req" in rows[0]


async def test_aggregate_invalid_group_by(clean_df):
    run_store.save_run(_complete_record("r-badagg"))
    run_store.save_results("r-badagg", clean_df)
    async with await _client() as c:
        r = await c.get("/api/calculation/runs/r-badagg/results/aggregate",
                        params={"group_by": "invalid_col"})
    body = r.json()
    assert body["success"] is False


# ── GET /api/calculation/runs/{id}/exceptions ────────────────────────────────

async def test_exceptions_run_not_complete():
    rec = _complete_record("r-exc-run")
    rec.status = RunStatus.RUNNING
    run_store.save_run(rec)
    async with await _client() as c:
        r = await c.get("/api/calculation/runs/r-exc-run/exceptions")
    body = r.json()
    assert body["success"] is False


async def test_exceptions_no_exceptions_stored():
    run_store.save_run(_complete_record("r-noexc"))
    async with await _client() as c:
        r = await c.get("/api/calculation/runs/r-noexc/exceptions")
    body = r.json()
    assert body["success"] is True
    assert body["data"]["count"] == 0


async def test_exceptions_returned_correctly():
    run_store.save_run(_complete_record("r-exc"))
    exception_store.save_exceptions("r-exc", [
        ExceptionRecord(rule="test_rule", severity="warning",
                        title="Test", message="msg", row_count=2,
                        sample_rows=[{"store_name": "S1"}]),
    ])
    async with await _client() as c:
        r = await c.get("/api/calculation/runs/r-exc/exceptions")
    body = r.json()
    assert body["data"]["count"] == 1
    assert body["data"]["warning_count"] == 1
    assert body["data"]["exceptions"][0]["rule"] == "test_rule"


# ── POST /api/calculation/run (mocked) ───────────────────────────────────────

async def test_start_run_missing_factor_set(sqlite_db):
    """If factor set does not exist the endpoint should return failure."""
    async with await _client() as c:
        r = await c.post("/api/calculation/run", json={
            "factor_set_id": "nonexistent-fs",
            "attribute1": "PREWINTER",
        })
    body = r.json()
    assert body["success"] is False
    assert "not found" in body["message"].lower()


async def test_start_run_launches_with_valid_factor_set(sqlite_db):
    """With a valid factor set, run should be accepted (202) and a run_id returned."""
    from app.repositories.factor_repository import FactorRepository
    from app.models.factor_models import FactorSetCreate, FactorConfig
    repo = FactorRepository()
    fs = repo.create_set(FactorSetCreate(name="FS", config=FactorConfig(), grade_factors=[], division_factors=[]))

    with patch("app.engine.calculator.run_calculation") as mock_calc, \
         patch("app.repositories.history_repository.persist_run"):
        import pandas as pd
        mock_calc.return_value = pd.DataFrame({"req": [10.0]})

        async with await _client() as c:
            r = await c.post("/api/calculation/run", json={
                "factor_set_id": fs.id,
                "attribute1": "PREWINTER",
            })
    assert r.status_code == 202
    body = r.json()
    assert body["success"] is True
    assert "run_id" in body["data"]
