"""
Replenishment Calculation Engine — Phase 12.

Pipeline (13 steps):
  1.  Load factor set
  2–6. Parallel Oracle fetches (store master, MDQ/capacity, PBS, stock, sales)
       Each fetch runs in its own connection from the pool concurrently.
  7.  Filter to requested scope (attribute1 / division / department / season)
  8.  Join all sources onto MDQ grid
  9.  Apply grade PBS multiplier  → FNL_PBS
  10. Compute stock position       → TTL_STK_Q
  11. Compute sales metrics        → L4W_SL, DAILY_SALES
  12. Compute requirement          → REQ (clipped to [0, BGT_MC_STR])
  13. Run validation               → exceptions stored in exception_store
"""
import logging
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from typing import Callable

import numpy as np
import pandas as pd

from app.db.connection import get_connection
from app.engine import exception_store
from app.engine.validator import run_validation
from app.models.calculation_models import RunRecord, RunRequest, RunStatus, RunSummary, StepLog
from app.models.factor_models import FactorSet
from app.repositories.base_repository import fetch_df, load_sql
from app.repositories.factor_repository import FactorRepository

logger = logging.getLogger(__name__)

_factor_repo = FactorRepository()


# ── helpers ───────────────────────────────────────────────────────────────────

def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _step(record: RunRecord, step: int, name: str, status: str,
          rows: int | None = None, message: str | None = None,
          on_update: Callable[[RunRecord], None] | None = None) -> None:
    log = StepLog(step=step, name=name, status=status, rows=rows, message=message)
    record.steps.append(log)
    logger.info("[run=%s] step %d %s: %s rows=%s", record.run_id, step, name, status, rows)
    if on_update:
        on_update(record)


def _safe_div(num, den, fill: float = 0.0):
    den_arr = np.asarray(den, dtype=float)
    num_arr = np.asarray(num, dtype=float)
    with np.errstate(divide='ignore', invalid='ignore'):
        result = np.where(den_arr == 0, fill, num_arr / np.where(den_arr == 0, 1.0, den_arr))
    return result


# ── main pipeline ─────────────────────────────────────────────────────────────

def run_calculation(record: RunRecord, on_update: Callable[[RunRecord], None]) -> pd.DataFrame:
    """
    Execute the full replenishment calculation.
    Updates `record` in place at each step; calls `on_update` so the caller
    can persist the intermediate state for polling.

    Returns the result DataFrame (also stored via on_update at completion).
    """
    req: RunRequest = record.request  # type: ignore[assignment]
    t0 = time.perf_counter()
    record.status = RunStatus.RUNNING
    record.started_at = _now()
    on_update(record)

    # ── Step 1: Load factor set ───────────────────────────────────────────────
    fs: FactorSet | None = _factor_repo.get_set(req.factor_set_id)
    if not fs or not fs.config:
        raise ValueError(f"Factor set {req.factor_set_id!r} not found or has no config")
    config = fs.config

    grade_mult: dict[str, float] = {gf.grade: gf.pbs_multiplier for gf in fs.grade_factors}
    excluded_divs: set[str] = {df.division for df in fs.division_factors if df.excluded}
    _step(record, 1, "Load factor set", "ok",
          message=f"{fs.name} — safety_days={config.safety_days} fill_rate={config.fill_rate_target}",
          on_update=on_update)

    record.factor_set_name = fs.name

    # ── Steps 2–6: Parallel Oracle fetches ───────────────────────────────────
    # Each fetch task opens its own connection from the pool, so all 5 run
    # concurrently.  We collect results into a dict keyed by task name and
    # emit individual step logs once all futures are done.

    def _fetch_store():
        with get_connection() as c:
            df = fetch_df(c, load_sql("store_base.sql"), label="store_master")
            df = df[["store_name", "store_grade"]].drop_duplicates("store_name")
            return df

    def _fetch_mdq():
        with get_connection() as c:
            df = fetch_df(c, load_sql("mdq_base.sql"), label="mdq_str")
            for col in ["mdq", "mdq_str_actual", "max_cap", "bgt_mc_str",
                        "new_bgt_str", "ly_sl_q", "month_1", "month_2", "month_3", "safety_days"]:
                if col in df.columns:
                    df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)
            return df

    def _fetch_pbs():
        with get_connection() as c:
            df = fetch_df(c, load_sql("pbs_base.sql"), label="pbs_mc")
            for col in ["pbs", "new_bgt_str", "proj_1", "proj_2",
                        "proj_3", "proj_4", "proj_5", "proj_6"]:
                if col in df.columns:
                    df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)
            if "display_type_code" in df.columns:
                df = df.rename(columns={"display_type_code": "display_type"})
            return df

    def _fetch_stock():
        with get_connection() as c:
            df = fetch_df(c, load_sql("stock_base.sql"), label="stock_mc")
            for col in ["stk_q", "intr_q", "prd_q", "to_q", "adj_stk_q", "lm_sl_q", "mtd_sl_q"]:
                if col in df.columns:
                    df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)
            return df

    def _fetch_sales():
        with get_connection() as c:
            df = fetch_df(c, load_sql("sales_base.sql"), label="sales_mc")
            for col in ["wk1", "wk2", "wk3", "wk4", "wk5", "max_slq"]:
                if col in df.columns:
                    df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)
            return df

    _tasks = {
        "store": (2, "Fetch store master",         _fetch_store),
        "mdq":   (3, "Fetch MDQ / capacity grid",  _fetch_mdq),
        "pbs":   (4, "Fetch PBS targets",           _fetch_pbs),
        "stock": (5, "Fetch stock position",        _fetch_stock),
        "sales": (6, "Fetch last-4-week sales",     _fetch_sales),
    }

    _results: dict[str, pd.DataFrame] = {}
    _fetch_errors: list[str] = []

    t_fetch = time.perf_counter()
    with ThreadPoolExecutor(max_workers=5, thread_name_prefix="oracle_fetch") as pool:
        futures = {pool.submit(fn): key for key, (_, _, fn) in _tasks.items()}
        for fut in as_completed(futures):
            key = futures[fut]
            step_num, step_name, _ = _tasks[key]
            try:
                _results[key] = fut.result()
                _step(record, step_num, step_name, "ok",
                      rows=len(_results[key]), on_update=on_update)
            except Exception as exc:
                logger.error("[run=%s] parallel fetch %s failed: %s", record.run_id, key, exc)
                _fetch_errors.append(f"{step_name}: {exc}")
                _step(record, step_num, step_name, "error", message=str(exc), on_update=on_update)

    if _fetch_errors:
        raise RuntimeError(f"Oracle fetch failed: {'; '.join(_fetch_errors)}")

    logger.info("[run=%s] parallel fetch completed in %.2fs", record.run_id, time.perf_counter() - t_fetch)

    store_df = _results["store"]
    mdq_df   = _results["mdq"]
    pbs_df   = _results["pbs"]
    stk_df   = _results["stock"]
    sl_df    = _results["sales"]

    # ── Step 7: Filter to scope ───────────────────────────────────────────────
    grid = mdq_df.copy()
    before = len(grid)
    if req.attribute1:
        grid = grid[grid["attribute1"] == req.attribute1]
    if req.division:
        grid = grid[grid["division"] == req.division]
    if req.department:
        grid = grid[grid["department"] == req.department]
    after = len(grid)
    _step(record, 7, "Apply scope filter", "ok", rows=after,
          message=f"filtered {before} → {after} rows (attr={req.attribute1} div={req.division} dept={req.department})",
          on_update=on_update)

    if grid.empty:
        raise ValueError("No rows remain after filtering. Check attribute1 / division / department.")

    # ── Step 8: Join all sources ──────────────────────────────────────────────
    join_keys = ["store_name", "department", "display_type"]

    # PBS join
    pbs_cols = ["store_name", "department", "display_type", "pbs", "new_bgt_str"]
    pbs_cols = [c for c in pbs_cols if c in pbs_df.columns]
    grid = grid.merge(
        pbs_df[pbs_cols].drop_duplicates(join_keys),
        on=join_keys, how="left", suffixes=("", "_pbs")
    )

    # Stock join
    stk_cols = ["store_name", "department", "display_type",
                "stk_q", "intr_q", "prd_q", "to_q", "adj_stk_q", "lm_sl_q", "mtd_sl_q"]
    stk_cols = [c for c in stk_cols if c in stk_df.columns]
    grid = grid.merge(
        stk_df[stk_cols].drop_duplicates(join_keys),
        on=join_keys, how="left"
    )

    # Sales join
    sl_cols = ["store_name", "department", "display_type",
               "wk1", "wk2", "wk3", "wk4", "wk5", "max_slq"]
    sl_cols = [c for c in sl_cols if c in sl_df.columns]
    grid = grid.merge(
        sl_df[sl_cols].drop_duplicates(join_keys),
        on=join_keys, how="left"
    )

    # Store grade join
    grid = grid.merge(store_df, on="store_name", how="left")

    # Fill NaN from joins
    for c in ["pbs", "new_bgt_str", "stk_q", "intr_q", "prd_q", "to_q",
              "adj_stk_q", "wk1", "wk2", "wk3", "wk4", "wk5"]:
        if c in grid.columns:
            grid[c] = pd.to_numeric(grid[c], errors="coerce").fillna(0)

    _step(record, 8, "Join all data sources", "ok", rows=len(grid), on_update=on_update)

    # ── Step 9: Grade PBS multiplier → FNL_PBS ────────────────────────────────
    if config.use_grade_pbs and grade_mult:
        grid["pbs_multiplier"] = grid["store_grade"].map(grade_mult).fillna(1.0)
    else:
        grid["pbs_multiplier"] = 1.0

    pbs_src = grid["pbs"] if "pbs" in grid.columns else pd.Series(0.0, index=grid.index)
    grid["fnl_pbs"] = (pbs_src * grid["pbs_multiplier"]).round(2)
    _step(record, 9, "Apply grade PBS multiplier", "ok", on_update=on_update)

    # ── Step 10: Stock position → TTL_STK_Q ──────────────────────────────────
    base_stk = grid.get("stk_q", pd.Series(0.0, index=grid.index))
    intr = grid.get("intr_q", pd.Series(0.0, index=grid.index)) if req.include_transit else 0
    prd = grid.get("prd_q", pd.Series(0.0, index=grid.index)) if req.include_pack_pending else 0
    to = grid.get("to_q", pd.Series(0.0, index=grid.index)) if req.include_transfer_out else 0
    grid["ttl_stk_q"] = (base_stk + intr + prd - to).clip(lower=0)
    _step(record, 10, "Compute stock position (TTL_STK_Q)", "ok", on_update=on_update)

    # ── Step 11: Sales metrics ────────────────────────────────────────────────
    w1 = grid.get("wk1", 0); w2 = grid.get("wk2", 0)
    w3 = grid.get("wk3", 0); w4 = grid.get("wk4", 0)
    grid["l4w_sl"] = (w1 + w2 + w3 + w4)
    grid["daily_sales"] = (grid["l4w_sl"] / 28).round(4)
    grid["stock_cover_days"] = _safe_div(grid["ttl_stk_q"], grid["daily_sales"], fill=999.0).round(1)
    _step(record, 11, "Compute sales metrics (L4W, daily rate)", "ok", on_update=on_update)

    # ── Step 12: Requirement ──────────────────────────────────────────────────
    fill_req = (grid["fnl_pbs"] * config.fill_rate_target).round(2)
    net_req = (fill_req - grid["ttl_stk_q"]).round(2)

    # Capacity cap: use BGT_MC_STR from MDQ if available, else fnl_pbs * max_alloc_factor
    if "bgt_mc_str" in grid.columns and grid["bgt_mc_str"].sum() > 0:
        cap = grid["bgt_mc_str"]
    else:
        cap = (grid["fnl_pbs"] * config.max_alloc_factor)

    req_qty = net_req.clip(lower=0).clip(upper=cap)

    # Apply min allocation floor (only when req > 0)
    req_qty = np.where(req_qty > 0, req_qty.clip(lower=config.min_alloc_qty), 0)

    # Zero out excluded divisions
    if "division" in grid.columns and excluded_divs:
        req_qty = np.where(grid["division"].isin(excluded_divs), 0, req_qty)

    grid["fill_req"] = fill_req
    grid["net_req"] = net_req
    grid["bgt_cap"] = cap
    grid["req"] = np.round(req_qty).astype(float)
    grid["req_capped"] = (grid["req"] < net_req.clip(lower=0)).astype(int)

    _step(record, 12, "Compute requirement (REQ)", "ok", rows=len(grid), on_update=on_update)

    # ── Finalise result (before validation so validator sees final columns) ────
    result_cols = [
        "store_name", "store_grade", "zone", "division", "department",
        "attribute1", "display_type", "pbs_multiplier",
        "pbs", "fnl_pbs", "mdq", "bgt_mc_str", "bgt_cap",
        "ttl_stk_q", "l4w_sl", "daily_sales", "stock_cover_days",
        "fill_req", "net_req", "req", "req_capped",
    ]
    result_cols = [c for c in result_cols if c in grid.columns]
    result = grid[result_cols].copy().reset_index(drop=True)

    # ── Step 13: Validation ───────────────────────────────────────────────────
    try:
        exc_records = run_validation(result)
        exception_store.save_exceptions(record.run_id, exc_records)
        err_count = sum(1 for e in exc_records if e.severity == "error")
        warn_count = sum(1 for e in exc_records if e.severity == "warning")
        info_count = sum(1 for e in exc_records if e.severity == "info")
        _step(record, 13, "Run validation checks", "ok",
              message=f"{err_count} errors · {warn_count} warnings · {info_count} info",
              on_update=on_update)
    except Exception as ve:
        logger.warning("[run=%s] Validation step failed (non-fatal): %s", record.run_id, ve)
        _step(record, 13, "Run validation checks", "error", message=str(ve), on_update=on_update)

    # Summary
    summary = RunSummary(
        total_rows=len(result),
        stores=result["store_name"].nunique() if "store_name" in result.columns else 0,
        departments=result["department"].nunique() if "department" in result.columns else 0,
        total_req=float(result["req"].sum()),
        total_pbs=float(result["fnl_pbs"].sum()) if "fnl_pbs" in result.columns else 0,
        fill_rate_achieved=float(
            _safe_div(result["req"].sum(), result["fnl_pbs"].sum() * config.fill_rate_target, fill=0.0)
        ),
        zero_req_rows=int((result["req"] == 0).sum()),
        capped_rows=int(result["req_capped"].sum()) if "req_capped" in result.columns else 0,
    )

    elapsed = round(time.perf_counter() - t0, 2)
    record.status = RunStatus.COMPLETE
    record.completed_at = _now()
    record.duration_s = elapsed
    record.summary = summary
    record.result_rows = len(result)
    on_update(record)

    logger.info("[run=%s] COMPLETE in %.1fs — %d rows, total_req=%.0f",
                record.run_id, elapsed, len(result), summary.total_req)
    return result
