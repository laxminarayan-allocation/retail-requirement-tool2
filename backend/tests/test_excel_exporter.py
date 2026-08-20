"""
Unit tests for app.engine.excel_exporter.build_workbook.

No Oracle — uses synthetic DataFrames and RunRecord objects.
"""
import io
import pytest
import openpyxl
import pandas as pd

from app.engine.excel_exporter import build_workbook
from app.models.calculation_models import RunRecord, RunRequest, RunStatus, RunSummary, StepLog
from app.models.factor_models import FactorSet, FactorConfig, GradeFactor
from app.engine.validator import ExceptionRecord


# ── fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture
def record():
    req = RunRequest(factor_set_id="fs-001", attribute1="PREWINTER", season="AW26")
    rec = RunRecord(
        run_id="wb-test-001", status=RunStatus.COMPLETE,
        label="Workbook Test Run", request=req, factor_set_name="Test FS",
        started_at="2026-08-01T10:00:00+00:00",
        completed_at="2026-08-01T10:01:00+00:00",
        duration_s=60.0, result_rows=5,
    )
    rec.summary = RunSummary(
        total_rows=5, stores=5, departments=2,
        total_req=311.0, total_pbs=460.0,
        fill_rate_achieved=0.795, zero_req_rows=0, capped_rows=1,
    )
    rec.steps = [StepLog(step=i, name=f"Step {i}", status="ok") for i in range(1, 14)]
    return rec


@pytest.fixture
def factor_set():
    return FactorSet(
        id="fs-001", name="Test FS",
        attribute1="PREWINTER", season="AW26",
        created_at="2026-08-01T09:00:00+00:00",
        updated_at="2026-08-01T09:00:00+00:00",
        is_active=True,
        config=FactorConfig(safety_days=14, fill_rate_target=0.85),
        grade_factors=[
            GradeFactor(grade="A+", pbs_multiplier=1.2),
            GradeFactor(grade="A", pbs_multiplier=1.0),
        ],
        division_factors=[],
    )


@pytest.fixture
def exceptions():
    return [
        ExceptionRecord(
            rule="negative_stock", severity="error",
            title="Negative Stock", message="2 rows with negative stock",
            row_count=2, sample_rows=[{"store_name": "S1"}, {"store_name": "S2"}],
        ),
        ExceptionRecord(
            rule="capped_by_capacity", severity="info",
            title="Capped Rows", message="1 row capped",
            row_count=1, sample_rows=[{"store_name": "S3"}],
        ),
    ]


def _load_wb(raw_bytes: bytes) -> openpyxl.Workbook:
    return openpyxl.load_workbook(io.BytesIO(raw_bytes))


# ── all-sheets build ──────────────────────────────────────────────────────────

def test_build_workbook_returns_bytes(record, clean_df, exceptions, factor_set):
    raw = build_workbook(
        record=record, result_df=clean_df, exceptions=exceptions,
        factor_set=factor_set,
        include_cover=True, include_summary=True, include_results=True,
        include_breakdown=True, include_exceptions=True, include_factor_config=True,
    )
    assert isinstance(raw, bytes)
    assert len(raw) > 1000   # non-trivial workbook


def test_build_workbook_six_sheets(record, clean_df, exceptions, factor_set):
    raw = build_workbook(
        record=record, result_df=clean_df, exceptions=exceptions,
        factor_set=factor_set,
        include_cover=True, include_summary=True, include_results=True,
        include_breakdown=True, include_exceptions=True, include_factor_config=True,
    )
    wb = _load_wb(raw)
    assert len(wb.sheetnames) == 6


def test_build_workbook_sheet_names(record, clean_df, exceptions, factor_set):
    raw = build_workbook(
        record=record, result_df=clean_df, exceptions=exceptions,
        factor_set=factor_set,
        include_cover=True, include_summary=True, include_results=True,
        include_breakdown=True, include_exceptions=True, include_factor_config=True,
    )
    wb = _load_wb(raw)
    names = wb.sheetnames
    assert "Cover" in names
    assert "Summary" in names
    assert "Results" in names
    assert "Breakdown" in names
    assert "Exceptions" in names
    assert "Factor Config" in names


# ── selective sheet inclusion ─────────────────────────────────────────────────

def test_build_workbook_results_only(record, clean_df):
    raw = build_workbook(
        record=record, result_df=clean_df, exceptions=[], factor_set=None,
        include_cover=False, include_summary=False, include_results=True,
        include_breakdown=False, include_exceptions=False, include_factor_config=False,
    )
    wb = _load_wb(raw)
    assert wb.sheetnames == ["Results"]


def test_build_workbook_cover_and_summary_only(record, clean_df, factor_set):
    raw = build_workbook(
        record=record, result_df=clean_df, exceptions=[], factor_set=factor_set,
        include_cover=True, include_summary=True, include_results=False,
        include_breakdown=False, include_exceptions=False, include_factor_config=False,
    )
    wb = _load_wb(raw)
    assert len(wb.sheetnames) == 2
    assert "Cover" in wb.sheetnames
    assert "Summary" in wb.sheetnames


# ── results sheet dimensions ──────────────────────────────────────────────────

def test_results_sheet_row_count_matches_df(record, clean_df):
    """Results sheet should have 1 header row + len(df) data rows."""
    raw = build_workbook(
        record=record, result_df=clean_df, exceptions=[], factor_set=None,
        include_cover=False, include_summary=False, include_results=True,
        include_breakdown=False, include_exceptions=False, include_factor_config=False,
    )
    wb = _load_wb(raw)
    ws = wb["Results"]
    # max_row includes header
    assert ws.max_row == len(clean_df) + 1


def test_results_sheet_has_data(record, clean_df):
    raw = build_workbook(
        record=record, result_df=clean_df, exceptions=[], factor_set=None,
        include_cover=False, include_summary=False, include_results=True,
        include_breakdown=False, include_exceptions=False, include_factor_config=False,
    )
    wb = _load_wb(raw)
    ws = wb["Results"]
    # Row 1 is header — must have content
    assert ws.cell(row=1, column=1).value is not None
    # Row 2 is first data row
    assert ws.cell(row=2, column=1).value is not None


# ── exceptions sheet ──────────────────────────────────────────────────────────

def test_exceptions_sheet_includes_all_records(record, clean_df, exceptions):
    raw = build_workbook(
        record=record, result_df=clean_df, exceptions=exceptions, factor_set=None,
        include_cover=False, include_summary=False, include_results=False,
        include_breakdown=False, include_exceptions=True, include_factor_config=False,
    )
    wb = _load_wb(raw)
    ws = wb["Exceptions"]
    # 1 header + 2 exception records
    assert ws.max_row >= 3


def test_exceptions_sheet_empty_when_no_exceptions(record, clean_df):
    raw = build_workbook(
        record=record, result_df=clean_df, exceptions=[], factor_set=None,
        include_cover=False, include_summary=False, include_results=False,
        include_breakdown=False, include_exceptions=True, include_factor_config=False,
    )
    wb = _load_wb(raw)
    ws = wb["Exceptions"]
    # Only header row
    assert ws.max_row == 1


# ── large DataFrame truncation notice ────────────────────────────────────────

def test_large_df_produces_valid_workbook(record):
    """A 201-row DataFrame should trigger the truncation notice but still produce valid xlsx."""
    big_df = pd.DataFrame({
        "store_name": [f"S{i}" for i in range(201)],
        "req": [10.0] * 201,
        "req_capped": [0] * 201,
    })
    raw = build_workbook(
        record=record, result_df=big_df, exceptions=[], factor_set=None,
        include_cover=False, include_summary=False, include_results=True,
        include_breakdown=False, include_exceptions=False, include_factor_config=False,
    )
    assert isinstance(raw, bytes) and len(raw) > 0
    wb = _load_wb(raw)
    assert "Results" in wb.sheetnames
