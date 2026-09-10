"""
Warehouse Inventory — GET /api/warehouse-inventory
Reads from local parquet files (downloaded via Oracle Refresh) instead of live Oracle.
Stock: MISRETAIL__T_STK_REPORT_DC_STOCK.parquet
Item master: REPORT__V_ITEM_MASTER.parquet
"""
import logging
import math
import time
from pathlib import Path

import pandas as pd
from fastapi import APIRouter, Request

from app.models.response_models import APIResponse

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/warehouse-inventory", tags=["Warehouse Inventory"])

_DATA_DIR = Path(__file__).resolve().parents[3] / "data" / "output"
_STOCK_FILE = _DATA_DIR / "MISRETAIL__T_STK_REPORT_DC_STOCK.parquet"
_ITEM_FILE  = _DATA_DIR / "REPORT__V_ITEM_MASTER.parquet"

# In-memory cache of merged dataframe
_DF_CACHE: pd.DataFrame | None = None
_DF_CACHE_TS: float = 0.0
_CACHE_TTL = 3600  # 1 hour (parquet doesn't change often)

_ITEM_KEEP = ["icode", "mrp", "desc1", "color", "season", "cat1", "cat3", "cat4", "cat5", "sz_grp", "partyname"]


def _load_df(refresh: bool = False) -> pd.DataFrame:
    global _DF_CACHE, _DF_CACHE_TS

    age = time.time() - _DF_CACHE_TS
    if not refresh and _DF_CACHE is not None and age < _CACHE_TTL:
        return _DF_CACHE

    stock = pd.read_parquet(_STOCK_FILE)
    item  = pd.read_parquet(_ITEM_FILE, columns=_ITEM_KEEP)

    # Rename item master columns to avoid clash with stock cols
    item = item.rename(columns={"desc1": "item_desc", "color": "item_color"})

    # Merge on icode (both are already same type in parquet)
    stock["icode"] = stock["icode"].astype(str)
    item["icode"]  = item["icode"].astype(str)

    df = stock.merge(item, on="icode", how="left")

    _DF_CACHE = df
    _DF_CACHE_TS = time.time()
    return df


def _df_to_rows(df: pd.DataFrame) -> list[dict]:
    df = df.where(df.notna(), other=None)
    rows = []
    for rec in df.to_dict(orient="records"):
        clean = {}
        for k, v in rec.items():
            if v is None:
                clean[k] = None
            elif hasattr(v, "isoformat"):
                clean[k] = v.isoformat()
            elif isinstance(v, float) and math.isnan(v):
                clean[k] = None
            elif isinstance(v, (int, float)):
                clean[k] = v
            else:
                clean[k] = str(v)
        rows.append(clean)
    return rows


@router.get("", response_model=APIResponse)
async def get_warehouse_inventory(
    request: Request,
    warehouse: str = "",
    item_code: str = "",
    division: str = "",
    refresh: bool = False,
):
    """Return DC stock data from local parquet files."""
    try:
        t0 = time.time()
        df = _load_df(refresh=refresh)

        # Apply filters
        if warehouse:
            df = df[df["sitecode"].astype(str).str.upper() == warehouse.strip().upper()]
        if item_code:
            df = df[df["icode"].astype(str).str.upper().str.contains(item_code.strip().upper(), na=False)]
        if division:
            df = df[df["division"].astype(str).str.upper() == division.strip().upper()]

        rows = _df_to_rows(df)
        elapsed = round(time.time() - t0, 2)
        return APIResponse.ok(data={
            "columns": list(df.columns),
            "rows": rows,
            "total": len(rows),
            "from_cache": True,
            "query_s": elapsed,
        })
    except Exception as exc:
        logger.exception("warehouse_inventory fetch failed")
        return APIResponse.fail(message=f"Parquet read failed: {str(exc)[:300]}")


_PIVOT_DIMS = {
    "sitecode", "sitealias", "icode", "stockpoint", "division",
    "section", "department", "article_name", "attribute1", "cat2",
    "season", "cat1", "cat3", "cat4", "cat5", "sz_grp", "partyname",
    "item_color", "item_desc", "mrp",
}
_VALUE_COLS = {"stock_qty", "stock_v", "mrp"}


@router.get("/pivot", response_model=APIResponse)
async def get_pivot(
    request: Request,
    rows: str = "division",
    cols: str = "",
    values: str = "stock_qty:sum",   # comma-sep col:agg pairs, agg can be sum/count/avg/max/min/pct
    warehouse: str = "",
    item_code: str = "",
    division: str = "",
    refresh: bool = False,
):
    """Pivot with multi-value support. values='stock_qty:sum,stock_v:sum,stock_v:pct'"""
    _AGG_MAP = {"sum": "sum", "count": "count", "avg": "mean", "max": "max", "min": "min"}

    try:
        row_dims = [c.strip().lower() for c in rows.split(",") if c.strip().lower() in _PIVOT_DIMS]
        col_dims = [c.strip().lower() for c in cols.split(",") if c.strip().lower() in _PIVOT_DIMS] if cols.strip() else []

        # Parse multi-value specs: "stock_qty:sum,stock_v:pct"
        val_specs: list[tuple[str, str]] = []
        for part in values.split(","):
            part = part.strip()
            if ":" in part:
                vc, ag = part.split(":", 1)
            else:
                vc, ag = part, "sum"
            vc = vc.strip().lower(); ag = ag.strip().lower()
            if vc in _VALUE_COLS and (ag in _AGG_MAP or ag == "pct"):
                val_specs.append((vc, ag))
        if not val_specs:
            val_specs = [("stock_qty", "sum")]
        if not row_dims:
            return APIResponse.fail(message=f"Valid row dims: {sorted(_PIVOT_DIMS)}")

        df = _load_df(refresh=refresh)
        if warehouse:
            df = df[df["sitecode"].astype(str).str.upper() == warehouse.strip().upper()]
        if item_code:
            df = df[df["icode"].astype(str).str.upper().str.contains(item_code.strip().upper(), na=False)]
        if division:
            df = df[df["division"].astype(str).str.upper() == division.strip().upper()]

        for vc, _ in val_specs:
            df[vc] = pd.to_numeric(df[vc], errors="coerce")

        all_dims = row_dims + col_dims

        # Build aggregation dict for non-pct cols
        base_specs = [(vc, ag) for vc, ag in val_specs if ag != "pct"]
        agg_dict: dict[str, list] = {}
        for vc, ag in base_specs:
            agg_dict.setdefault(vc, [])
            if _AGG_MAP[ag] not in agg_dict[vc]:
                agg_dict[vc].append(_AGG_MAP[ag])

        if not agg_dict:
            # only pct specs — need sum as base
            base_vc = val_specs[0][0]
            agg_dict = {base_vc: ["sum"]}

        grouped = df.groupby(all_dims, dropna=False).agg(agg_dict).reset_index()
        # Flatten MultiIndex columns from agg
        if isinstance(grouped.columns, pd.MultiIndex):
            grouped.columns = [f"{c[0]}_{c[1]}" if c[1] else c[0] for c in grouped.columns]

        # Add pct columns
        for vc, ag in val_specs:
            if ag == "pct":
                src_col = f"{vc}_sum" if f"{vc}_sum" in grouped.columns else vc
                if src_col in grouped.columns:
                    total = grouped[src_col].sum()
                    pct_col = f"{vc}_pct%"
                    grouped[pct_col] = (grouped[src_col] / total * 100).round(2) if total else 0

        # Rename single-agg cols (remove suffix if only one agg for that col)
        rename_map = {}
        for vc, agg_list in agg_dict.items():
            if len(agg_list) == 1:
                old = f"{vc}_{agg_list[0]}"
                if old in grouped.columns:
                    rename_map[old] = f"{vc}_{agg_list[0]}"  # keep descriptive name
        # Keep descriptive names as-is

        grand_totals: dict[str, float] = {}
        num_cols = [c for c in grouped.columns if c not in all_dims]
        for nc in num_cols:
            try:
                grand_totals[nc] = float(grouped[nc].sum())
            except Exception:
                grand_totals[nc] = 0

        if col_dims:
            # For cross-tab with multi-values, pivot each numeric col
            val_cols_in_grouped = [c for c in grouped.columns if c not in all_dims]
            pivot_df = grouped.pivot_table(index=row_dims, columns=col_dims, values=val_cols_in_grouped, fill_value=0)
            if isinstance(pivot_df.columns, pd.MultiIndex):
                pivot_df.columns = [" | ".join(str(x) for x in col if x) for col in pivot_df.columns]
            else:
                pivot_df.columns = [str(c) for c in pivot_df.columns]
            pivot_df["__row_total__"] = pivot_df.select_dtypes("number").sum(axis=1)
            pivot_df = pivot_df.sort_values("__row_total__", ascending=False).drop(columns="__row_total__")
            pivot_df = pivot_df.reset_index()
            col_headers = list(pivot_df.columns)
            pivot_rows_out = _df_to_rows(pivot_df.head(500))
        else:
            # Sort by first numeric col desc
            sort_col = num_cols[0] if num_cols else None
            if sort_col:
                grouped = grouped.sort_values(sort_col, ascending=False)
            grouped = grouped.head(2000)
            col_headers = list(grouped.columns)
            pivot_rows_out = _df_to_rows(grouped)

        return APIResponse.ok(data={
            "columns": col_headers,
            "rows": pivot_rows_out,
            "total": len(pivot_rows_out),
            "grand_totals": grand_totals,
            "grand_total": list(grand_totals.values())[0] if grand_totals else 0,
            "row_dims": row_dims,
            "col_dims": col_dims,
            "val_specs": [{"col": vc, "agg": ag} for vc, ag in val_specs],
        })
    except Exception as exc:
        logger.exception("wh-pivot failed")
        return APIResponse.fail(message=f"Pivot failed: {str(exc)[:300]}")


@router.get("/summary", response_model=APIResponse)
async def get_warehouse_summary():
    """Quick summary from parquet."""
    try:
        df = _load_df()
        return APIResponse.ok(data={"total_rows": len(df)})
    except Exception as exc:
        logger.exception("warehouse summary failed")
        return APIResponse.fail(message=str(exc)[:200])
