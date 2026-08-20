"""
Validation Engine — Phase 7.

Runs after the calculation produces a results DataFrame.
Each rule returns an Exception record describing anomalies found.
Severities: error (data integrity), warning (business anomaly), info (observation).
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import List

import pandas as pd

logger = logging.getLogger(__name__)

SAMPLE_LIMIT = 50          # max rows to embed per exception
HIGH_COVER_THRESHOLD = 90  # days — flag as overstock
LOW_COVER_THRESHOLD = 3    # days — flag as critically low stock


@dataclass
class ExceptionRecord:
    rule: str
    severity: str          # error | warning | info
    title: str
    message: str
    row_count: int
    sample_rows: List[dict] = field(default_factory=list)


def _sample(df: pd.DataFrame, cols: list[str]) -> list[dict]:
    available = [c for c in cols if c in df.columns]
    return df[available].head(SAMPLE_LIMIT).fillna("").to_dict(orient="records")


KEY_COLS = ["store_name", "store_grade", "division", "department", "display_type",
            "pbs", "fnl_pbs", "ttl_stk_q", "l4w_sl", "daily_sales",
            "stock_cover_days", "req", "bgt_cap"]


def run_validation(result: pd.DataFrame) -> list[ExceptionRecord]:
    """
    Apply all validation rules to a completed result DataFrame.
    Returns a list of ExceptionRecord, ordered error → warning → info.
    """
    exceptions: list[ExceptionRecord] = []

    # ── R1: Duplicate rows (same store × department × display_type) ────────────
    join_key = [c for c in ["store_name", "department", "display_type"] if c in result.columns]
    if join_key:
        dupes = result[result.duplicated(subset=join_key, keep=False)]
        if not dupes.empty:
            exceptions.append(ExceptionRecord(
                rule="duplicate_rows",
                severity="error",
                title="Duplicate store-department rows",
                message=(
                    f"{len(dupes)} rows share the same store/department/display_type key. "
                    "This means a join produced duplicate entries. Check source data for overlapping records."
                ),
                row_count=len(dupes),
                sample_rows=_sample(dupes, KEY_COLS),
            ))

    # ── R2: Negative stock position ────────────────────────────────────────────
    if "ttl_stk_q" in result.columns:
        neg_stk = result[result["ttl_stk_q"] < 0]
        if not neg_stk.empty:
            exceptions.append(ExceptionRecord(
                rule="negative_stock",
                severity="error",
                title="Negative stock position (TTL_STK_Q < 0)",
                message=(
                    f"{len(neg_stk)} rows have negative stock after applying transit/transfer adjustments. "
                    "Check TO_Q (transfer-out) vs available stock in Oracle."
                ),
                row_count=len(neg_stk),
                sample_rows=_sample(neg_stk, KEY_COLS),
            ))

    # ── R3: REQ exceeds capacity cap ──────────────────────────────────────────
    if "req" in result.columns and "bgt_cap" in result.columns:
        over_cap = result[(result["req"] > result["bgt_cap"]) & (result["bgt_cap"] > 0)]
        if not over_cap.empty:
            exceptions.append(ExceptionRecord(
                rule="req_exceeds_cap",
                severity="error",
                title="REQ exceeds capacity cap (BGT_CAP)",
                message=(
                    f"{len(over_cap)} rows have REQ > BGT_CAP. "
                    "This should not occur — the clip logic may have a floating-point edge case."
                ),
                row_count=len(over_cap),
                sample_rows=_sample(over_cap, KEY_COLS),
            ))

    # ── R4: Zero PBS with positive REQ ────────────────────────────────────────
    if "pbs" in result.columns and "req" in result.columns:
        zero_pbs_req = result[(result["pbs"] == 0) & (result["req"] > 0)]
        if not zero_pbs_req.empty:
            exceptions.append(ExceptionRecord(
                rule="zero_pbs_nonzero_req",
                severity="warning",
                title="REQ allocated with zero PBS",
                message=(
                    f"{len(zero_pbs_req)} rows have PBS=0 but non-zero REQ. "
                    "PBS data may be missing from V_PBS_MC for these store-department combinations."
                ),
                row_count=len(zero_pbs_req),
                sample_rows=_sample(zero_pbs_req, KEY_COLS),
            ))

    # ── R5: Missing store grade (grade multiplier defaulted to 1.0) ───────────
    if "store_grade" in result.columns:
        no_grade = result[result["store_grade"].isna() | (result["store_grade"] == "")]
        if not no_grade.empty:
            stores_no_grade = no_grade["store_name"].nunique() if "store_name" in no_grade.columns else "?"
            exceptions.append(ExceptionRecord(
                rule="missing_store_grade",
                severity="warning",
                title="Stores with no grade (PBS multiplier defaulted to 1.0)",
                message=(
                    f"{stores_no_grade} stores ({len(no_grade)} rows) have no grade in the store master. "
                    "The PBS multiplier was defaulted to 1.0. Update V_STORE_MASTER or assign grades."
                ),
                row_count=len(no_grade),
                sample_rows=_sample(no_grade.drop_duplicates("store_name") if "store_name" in no_grade.columns else no_grade, KEY_COLS),
            ))

    # ── R6: No sales history with positive REQ ────────────────────────────────
    if "daily_sales" in result.columns and "req" in result.columns:
        no_sales_req = result[(result["daily_sales"] == 0) & (result["req"] > 0)]
        if not no_sales_req.empty:
            exceptions.append(ExceptionRecord(
                rule="no_sales_with_req",
                severity="warning",
                title="Allocated to stores with zero L4W sales",
                message=(
                    f"{len(no_sales_req)} rows have zero last-4-week sales but positive REQ. "
                    "Allocation is driven entirely by PBS target (not sales velocity). "
                    "Consider excluding these or using a minimum-sales filter."
                ),
                row_count=len(no_sales_req),
                sample_rows=_sample(no_sales_req, KEY_COLS),
            ))

    # ── R7: Zero REQ with low stock cover ─────────────────────────────────────
    if "req" in result.columns and "stock_cover_days" in result.columns and "daily_sales" in result.columns:
        low_cover_zero_req = result[
            (result["req"] == 0) &
            (result["stock_cover_days"] < LOW_COVER_THRESHOLD) &
            (result["daily_sales"] > 0)
        ]
        if not low_cover_zero_req.empty:
            exceptions.append(ExceptionRecord(
                rule="low_cover_zero_req",
                severity="warning",
                title=f"Low stock cover (< {LOW_COVER_THRESHOLD}d) but zero REQ",
                message=(
                    f"{len(low_cover_zero_req)} rows have fewer than {LOW_COVER_THRESHOLD} days of stock cover "
                    "yet were allocated zero units. This may indicate the store is below minimum allocation "
                    "threshold or the PBS target is very low. Review factor set min_alloc_qty."
                ),
                row_count=len(low_cover_zero_req),
                sample_rows=_sample(low_cover_zero_req, KEY_COLS),
            ))

    # ── R8: High stock cover (potential overstock) ────────────────────────────
    if "stock_cover_days" in result.columns and "daily_sales" in result.columns:
        overstock = result[
            (result["stock_cover_days"] > HIGH_COVER_THRESHOLD) &
            (result["daily_sales"] > 0) &
            (result["stock_cover_days"] < 998)   # exclude sentinel 999 (zero-sales)
        ]
        if not overstock.empty:
            exceptions.append(ExceptionRecord(
                rule="high_stock_cover",
                severity="warning",
                title=f"Overstock — stock cover > {HIGH_COVER_THRESHOLD} days",
                message=(
                    f"{len(overstock)} rows have more than {HIGH_COVER_THRESHOLD} days of stock cover. "
                    "These stores are well above safety stock. Consider excluding from this allocation."
                ),
                row_count=len(overstock),
                sample_rows=_sample(overstock.sort_values("stock_cover_days", ascending=False), KEY_COLS),
            ))

    # ── R9: Zero PBS and zero REQ (dead rows — no data joined) ───────────────
    if "pbs" in result.columns and "req" in result.columns and "l4w_sl" in result.columns:
        dead = result[(result["pbs"] == 0) & (result["req"] == 0) & (result["l4w_sl"] == 0)]
        if not dead.empty:
            exceptions.append(ExceptionRecord(
                rule="dead_rows",
                severity="info",
                title="Rows with no PBS, no sales, no REQ",
                message=(
                    f"{len(dead)} rows have zero PBS, zero L4W sales, and zero REQ. "
                    "These are store-department combinations in the MDQ grid with no "
                    "matching data from PBS or sales views. They may be inactive listings."
                ),
                row_count=len(dead),
                sample_rows=_sample(dead, KEY_COLS),
            ))

    # ── R10: Capped rows (REQ limited by BGT_CAP) — informational ─────────────
    if "req_capped" in result.columns:
        capped = result[result["req_capped"] == 1]
        if not capped.empty:
            avg_shortfall = 0.0
            if "net_req" in result.columns:
                avg_shortfall = float((capped["net_req"] - capped["req"]).mean())
            exceptions.append(ExceptionRecord(
                rule="capped_by_capacity",
                severity="info",
                title="REQ capped by store capacity (BGT_CAP)",
                message=(
                    f"{len(capped)} rows were capped by BGT_CAP (store budget capacity). "
                    f"Average shortfall per row: {avg_shortfall:.1f} units. "
                    "The full demand could not be met within the store's capacity budget."
                ),
                row_count=len(capped),
                sample_rows=_sample(capped.sort_values("req", ascending=False) if "req" in capped.columns else capped, KEY_COLS),
            ))

    logger.info(
        "Validation: %d exceptions (%d error, %d warning, %d info)",
        len(exceptions),
        sum(1 for e in exceptions if e.severity == "error"),
        sum(1 for e in exceptions if e.severity == "warning"),
        sum(1 for e in exceptions if e.severity == "info"),
    )

    # Sort: errors first, then warnings, then info
    order = {"error": 0, "warning": 1, "info": 2}
    return sorted(exceptions, key=lambda e: order.get(e.severity, 9))
