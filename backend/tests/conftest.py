"""
Shared fixtures for the test suite.

SQLite isolation:
    Every test that touches SQLite gets a fresh temp DB via the `sqlite_db`
    fixture, which patches `app.db.sqlite.DB_PATH` and re-initialises the schema.

Run-store isolation:
    The `clear_run_store` fixture wipes module-level dicts between tests.

Oracle tests:
    Gated on the env var ORACLE_INTEGRATION_TESTS=1.
"""
import os
import pytest
import pandas as pd
import numpy as np


# ── Marks ─────────────────────────────────────────────────────────────────────

def pytest_configure(config):
    config.addinivalue_line(
        "markers",
        "oracle: mark test as requiring a live Oracle connection (ORACLE_INTEGRATION_TESTS=1)",
    )


def pytest_collection_modifyitems(config, items):
    if not os.environ.get("ORACLE_INTEGRATION_TESTS"):
        skip = pytest.mark.skip(reason="set ORACLE_INTEGRATION_TESTS=1 to run Oracle tests")
        for item in items:
            if "oracle" in item.keywords:
                item.add_marker(skip)


# ── SQLite isolation ──────────────────────────────────────────────────────────

@pytest.fixture
def sqlite_db(tmp_path, monkeypatch):
    """
    Redirect app.db.sqlite to a fresh temp file and initialise the schema.
    Returns the Path to the temp DB file.
    """
    import app.db.sqlite as sqlite_mod
    db_path = tmp_path / "test_factors.db"
    monkeypatch.setattr(sqlite_mod, "DB_PATH", db_path)
    sqlite_mod.init_db()
    return db_path


# ── Run-store isolation ───────────────────────────────────────────────────────

@pytest.fixture(autouse=True)
def clear_run_store():
    """Clear in-memory run store before each test."""
    from app.engine import run_store, exception_store
    with run_store._lock:
        run_store._runs.clear()
        run_store._results.clear()
    with exception_store._lock:
        exception_store._exceptions.clear()
    yield


# ── Sample DataFrames ─────────────────────────────────────────────────────────

@pytest.fixture
def clean_df():
    """A 5-row result DataFrame with no violations."""
    return pd.DataFrame({
        "store_name":       ["S1", "S2", "S3", "S4", "S5"],
        "store_grade":      ["A", "B", "A+", "B+", "C"],
        "department":       ["TOPS", "TOPS", "BOTTOMS", "BOTTOMS", "TOPS"],
        "display_type":     ["H", "H", "H", "H", "H"],
        "division":         ["WOVEN", "WOVEN", "WOVEN", "WOVEN", "WOVEN"],
        "attribute1":       ["PREWINTER"] * 5,
        "pbs":              [100.0, 80.0, 120.0, 90.0, 70.0],
        "fnl_pbs":          [100.0, 80.0, 120.0, 90.0, 70.0],
        "ttl_stk_q":        [20.0,  10.0,  30.0,  15.0, 5.0],
        "l4w_sl":           [40.0,  32.0,  48.0,  36.0, 28.0],
        "daily_sales":      [40/28, 32/28, 48/28, 36/28, 28/28],
        "stock_cover_days": [14.0,  8.8,   17.5,  11.7,  5.0],
        "fill_req":         [85.0,  68.0,  102.0, 76.5,  59.5],
        "net_req":          [65.0,  58.0,  72.0,  61.5,  54.5],
        "bgt_mc_str":       [200.0, 200.0, 200.0, 200.0, 200.0],
        "bgt_cap":          [200.0, 200.0, 200.0, 200.0, 200.0],
        "req":              [65.0,  58.0,  72.0,  61.5,  54.5],
        "req_capped":       [0, 0, 0, 0, 0],
    })


@pytest.fixture
def minimal_run_record():
    """A RunRecord in COMPLETE status for testing routes and history."""
    from app.models.calculation_models import RunRecord, RunRequest, RunStatus, RunSummary, StepLog
    req = RunRequest(
        factor_set_id="fs-test-001",
        attribute1="PREWINTER",
        season="AW26",
    )
    record = RunRecord(
        run_id="run-test-001",
        status=RunStatus.COMPLETE,
        label="Test Run",
        request=req,
        factor_set_name="Test Factor Set",
        started_at="2026-08-01T10:00:00+00:00",
        completed_at="2026-08-01T10:01:30+00:00",
        duration_s=90.0,
        result_rows=5,
    )
    record.summary = RunSummary(
        total_rows=5, stores=5, departments=2,
        total_req=311.0, total_pbs=460.0,
        fill_rate_achieved=0.795,
        zero_req_rows=0, capped_rows=0,
    )
    record.steps = [StepLog(step=i, name=f"Step {i}", status="ok") for i in range(1, 14)]
    return record
