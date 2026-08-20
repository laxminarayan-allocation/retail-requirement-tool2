"""
Unit tests for app.engine.exception_store (in-memory, no I/O).
"""
import pytest
from app.engine import exception_store
from app.engine.validator import ExceptionRecord


def _rec(rule: str, severity: str = "warning") -> ExceptionRecord:
    return ExceptionRecord(
        rule=rule, severity=severity,
        title=f"Title {rule}", message=f"Msg {rule}",
        row_count=1, sample_rows=[{"store_name": "S1"}],
    )


def test_save_and_get():
    records = [_rec("rule_a", "error"), _rec("rule_b", "warning")]
    exception_store.save_exceptions("run-1", records)
    out = exception_store.get_exceptions("run-1")
    assert out is not None
    assert len(out) == 2
    assert out[0].rule == "rule_a"


def test_get_missing_run_returns_none():
    assert exception_store.get_exceptions("no-such-run") is None


def test_overwrite_existing():
    exception_store.save_exceptions("run-2", [_rec("old")])
    exception_store.save_exceptions("run-2", [_rec("new_a"), _rec("new_b")])
    out = exception_store.get_exceptions("run-2")
    assert len(out) == 2
    assert {r.rule for r in out} == {"new_a", "new_b"}


def test_empty_list_saved_and_retrieved():
    exception_store.save_exceptions("run-3", [])
    out = exception_store.get_exceptions("run-3")
    assert out == []


def test_multiple_runs_isolated():
    exception_store.save_exceptions("run-A", [_rec("rule_x")])
    exception_store.save_exceptions("run-B", [_rec("rule_y"), _rec("rule_z")])
    a = exception_store.get_exceptions("run-A")
    b = exception_store.get_exceptions("run-B")
    assert len(a) == 1
    assert len(b) == 2
