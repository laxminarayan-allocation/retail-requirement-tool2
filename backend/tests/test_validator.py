"""
Unit tests for app.engine.validator — all 10 rules.

Each test builds a minimal DataFrame that (a) triggers exactly that rule or
(b) confirms the rule is silent on clean data.
"""
import pandas as pd
import numpy as np
import pytest

from app.engine.validator import run_validation, ExceptionRecord


# ── helpers ───────────────────────────────────────────────────────────────────

def _rules(records: list[ExceptionRecord]) -> set[str]:
    return {r.rule for r in records}


def _severity(records: list[ExceptionRecord], rule: str) -> str | None:
    for r in records:
        if r.rule == rule:
            return r.severity
    return None


# ── clean baseline ────────────────────────────────────────────────────────────

def test_clean_df_no_errors(clean_df):
    records = run_validation(clean_df)
    errors = [r for r in records if r.severity == "error"]
    assert errors == [], f"Unexpected errors on clean DataFrame: {[r.rule for r in errors]}"


# ── Rule: duplicate_rows ──────────────────────────────────────────────────────

def test_duplicate_rows_detected(clean_df):
    df = pd.concat([clean_df, clean_df.iloc[[0]]], ignore_index=True)
    records = run_validation(df)
    assert "duplicate_rows" in _rules(records)
    r = next(r for r in records if r.rule == "duplicate_rows")
    assert r.severity == "error"
    assert r.row_count >= 1


def test_duplicate_rows_silent_when_unique(clean_df):
    records = run_validation(clean_df)
    assert "duplicate_rows" not in _rules(records)


# ── Rule: negative_stock ──────────────────────────────────────────────────────

def test_negative_stock_detected(clean_df):
    df = clean_df.copy()
    df.loc[0, "ttl_stk_q"] = -5.0
    records = run_validation(df)
    assert "negative_stock" in _rules(records)
    r = next(r for r in records if r.rule == "negative_stock")
    assert r.severity == "error"
    assert r.row_count == 1


def test_negative_stock_silent_when_zero_or_positive(clean_df):
    records = run_validation(clean_df)
    assert "negative_stock" not in _rules(records)


# ── Rule: req_exceeds_cap ─────────────────────────────────────────────────────

def test_req_exceeds_cap_detected(clean_df):
    df = clean_df.copy()
    df.loc[1, "req"] = 300.0
    df.loc[1, "bgt_cap"] = 200.0
    records = run_validation(df)
    assert "req_exceeds_cap" in _rules(records)
    assert _severity(records, "req_exceeds_cap") == "error"


def test_req_exceeds_cap_silent_within_limit(clean_df):
    records = run_validation(clean_df)
    assert "req_exceeds_cap" not in _rules(records)


# ── Rule: zero_pbs_nonzero_req ────────────────────────────────────────────────

def test_zero_pbs_nonzero_req_detected(clean_df):
    df = clean_df.copy()
    df.loc[0, "pbs"] = 0.0       # rule checks `pbs` column, not `fnl_pbs`
    df.loc[0, "fnl_pbs"] = 0.0
    df.loc[0, "req"] = 20.0
    records = run_validation(df)
    assert "zero_pbs_nonzero_req" in _rules(records)
    assert _severity(records, "zero_pbs_nonzero_req") == "warning"


def test_zero_pbs_zero_req_no_warning(clean_df):
    df = clean_df.copy()
    df.loc[0, "pbs"] = 0.0
    df.loc[0, "fnl_pbs"] = 0.0
    df.loc[0, "req"] = 0.0
    records = run_validation(df)
    assert "zero_pbs_nonzero_req" not in _rules(records)


# ── Rule: missing_store_grade ─────────────────────────────────────────────────

def test_missing_store_grade_detected(clean_df):
    df = clean_df.copy()
    df.loc[2, "store_grade"] = None
    records = run_validation(df)
    assert "missing_store_grade" in _rules(records)
    assert _severity(records, "missing_store_grade") == "warning"


def test_missing_store_grade_silent_when_all_graded(clean_df):
    records = run_validation(clean_df)
    assert "missing_store_grade" not in _rules(records)


# ── Rule: no_sales_with_req ───────────────────────────────────────────────────

def test_no_sales_with_req_detected(clean_df):
    df = clean_df.copy()
    df.loc[0, "l4w_sl"] = 0.0
    df.loc[0, "daily_sales"] = 0.0
    df.loc[0, "req"] = 40.0
    records = run_validation(df)
    assert "no_sales_with_req" in _rules(records)
    assert _severity(records, "no_sales_with_req") == "warning"


def test_no_sales_no_req_silent(clean_df):
    df = clean_df.copy()
    df.loc[0, "l4w_sl"] = 0.0
    df.loc[0, "daily_sales"] = 0.0
    df.loc[0, "req"] = 0.0
    records = run_validation(df)
    assert "no_sales_with_req" not in _rules(records)


# ── Rule: low_cover_zero_req ──────────────────────────────────────────────────

def test_low_cover_zero_req_detected(clean_df):
    df = clean_df.copy()
    df.loc[0, "stock_cover_days"] = 1.0      # below LOW_COVER_THRESHOLD = 3
    df.loc[0, "daily_sales"] = 5.0           # non-zero sales
    df.loc[0, "req"] = 0.0
    records = run_validation(df)
    assert "low_cover_zero_req" in _rules(records)
    assert _severity(records, "low_cover_zero_req") == "warning"


def test_low_cover_with_req_no_warning(clean_df):
    df = clean_df.copy()
    df.loc[0, "stock_cover_days"] = 1.0
    df.loc[0, "req"] = 30.0
    records = run_validation(df)
    assert "low_cover_zero_req" not in _rules(records)


# ── Rule: high_stock_cover ────────────────────────────────────────────────────

def test_high_stock_cover_detected(clean_df):
    df = clean_df.copy()
    df.loc[0, "stock_cover_days"] = 120.0    # above HIGH_COVER_THRESHOLD = 90
    records = run_validation(df)
    assert "high_stock_cover" in _rules(records)
    assert _severity(records, "high_stock_cover") == "warning"


def test_sentinel_999_excluded_from_high_cover(clean_df):
    """stock_cover_days = 999 is the zero-sales sentinel; must not fire high_stock_cover."""
    df = clean_df.copy()
    df["stock_cover_days"] = 999.0
    records = run_validation(df)
    assert "high_stock_cover" not in _rules(records)


# ── Rule: dead_rows ───────────────────────────────────────────────────────────

def test_dead_rows_detected(clean_df):
    df = clean_df.copy()
    df.loc[0, "pbs"] = 0.0         # rule checks `pbs`, not `fnl_pbs`
    df.loc[0, "fnl_pbs"] = 0.0
    df.loc[0, "l4w_sl"] = 0.0
    df.loc[0, "daily_sales"] = 0.0
    df.loc[0, "req"] = 0.0
    records = run_validation(df)
    assert "dead_rows" in _rules(records)
    assert _severity(records, "dead_rows") == "info"


def test_dead_rows_silent_when_active(clean_df):
    records = run_validation(clean_df)
    assert "dead_rows" not in _rules(records)


# ── Rule: capped_by_capacity ──────────────────────────────────────────────────

def test_capped_by_capacity_detected(clean_df):
    df = clean_df.copy()
    df.loc[0, "req_capped"] = 1
    records = run_validation(df)
    assert "capped_by_capacity" in _rules(records)
    assert _severity(records, "capped_by_capacity") == "info"
    assert next(r for r in records if r.rule == "capped_by_capacity").row_count == 1


def test_capped_by_capacity_silent_when_none_capped(clean_df):
    records = run_validation(clean_df)
    assert "capped_by_capacity" not in _rules(records)


# ── ordering guarantee ────────────────────────────────────────────────────────

def test_results_sorted_error_before_warning_before_info(clean_df):
    """Errors must precede warnings which must precede info in the returned list."""
    df = clean_df.copy()
    # Trigger one of each severity
    df.loc[0, "ttl_stk_q"] = -1.0              # error: negative_stock
    df.loc[1, "fnl_pbs"] = 0.0                 # warning: zero_pbs_nonzero_req (req stays > 0)
    df.loc[2, "req_capped"] = 1                 # info: capped_by_capacity

    records = run_validation(df)
    severities = [r.severity for r in records]
    order = {"error": 0, "warning": 1, "info": 2}
    ordered = sorted(severities, key=lambda s: order.get(s, 9))
    assert severities == ordered, f"Records not sorted by severity: {severities}"


# ── sample_rows cap ───────────────────────────────────────────────────────────

def test_sample_rows_capped_at_50():
    """Each exception should contain at most 50 sample rows."""
    rows = pd.DataFrame({
        "store_name":       [f"S{i}" for i in range(100)],
        "store_grade":      ["A"] * 100,
        "department":       ["TOPS"] * 100,
        "display_type":     ["H"] * 100,
        "division":         ["WOVEN"] * 100,
        "attribute1":       ["PREWINTER"] * 100,
        "pbs":              [0.0] * 100,        # zero PBS to trigger zero_pbs_nonzero_req
        "fnl_pbs":          [0.0] * 100,
        "ttl_stk_q":        [10.0] * 100,
        "l4w_sl":           [20.0] * 100,
        "daily_sales":      [20/28] * 100,
        "stock_cover_days": [14.0] * 100,
        "fill_req":         [85.0] * 100,
        "net_req":          [75.0] * 100,
        "bgt_mc_str":       [200.0] * 100,
        "bgt_cap":          [200.0] * 100,
        "req":              [40.0] * 100,      # non-zero req with zero PBS
        "req_capped":       [0] * 100,
    })
    records = run_validation(rows)
    for r in records:
        assert len(r.sample_rows) <= 50, f"{r.rule} returned {len(r.sample_rows)} sample rows (max 50)"
