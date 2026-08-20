"""
Production-quality Excel exporter — Phase 11.

Builds a multi-sheet .xlsx workbook from a completed calculation run.
All formatting is done with openpyxl; no third-party styling libs required.

Sheets (all optional):
  Cover       — run metadata and factor config snapshot
  Summary     — KPI metrics table
  Results     — full allocation grid (formatted, frozen header, REQ highlighted)
  Breakdown   — REQ aggregated by division and by department
  Exceptions  — validation exceptions with severity and sample rows
  Factor Config — grade multipliers, division exclusions, global params
"""
from __future__ import annotations

import io
from datetime import datetime, timezone
from typing import Optional

import pandas as pd
from openpyxl import Workbook
from openpyxl.styles import (
    Alignment, Border, Font, GradientFill, PatternFill, Side,
    numbers as xl_numbers,
)
from openpyxl.utils import get_column_letter

from app.engine.validator import ExceptionRecord
from app.models.calculation_models import RunRecord, RunSummary
from app.models.factor_models import FactorSet

# ── Palette ───────────────────────────────────────────────────────────────────

C_HEADER_FILL  = "1F3864"   # dark navy header
C_HEADER_FONT  = "FFFFFF"   # white
C_ROW_ALT      = "F2F5FA"   # light blue-gray alternate row
C_ROW_WHITE    = "FFFFFF"
C_REQ_POS      = "D6F4D5"   # light green — positive REQ
C_REQ_CAPPED   = "FFF3CD"   # amber — capped by capacity
C_ZERO_REQ     = "F8F8F8"   # near-white — zero REQ row
C_ACCENT_BLUE  = "2E75B6"   # section headings
C_ACCENT_GREEN = "375623"
C_ERROR_FILL   = "FCE4E4"
C_WARN_FILL    = "FFF8E1"
C_INFO_FILL    = "E8F4FD"

# ── Style helpers ─────────────────────────────────────────────────────────────

def _hdr_font(size=10, bold=True):
    return Font(name="Calibri", size=size, bold=bold, color=C_HEADER_FONT)

def _body_font(size=10, bold=False, color="000000"):
    return Font(name="Calibri", size=size, bold=bold, color=color)

def _hdr_fill():
    return PatternFill("solid", fgColor=C_HEADER_FILL)

def _alt_fill(i: int):
    return PatternFill("solid", fgColor=C_ROW_ALT if i % 2 == 1 else C_ROW_WHITE)

def _req_fill(req_val: float, capped: bool):
    if req_val > 0:
        return PatternFill("solid", fgColor=C_REQ_CAPPED if capped else C_REQ_POS)
    return PatternFill("solid", fgColor=C_ZERO_REQ)

def _thin_border():
    s = Side(style="thin", color="D9D9D9")
    return Border(left=s, right=s, top=s, bottom=s)

def _center():
    return Alignment(horizontal="center", vertical="center", wrap_text=False)

def _left():
    return Alignment(horizontal="left", vertical="center")

def _right():
    return Alignment(horizontal="right", vertical="center")

def _apply_header_row(ws, row_idx: int, values: list, col_widths: list[int]):
    """Write a styled header row and update col_widths tracking list."""
    for ci, val in enumerate(values, 1):
        cell = ws.cell(row=row_idx, column=ci, value=val)
        cell.font = _hdr_font()
        cell.fill = _hdr_fill()
        cell.alignment = _center()
        cell.border = _thin_border()
        col_widths[ci - 1] = max(col_widths[ci - 1], len(str(val)) + 4)

def _auto_widths(ws, col_widths: list[int]):
    for ci, w in enumerate(col_widths, 1):
        ws.column_dimensions[get_column_letter(ci)].width = min(max(w, 8), 50)

def _section_title(ws, row: int, text: str, n_cols: int):
    cell = ws.cell(row=row, column=1, value=text)
    cell.font = Font(name="Calibri", size=11, bold=True, color=C_ACCENT_BLUE)
    cell.fill = PatternFill("solid", fgColor="DEEAF1")
    cell.alignment = _left()
    if n_cols > 1:
        ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=n_cols)
    return row + 1


# ── Sheet: Cover ──────────────────────────────────────────────────────────────

def _sheet_cover(wb: Workbook, record: RunRecord, factor_set: Optional[FactorSet]):
    ws = wb.create_sheet("Cover")
    ws.sheet_properties.tabColor = "1F3864"

    ws.column_dimensions["A"].width = 26
    ws.column_dimensions["B"].width = 40

    title_font = Font(name="Calibri", size=16, bold=True, color=C_ACCENT_BLUE)
    ws["A1"] = "CityKart Replenishment — Allocation Report"
    ws["A1"].font = title_font
    ws.merge_cells("A1:B1")
    ws.row_dimensions[1].height = 28

    ws["A2"] = f"Generated: {datetime.now(timezone.utc).strftime('%d %b %Y %H:%M UTC')}"
    ws["A2"].font = _body_font(color="666666")
    ws.merge_cells("A2:B2")

    rows = [
        ("", ""),
        ("RUN DETAILS", ""),
        ("Run ID", record.run_id),
        ("Label", record.label or "—"),
        ("Status", record.status),
        ("Started", record.started_at or "—"),
        ("Completed", record.completed_at or "—"),
        ("Duration (s)", str(record.duration_s or "—")),
        ("Result rows", str(record.result_rows)),
        ("", ""),
    ]

    if record.request:
        req = record.request
        rows += [
            ("RUN PARAMETERS", ""),
            ("Factor Set", record.factor_set_name or "—"),
            ("Attribute1 (Campaign)", req.attribute1 or "All"),
            ("Division", req.division or "All"),
            ("Department", req.department or "All"),
            ("Include Transit", "Yes" if req.include_transit else "No"),
            ("Include Pack Pending", "Yes" if req.include_pack_pending else "No"),
            ("Include Transfer Out", "Yes" if req.include_transfer_out else "No"),
            ("", ""),
        ]

    if record.summary:
        s = record.summary
        rows += [
            ("SUMMARY KPIs", ""),
            ("Total REQ Qty", f"{s.total_req:,.0f}"),
            ("Total PBS", f"{s.total_pbs:,.0f}"),
            ("Fill Rate Achieved", f"{s.fill_rate_achieved * 100:.1f}%"),
            ("Stores", str(s.stores)),
            ("Departments", str(s.departments)),
            ("Total Rows", str(s.total_rows)),
            ("Zero REQ Rows", str(s.zero_req_rows)),
            ("Capped Rows", str(s.capped_rows)),
            ("", ""),
        ]

    if factor_set and factor_set.config:
        cfg = factor_set.config
        rows += [
            ("FACTOR SET CONFIG", ""),
            ("Factor Set Name", factor_set.name),
            ("Fill Rate Target", f"{cfg.fill_rate_target * 100:.0f}%"),
            ("Safety Days", str(cfg.safety_days)),
            ("Min Alloc Qty", str(cfg.min_alloc_qty)),
            ("Max Alloc Factor", str(cfg.max_alloc_factor)),
            ("Use Grade PBS", "Yes" if cfg.use_grade_pbs else "No"),
        ]

    for ri, (label, value) in enumerate(rows, 4):
        if label in ("RUN DETAILS", "RUN PARAMETERS", "SUMMARY KPIs", "FACTOR SET CONFIG"):
            _section_title(ws, ri, label, 2)
            continue
        cell_a = ws.cell(row=ri, column=1, value=label)
        cell_b = ws.cell(row=ri, column=2, value=value)
        if label:
            cell_a.font = _body_font(bold=True)
            cell_b.font = _body_font()
        ws.row_dimensions[ri].height = 16


# ── Sheet: Summary ────────────────────────────────────────────────────────────

def _sheet_summary(wb: Workbook, record: RunRecord, s: Optional[RunSummary]):
    ws = wb.create_sheet("Summary")
    ws.sheet_properties.tabColor = "375623"
    ws.column_dimensions["A"].width = 30
    ws.column_dimensions["B"].width = 20

    ws["A1"] = "KPI Summary"
    ws["A1"].font = Font(name="Calibri", size=13, bold=True, color=C_ACCENT_BLUE)
    ws.merge_cells("A1:B1")

    kpis = []
    if s:
        kpis = [
            ("Total REQ Qty", s.total_req, "#,##0"),
            ("Total PBS", s.total_pbs, "#,##0"),
            ("Fill Rate Achieved", s.fill_rate_achieved, "0.0%"),
            ("Stores Covered", s.stores, "#,##0"),
            ("Departments", s.departments, "#,##0"),
            ("Total Rows", s.total_rows, "#,##0"),
            ("Zero REQ Rows", s.zero_req_rows, "#,##0"),
            ("Capped Rows", s.capped_rows, "#,##0"),
        ]

    for ri, (lbl, val, fmt) in enumerate(kpis, 3):
        ca = ws.cell(row=ri, column=1, value=lbl)
        cb = ws.cell(row=ri, column=2, value=val)
        ca.font = _body_font(bold=True)
        cb.font = _body_font(bold=True, color=C_ACCENT_GREEN)
        cb.number_format = fmt
        cb.alignment = _right()
        ca.fill = _alt_fill(ri)
        cb.fill = _alt_fill(ri)
        ws.row_dimensions[ri].height = 18


# ── Sheet: Results ────────────────────────────────────────────────────────────

# Column metadata: (header_label, excel_number_format, alignment)
RESULT_COL_META: dict[str, tuple[str, str, str]] = {
    "store_name":       ("Store Name",       "@",          "left"),
    "store_grade":      ("Grade",            "@",          "center"),
    "zone":             ("Zone",             "@",          "center"),
    "division":         ("Division",         "@",          "left"),
    "department":       ("Department",       "@",          "left"),
    "attribute1":       ("Campaign",         "@",          "center"),
    "display_type":     ("Display Type",     "@",          "center"),
    "pbs_multiplier":   ("PBS Mult",         "0.000",      "right"),
    "pbs":              ("PBS",              "#,##0.00",   "right"),
    "fnl_pbs":          ("Final PBS",        "#,##0.00",   "right"),
    "mdq":              ("MDQ",              "#,##0",      "right"),
    "bgt_mc_str":       ("BGT Cap (Oracle)", "#,##0",      "right"),
    "bgt_cap":          ("Eff. Cap",         "#,##0",      "right"),
    "ttl_stk_q":        ("Stock",            "#,##0.0",    "right"),
    "l4w_sl":           ("L4W Sales",        "#,##0.0",    "right"),
    "daily_sales":      ("Daily Sales",      "#,##0.000",  "right"),
    "stock_cover_days": ("Cover Days",       "#,##0.0",    "right"),
    "fill_req":         ("Fill REQ",         "#,##0.00",   "right"),
    "net_req":          ("Net REQ",          "#,##0.00",   "right"),
    "req":              ("REQ QTY",          "#,##0",      "right"),
    "req_capped":       ("Capped?",          "0",          "center"),
}


def _sheet_results(wb: Workbook, df: pd.DataFrame, max_rows: int = 200_000):
    ws = wb.create_sheet("Results")
    ws.sheet_properties.tabColor = "FF0000"

    cols = [c for c in RESULT_COL_META if c in df.columns]
    headers = [RESULT_COL_META[c][0] for c in cols]
    col_widths = [len(h) + 4 for h in headers]

    _apply_header_row(ws, 1, headers, col_widths)
    ws.freeze_panes = "A2"

    df_out = df[cols].head(max_rows)
    req_idx   = cols.index("req") + 1 if "req" in cols else None
    capped_idx = cols.index("req_capped") + 1 if "req_capped" in cols else None

    for ri, row in enumerate(df_out.itertuples(index=False), 2):
        row_dict = dict(zip(cols, row))
        req_val  = float(row_dict.get("req", 0) or 0)
        is_capped = bool(row_dict.get("req_capped", 0))

        row_fill = _req_fill(req_val, is_capped) if req_idx else _alt_fill(ri)

        for ci, col in enumerate(cols, 1):
            raw = row_dict[col]
            val = None if (raw == "" or pd.isna(raw)) else raw

            cell = ws.cell(row=ri, column=ci, value=val)
            cell.border = _thin_border()

            meta = RESULT_COL_META[col]
            fmt, align = meta[1], meta[2]
            cell.number_format = fmt
            cell.alignment = _right() if align == "right" else (_center() if align == "center" else _left())
            cell.font = _body_font(bold=(col == "req" and req_val > 0))

            # REQ column row-level fill
            if req_idx:
                cell.fill = row_fill
            else:
                cell.fill = _alt_fill(ri)

            # track column width
            if val is not None:
                col_widths[ci - 1] = max(col_widths[ci - 1], min(len(str(val)), 20) + 2)

    _auto_widths(ws, col_widths)
    ws.auto_filter.ref = f"A1:{get_column_letter(len(cols))}1"

    if len(df) > max_rows:
        ws.cell(row=len(df_out) + 2, column=1,
                value=f"[Truncated — showing {max_rows:,} of {len(df):,} rows. Use Export button for full data.]")


# ── Sheet: Breakdown ──────────────────────────────────────────────────────────

def _sheet_breakdown(wb: Workbook, df: pd.DataFrame):
    ws = wb.create_sheet("Breakdown")
    ws.sheet_properties.tabColor = "7030A0"

    row = 1
    for dim, label in [("division", "By Division"), ("department", "By Department"), ("store_grade", "By Store Grade")]:
        if dim not in df.columns or "req" not in df.columns:
            continue

        row = _section_title(ws, row, label, 7)
        headers = ["Group", "Total REQ", "Stores", "Rows", "Zero REQ", "Capped", "% of Total"]
        col_widths = [len(h) + 4 for h in headers]
        _apply_header_row(ws, row, headers, col_widths)
        row += 1

        grp = (
            df.groupby(dim, dropna=False)
            .agg(
                total_req=("req", "sum"),
                stores=("store_name", "nunique") if "store_name" in df.columns else ("req", "count"),
                rows=("req", "count"),
                zero_req=("req", lambda s: (s == 0).sum()),
                capped=("req_capped", "sum") if "req_capped" in df.columns else ("req", "count"),
            )
            .reset_index()
            .sort_values("total_req", ascending=False)
        )
        total_req = float(grp["total_req"].sum()) or 1

        for ri_local, (_, g) in enumerate(grp.iterrows()):
            pct = g["total_req"] / total_req
            data = [
                g[dim], g["total_req"], g["stores"], g["rows"],
                g["zero_req"], g["capped"], pct,
            ]
            fmts = ["@", "#,##0", "#,##0", "#,##0", "#,##0", "#,##0", "0.0%"]
            aligns = ["left", "right", "right", "right", "right", "right", "right"]

            for ci, (val, fmt, aln) in enumerate(zip(data, fmts, aligns), 1):
                cell = ws.cell(row=row, column=ci, value=val)
                cell.number_format = fmt
                cell.alignment = _right() if aln == "right" else _left()
                cell.fill = _alt_fill(ri_local)
                cell.border = _thin_border()
                cell.font = _body_font(bold=(ci == 2))
                col_widths[ci - 1] = max(col_widths[ci - 1], min(len(str(val)), 24) + 2)
            row += 1

        _auto_widths(ws, col_widths)
        row += 2   # blank gap between sections


# ── Sheet: Exceptions ─────────────────────────────────────────────────────────

SEV_FILL = {"error": C_ERROR_FILL, "warning": C_WARN_FILL, "info": C_INFO_FILL}
SEV_FONT_COLOR = {"error": "C0392B", "warning": "7D6608", "info": "1A5276"}


def _sheet_exceptions(wb: Workbook, exceptions: list[ExceptionRecord]):
    ws = wb.create_sheet("Exceptions")
    ws.sheet_properties.tabColor = "FF0000"

    if not exceptions:
        ws["A1"] = "No exceptions — all validation checks passed."
        ws["A1"].font = Font(name="Calibri", size=11, bold=True, color="375623")
        return

    # Summary header
    headers = ["Severity", "Rule", "Title", "Row Count", "Message"]
    col_widths = [12, 25, 40, 12, 80]
    _apply_header_row(ws, 1, headers, col_widths)
    ws.freeze_panes = "A2"

    row = 2
    for exc in exceptions:
        fill_color = SEV_FILL.get(exc.severity, C_ROW_WHITE)
        font_color = SEV_FONT_COLOR.get(exc.severity, "000000")

        data = [exc.severity.upper(), exc.rule, exc.title, exc.row_count, exc.message]
        fmts = ["@", "@", "@", "#,##0", "@"]
        for ci, (val, fmt) in enumerate(zip(data, fmts), 1):
            cell = ws.cell(row=row, column=ci, value=val)
            cell.fill = PatternFill("solid", fgColor=fill_color)
            cell.font = Font(name="Calibri", size=10,
                             bold=(ci == 1), color=font_color if ci == 1 else "000000")
            cell.number_format = fmt
            cell.alignment = _left() if ci in (3, 5) else _center()
            cell.border = _thin_border()
        ws.row_dimensions[row].height = 40 if len(str(exc.message)) > 80 else 18
        ws.cell(row=row, column=5).alignment = Alignment(wrap_text=True, vertical="top")
        row += 1

        # Sample rows sub-table (first 10)
        if exc.sample_rows:
            sub_cols = list(exc.sample_rows[0].keys())
            sub_headers = sub_cols
            for ci, h in enumerate(sub_headers, 1):
                c = ws.cell(row=row, column=ci + 1, value=h)
                c.font = Font(name="Calibri", size=8, bold=True, color="666666")
                c.fill = PatternFill("solid", fgColor="F0F0F0")
            row += 1

            for sr in exc.sample_rows[:10]:
                for ci, col in enumerate(sub_cols, 1):
                    c = ws.cell(row=row, column=ci + 1, value=sr.get(col, ""))
                    c.font = Font(name="Calibri", size=8, color="444444")
                    c.fill = PatternFill("solid", fgColor="FAFAFA")
                row += 1
        row += 1   # blank gap

    _auto_widths(ws, col_widths)


# ── Sheet: Factor Config ──────────────────────────────────────────────────────

def _sheet_factor_config(wb: Workbook, factor_set: Optional[FactorSet]):
    ws = wb.create_sheet("Factor Config")
    ws.sheet_properties.tabColor = "FFC000"

    if not factor_set:
        ws["A1"] = "Factor set not available."
        return

    ws.column_dimensions["A"].width = 28
    ws.column_dimensions["B"].width = 20

    row = 1
    ws.cell(row=row, column=1, value=f"Factor Set: {factor_set.name}").font = Font(
        name="Calibri", size=13, bold=True, color=C_ACCENT_BLUE)
    ws.merge_cells(f"A{row}:B{row}")
    row += 1

    # Global config
    row = _section_title(ws, row, "Global Configuration", 2)
    if factor_set.config:
        cfg = factor_set.config
        params = [
            ("Fill Rate Target", f"{cfg.fill_rate_target * 100:.0f}%"),
            ("Safety Days",      str(cfg.safety_days)),
            ("Min Alloc Qty",    str(cfg.min_alloc_qty)),
            ("Max Alloc Factor", str(cfg.max_alloc_factor)),
            ("Use Grade PBS",    "Yes" if cfg.use_grade_pbs else "No"),
        ]
        for lbl, val in params:
            ws.cell(row=row, column=1, value=lbl).font = _body_font(bold=True)
            ws.cell(row=row, column=2, value=val).font = _body_font()
            row += 1

    row += 1
    # Grade factors
    row = _section_title(ws, row, "Grade PBS Multipliers", 3)
    ws.column_dimensions["C"].width = 26
    g_headers = ["Grade", "PBS Multiplier", "Safety Days Override"]
    col_widths = [12, 18, 22]
    _apply_header_row(ws, row, g_headers, col_widths)
    row += 1
    for i, gf in enumerate(sorted(factor_set.grade_factors, key=lambda g: g.grade)):
        ws.cell(row=row, column=1, value=gf.grade).fill = _alt_fill(i)
        c2 = ws.cell(row=row, column=2, value=gf.pbs_multiplier)
        c2.number_format = "0.000"
        c2.fill = _alt_fill(i)
        c2.alignment = _right()
        c2.font = _body_font(bold=True, color=C_ACCENT_GREEN)
        c3 = ws.cell(row=row, column=3, value=gf.safety_days_override or "—")
        c3.fill = _alt_fill(i)
        c3.alignment = _center()
        row += 1

    row += 1
    # Division exclusions
    excluded = [df for df in factor_set.division_factors if df.excluded]
    if excluded:
        row = _section_title(ws, row, "Excluded Divisions", 2)
        _apply_header_row(ws, row, ["Division", "Excluded"], [20, 12])
        row += 1
        for i, df in enumerate(excluded):
            ws.cell(row=row, column=1, value=df.division).fill = PatternFill("solid", fgColor=C_ERROR_FILL)
            ws.cell(row=row, column=2, value="YES").fill = PatternFill("solid", fgColor=C_ERROR_FILL)
            ws.cell(row=row, column=2).font = Font(name="Calibri", size=10, bold=True, color="C0392B")
            row += 1


# ── Master builder ────────────────────────────────────────────────────────────

def build_workbook(
    record: RunRecord,
    result_df: pd.DataFrame,
    exceptions: list[ExceptionRecord],
    factor_set: Optional[FactorSet] = None,
    include_cover: bool = True,
    include_summary: bool = True,
    include_results: bool = True,
    include_breakdown: bool = True,
    include_exceptions: bool = True,
    include_factor_config: bool = True,
) -> bytes:
    """
    Build and return the Excel workbook as bytes.
    Caller wraps in StreamingResponse.
    """
    wb = Workbook()
    # Remove default empty sheet
    wb.remove(wb.active)

    if include_cover:
        _sheet_cover(wb, record, factor_set)
    if include_summary:
        _sheet_summary(wb, record, record.summary)
    if include_results and result_df is not None and not result_df.empty:
        _sheet_results(wb, result_df)
    if include_breakdown and result_df is not None and not result_df.empty:
        _sheet_breakdown(wb, result_df)
    if include_exceptions:
        _sheet_exceptions(wb, exceptions)
    if include_factor_config:
        _sheet_factor_config(wb, factor_set)

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf.read()
