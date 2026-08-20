"""
Unit tests for app.engine.run_store (in-memory, no I/O).
"""
import pandas as pd
import pytest

from app.engine import run_store
from app.models.calculation_models import RunRecord, RunRequest, RunStatus


def _make_record(run_id: str, status: RunStatus = RunStatus.COMPLETE) -> RunRecord:
    return RunRecord(
        run_id=run_id,
        status=status,
        label=f"Run {run_id}",
        request=RunRequest(factor_set_id="fs-001"),
    )


def test_save_and_get_run():
    rec = _make_record("r1")
    run_store.save_run(rec)
    fetched = run_store.get_run("r1")
    assert fetched is not None
    assert fetched.run_id == "r1"
    assert fetched.status == RunStatus.COMPLETE


def test_get_missing_run_returns_none():
    assert run_store.get_run("does-not-exist") is None


def test_save_and_get_results():
    run_store.save_run(_make_record("r2"))
    df = pd.DataFrame({"req": [10.0, 20.0]})
    run_store.save_results("r2", df)
    out = run_store.get_results("r2")
    assert out is not None
    assert list(out["req"]) == [10.0, 20.0]


def test_get_results_missing_run_returns_none():
    assert run_store.get_results("ghost") is None


def test_list_runs_newest_first():
    for i in range(3):
        run_store.save_run(_make_record(f"r{i}"))
    listed = run_store.list_runs()
    ids = [r.run_id for r in listed]
    # list_runs reverses insertion order → newest (r2) first
    assert ids[0] == "r2"
    assert ids[-1] == "r0"


def test_list_runs_empty():
    assert run_store.list_runs() == []


def test_eviction_at_max_runs():
    """Oldest run and its results are evicted when MAX_RUNS is exceeded."""
    for i in range(run_store.MAX_RUNS + 1):
        rec = _make_record(f"r{i}")
        run_store.save_run(rec)
        run_store.save_results(f"r{i}", pd.DataFrame({"req": [float(i)]}))

    # r0 should be evicted
    assert run_store.get_run("r0") is None
    assert run_store.get_results("r0") is None

    # Last run should still be there
    last_id = f"r{run_store.MAX_RUNS}"
    assert run_store.get_run(last_id) is not None


def test_save_run_updates_existing():
    rec = _make_record("r-update", RunStatus.RUNNING)
    run_store.save_run(rec)
    rec.status = RunStatus.COMPLETE
    run_store.save_run(rec)
    fetched = run_store.get_run("r-update")
    assert fetched.status == RunStatus.COMPLETE


def test_list_runs_count_capped_at_max():
    for i in range(run_store.MAX_RUNS + 5):
        run_store.save_run(_make_record(f"r{i}"))
    assert len(run_store.list_runs()) == run_store.MAX_RUNS
