"""
results_journey.py — Results & number journey for the SS27 allocation pipeline.

Three endpoints:
  GET /pipeline/results/files          — list final output files
  GET /pipeline/results/rows           — paginated results table
  GET /pipeline/results/trace          — step-by-step calculation breakdown
"""
from __future__ import annotations

import math
import tempfile
from pathlib import Path
from typing import Any

import pandas as pd
from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse

router = APIRouter()

_OUT = Path(tempfile.gettempdir()) / "ss27_pipeline"

# ── helpers ──────────────────────────────────────────────────────────────────

def _load(name: str) -> pd.DataFrame | None:
    p = _OUT / name
    if not p.exists():
        return None
    try:
        return pd.read_csv(p, dtype=str, low_memory=False)
    except Exception:
        return None


def _norm(df: pd.DataFrame) -> pd.DataFrame:
    df.columns = df.columns.str.upper().str.strip()
    return df


def _val(df: pd.DataFrame, barcode: str, store: str, col: str) -> str | None:
    mask = (df.get("BARCODE", pd.Series(dtype=str)).astype(str).str.strip() == barcode) & \
           (df.get("STORE_NAME", pd.Series(dtype=str)).astype(str).str.strip() == store)
    rows = df[mask]
    if rows.empty or col not in rows.columns:
        return None
    v = rows.iloc[0][col]
    return None if pd.isna(v) else str(v).strip()


DISPLAY_COLS = [
    "BARCODE", "STORE_NAME", "GRC_Q", "ICODE", "ATTRIBUTE1", "DIVISION",
    "SECTION", "DEPARTMENT", "ARTICLE_NAME", "MC", "CLR", "MRP",
    "ALLOCATION_OPTION", "CAT6", "LIFECYCLE",
    "BLOCKED", "MANUAL_EXCLUDE", "PASS",
    "BAR_REQ", "MC_REQ", "ARTICLE_REQ", "MRP_REQ", "OPTION_REQ", "SPARKY_REQ",
    "ELIGIBLE_QTY",
]


# ── 1. File list ──────────────────────────────────────────────────────────────

@router.get("/pipeline/results/files")
def results_files() -> JSONResponse:
    if not _OUT.exists():
        return JSONResponse({"ok": True, "data": {"files": []}})
    files = []
    for p in sorted(_OUT.glob("final_*.csv"), reverse=True):
        try:
            rows = sum(1 for _ in open(p, encoding="utf-8", errors="ignore")) - 1
        except Exception:
            rows = 0
        files.append({"name": p.name, "rows": rows, "size_mb": round(p.stat().st_size / 1_048_576, 1)})
    # also xlsx
    for p in sorted(_OUT.glob("final_*.xlsx"), reverse=True):
        files.append({"name": p.name, "rows": "—", "size_mb": round(p.stat().st_size / 1_048_576, 1)})
    return JSONResponse({"ok": True, "data": {"files": files}})


# ── 2. Paginated rows ─────────────────────────────────────────────────────────

@router.get("/pipeline/results/rows")
def results_rows(
    file: str = Query("final_sorted.csv"),
    search: str = Query(""),
    limit: int = Query(100),
    offset: int = Query(0),
    sort_col: str = Query(""),
    sort_dir: str = Query("asc"),
) -> JSONResponse:
    df = _load(file)
    if df is None:
        return JSONResponse({"ok": False, "error": f"{file} not found — run the pipeline first"})
    df = _norm(df)

    if search.strip():
        q = search.strip().upper()
        mask = pd.Series(False, index=df.index)
        for col in ("BARCODE", "STORE_NAME", "ARTICLE_NAME", "MC", "DEPARTMENT", "ICODE", "ALLOCATION_OPTION"):
            if col in df.columns:
                mask |= df[col].astype(str).str.upper().str.contains(q, na=False, regex=False)
        df = df[mask]

    if sort_col and sort_col in df.columns:
        numeric_cols = {"GRC_Q", "MRP", "BAR_REQ", "MC_REQ", "ARTICLE_REQ", "MRP_REQ",
                        "OPTION_REQ", "SPARKY_REQ", "SZ_REQ", "TABLE_REQ", "ELIGIBLE_QTY"}
        if sort_col in numeric_cols:
            df = df.copy()
            df["_sort_key"] = pd.to_numeric(df[sort_col], errors="coerce")
            df = df.sort_values("_sort_key", ascending=(sort_dir == "asc"), na_position="last")
            df = df.drop(columns=["_sort_key"])
        else:
            df = df.sort_values(sort_col, ascending=(sort_dir == "asc"), na_position="last",
                                key=lambda s: s.astype(str).str.upper())

    total = len(df)
    page = df.iloc[offset: offset + limit]

    # only return columns that exist
    cols = [c for c in DISPLAY_COLS if c in page.columns]
    rows = page[cols].fillna("").to_dict(orient="records")

    return JSONResponse({"ok": True, "data": {"total": total, "rows": rows, "columns": cols}})


# ── 3. Trace — calculation breakdown ─────────────────────────────────────────

@router.get("/pipeline/results/trace")
def results_trace(
    barcode: str = Query(...),
    store: str = Query(...),
) -> JSONResponse:
    barcode = barcode.strip()
    store = store.strip()
    steps: list[dict[str, Any]] = []

    # ── Step 1: GRC source ────────────────────────────────────────────────────
    grc = _load("alloc_base_raw.csv")
    grc_q = None
    grc_source = "—"
    if grc is not None:
        grc = _norm(grc)
        b_col = next((c for c in ("BARCODE", "ICODE") if c in grc.columns), None)
        q_col = next((c for c in ("GRC_QTY", "GRC_Q", "QTY", "QUANTITY") if c in grc.columns), None)
        if b_col and q_col:
            rows = grc[grc[b_col].astype(str).str.strip() == barcode]
            if not rows.empty:
                grc_q = str(rows.iloc[0][q_col]).strip()
                table_col = next((c for c in ("TABLE_NAME", "SOURCE", "DB_TABLE") if c in rows.columns), None)
                grc_source = str(rows.iloc[0][table_col]).strip() if table_col else "GRC extract"
    steps.append({
        "step": 1,
        "title": "Source of GRC Extract",
        "subtitle": "BARCODE from GRC",
        "fields": [
            {"label": "Source table", "value": grc_source},
            {"label": "GRC_Q (warehouse stock)", "value": grc_q or "—"},
        ],
    })

    # ── Step 2: Grid enrichment ───────────────────────────────────────────────
    grid = _load("grid.csv")
    grid_fields: list[dict] = []
    if grid is not None:
        grid = _norm(grid)
        for col, label in [
            ("GRC_Q",             "GRC_Q"),
            ("ALLOCATION_OPTION", "ALLOCATION_OPTION"),
            ("OPTION_LEVEL",      "OPTION_LEVEL"),
            ("CAT6",              "CAT6"),
            ("LIFECYCLE",         "LIFECYCLE"),
            ("LIFE_CYCLE",        "LIFE_CYCLE"),
            ("MIN_QTY",           "MIN_QTY (article grid)"),
            ("MAX_QTY",           "MAX_QTY (article grid)"),
            ("DISPLAY_TYPE",      "DISPLAY_TYPE"),
            ("SECTION",           "SECTION"),
        ]:
            v = _val(grid, barcode, store, col)
            if v is not None:
                grid_fields.append({"label": label, "value": v})
    steps.append({
        "step": 2,
        "title": "Grid Row + Enrichments",
        "subtitle": f"BARCODE × STORE cross-join",
        "fields": grid_fields or [{"label": "Row", "value": f"{barcode} × {store}"}],
    })

    # ── Step 3: System filters ────────────────────────────────────────────────
    gf = _load("grid_filtered.csv")
    filter_fields: list[dict] = []
    pass_sys = None
    if gf is not None:
        gf = _norm(gf)
        for col, label in [
            ("CAT6_FILTER",    "CAT6 filter"),
            ("MC_FILTER",      "MC listing filter"),
            ("CLR_FILTER",     "CLR concept filter"),
            ("BLOCKED",        "BLOCKED (DLT / block list)"),
            ("PASS",           "PASS after system filters"),
        ]:
            v = _val(gf, barcode, store, col)
            if v is not None:
                filter_fields.append({"label": label, "value": v, "flag": True})
        # fallback — show any filter-like columns
        if not filter_fields:
            for col in gf.columns:
                if any(k in col for k in ("FILTER", "BLOCK", "PASS", "EXCLUDE")):
                    v = _val(gf, barcode, store, col)
                    if v is not None:
                        filter_fields.append({"label": col, "value": v, "flag": True})
        pass_sys = _val(gf, barcode, store, "PASS")
    steps.append({
        "step": 3,
        "title": "Filter Check (System)",
        "subtitle": "CAT6 / MC / CLR / Block filters → PASS",
        "fields": filter_fields,
        "pass": pass_sys,
    })

    # ── Step 4: Manual filters ────────────────────────────────────────────────
    gm = _load("grid_manual.csv")
    manual_fields: list[dict] = []
    pass_manual = None
    if gm is not None:
        gm = _norm(gm)
        for col, label in [
            ("MANUAL_EXCLUDE", "MANUAL_EXCLUDE"),
            ("PASS",           "PASS after manual filters"),
        ]:
            v = _val(gm, barcode, store, col)
            if v is not None:
                manual_fields.append({"label": label, "value": v, "flag": True})
        pass_manual = _val(gm, barcode, store, "PASS")
    steps.append({
        "step": 4,
        "title": "Manual Filters",
        "subtitle": "User-defined exclusion rules → MANUAL_EXCLUDE",
        "fields": manual_fields,
        "pass": pass_manual,
    })

    # ── Step 5: Requirements ──────────────────────────────────────────────────
    gr = _load("grid_req.csv")
    req_fields: list[dict] = []
    req_vals: dict[str, float] = {}
    if gr is not None:
        gr = _norm(gr)
        for col, label in [
            ("BAR_REQ",     "BAR_REQ (barcode-level)"),
            ("MC_REQ",      "MC_REQ (MC-level)"),
            ("ARTICLE_REQ", "ARTICLE_REQ (article-level)"),
            ("MRP_REQ",     "MRP_REQ (MRP-level)"),
            ("OPTION_REQ",  "OPTION_REQ (option-level)"),
            ("SPARKY_REQ",  "SPARKY_REQ (Sparky PBS)"),
            ("SZ_REQ",      "SZ_REQ (size-level)"),
        ]:
            v = _val(gr, barcode, store, col)
            if v is not None:
                req_fields.append({"label": label, "value": v})
                try:
                    fv = float(v)
                    req_vals[col] = fv
                except ValueError:
                    pass
    steps.append({
        "step": 5,
        "title": "Join Requirements",
        "subtitle": "BAR_REQ / MC_REQ / ARTICLE_REQ / MRP_REQ / OPTION_REQ / SPARKY_REQ",
        "fields": req_fields,
    })

    # ── Step 6: ELIGIBLE_QTY ─────────────────────────────────────────────────
    fe = _load("final_eligible.csv") or _load("final_sorted.csv")
    eligible_fields: list[dict] = []
    eligible_qty = None
    if fe is not None:
        fe = _norm(fe)
        eligible_qty = _val(fe, barcode, store, "ELIGIBLE_QTY")

    # reconstruct formula explanation
    non_zero = {k: v for k, v in req_vals.items() if v > 0}
    if non_zero:
        winner = min(non_zero, key=lambda k: non_zero[k])
        formula_parts = []
        for col, v in req_vals.items():
            note = "✓ constraint" if v > 0 else "0 = no constraint (ignored)"
            formula_parts.append({"label": col, "value": str(int(v)) if v == int(v) else str(v), "note": note})
        eligible_fields = formula_parts + [
            {"label": "Formula", "value": "min of non-zero requirements"},
            {"label": "Binding constraint", "value": f"{winner} = {int(non_zero[winner]) if non_zero[winner] == int(non_zero[winner]) else non_zero[winner]}"},
            {"label": "ELIGIBLE_QTY", "value": eligible_qty or str(int(min(non_zero.values()))) if non_zero else "—"},
        ]
    else:
        eligible_fields = [
            {"label": "All requirements = 0 (no constraint)", "value": "ELIGIBLE_QTY = 0"},
            {"label": "ELIGIBLE_QTY", "value": eligible_qty or "0"},
        ]

    steps.append({
        "step": 6,
        "title": "Eligible QTY Formula",
        "subtitle": "ELIGIBLE_QTY = min(non-zero requirements)",
        "fields": eligible_fields,
        "result": eligible_qty,
    })

    return JSONResponse({
        "ok": True,
        "data": {
            "barcode": barcode,
            "store": store,
            "steps": steps,
        }
    })
