"""
Master data routes — dropdown lists and data preview for the React UI.
All endpoints are read-only.
"""
import logging
import time
from typing import Optional

from fastapi import APIRouter, Query, HTTPException, Request

from app.models.response_models import APIResponse
from app.repositories.store_repository import StoreRepository
from app.repositories.item_repository import ItemRepository
from app.repositories.sales_repository import SalesRepository
from app.repositories.stock_repository import StockRepository
from app.repositories.target_repository import TargetRepository
from app.repositories.pbs_repository import PBSRepository
from app.repositories.requirement_repository import RequirementRepository
from app.core.config import settings

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/master", tags=["Master Data"])

_store_repo = StoreRepository()
_item_repo = ItemRepository()
_sales_repo = SalesRepository()
_stock_repo = StockRepository()
_target_repo = TargetRepository()
_pbs_repo = PBSRepository()
_req_repo = RequirementRepository()


def _require_oracle():
    if not settings.is_oracle_configured:
        raise HTTPException(status_code=503, detail="Oracle not configured")


# ── Store master ───────────────────────────────────────────────────────────────

@router.get("/stores", response_model=APIResponse)
async def list_stores(active_only: bool = True):
    """Return all stores with dimension attributes."""
    _require_oracle()
    try:
        t0 = time.perf_counter()
        df = _store_repo.get_all_stores(active_only=active_only)
        elapsed = round((time.perf_counter() - t0) * 1000, 1)
        return APIResponse.ok(data={
            "stores": df.to_dict(orient="records"),
            "count": len(df),
            "query_ms": elapsed,
        })
    except Exception as exc:
        logger.error("list_stores: %s", exc)
        return APIResponse.fail(message=str(exc))


@router.get("/store-grades", response_model=APIResponse)
async def store_grades():
    _require_oracle()
    try:
        return APIResponse.ok(data={"grades": _store_repo.get_store_grades()})
    except Exception as exc:
        return APIResponse.fail(message=str(exc))


@router.get("/zones", response_model=APIResponse)
async def zones():
    _require_oracle()
    try:
        return APIResponse.ok(data={"zones": _store_repo.get_zones()})
    except Exception as exc:
        return APIResponse.fail(message=str(exc))


# ── Item master / filter dropdowns ────────────────────────────────────────────

@router.get("/seasons", response_model=APIResponse)
async def seasons():
    """Return all unique season codes in ITEM_MASTER."""
    _require_oracle()
    try:
        return APIResponse.ok(data={"seasons": _item_repo.get_seasons()})
    except Exception as exc:
        return APIResponse.fail(message=str(exc))


@router.get("/attributes", response_model=APIResponse)
async def attributes():
    """Return all unique ATTRIBUTE1 values (e.g. PREWINTER, REGULAR, SUMMER)."""
    _require_oracle()
    try:
        return APIResponse.ok(data={"attributes": _item_repo.get_attributes()})
    except Exception as exc:
        return APIResponse.fail(message=str(exc))


@router.get("/divisions", response_model=APIResponse)
async def divisions(
    season: Optional[str] = Query(None),
    attribute1: Optional[str] = Query(None),
):
    _require_oracle()
    try:
        return APIResponse.ok(data={"divisions": _item_repo.get_divisions(season=season, attribute1=attribute1)})
    except Exception as exc:
        return APIResponse.fail(message=str(exc))


@router.get("/sections", response_model=APIResponse)
async def sections(
    season: Optional[str] = Query(None),
    attribute1: Optional[str] = Query(None),
    division: Optional[str] = Query(None),
):
    _require_oracle()
    try:
        return APIResponse.ok(data={"sections": _item_repo.get_sections(season=season, attribute1=attribute1, division=division)})
    except Exception as exc:
        return APIResponse.fail(message=str(exc))


@router.get("/departments", response_model=APIResponse)
async def departments(
    season: Optional[str] = Query(None),
    attribute1: Optional[str] = Query(None),
    division: Optional[str] = Query(None),
):
    _require_oracle()
    try:
        return APIResponse.ok(data={"departments": _item_repo.get_departments(season=season, attribute1=attribute1, division=division)})
    except Exception as exc:
        return APIResponse.fail(message=str(exc))


@router.get("/articles", response_model=APIResponse)
async def articles(
    season: Optional[str] = Query(None),
    attribute1: Optional[str] = Query(None),
    division: Optional[str] = Query(None),
):
    _require_oracle()
    try:
        return APIResponse.ok(data={"articles": _item_repo.get_article_names(season=season, attribute1=attribute1, division=division)})
    except Exception as exc:
        return APIResponse.fail(message=str(exc))


@router.get("/mrp-values", response_model=APIResponse)
async def mrp_values(
    season: Optional[str] = Query(None),
    attribute1: Optional[str] = Query(None),
    division: Optional[str] = Query(None),
):
    _require_oracle()
    try:
        return APIResponse.ok(data={"mrp_values": _item_repo.get_mrp_values(season=season, attribute1=attribute1, division=division)})
    except Exception as exc:
        return APIResponse.fail(message=str(exc))


# ── Data preview ───────────────────────────────────────────────────────────────

@router.get("/preview/sales", response_model=APIResponse)
async def preview_sales(
    department: Optional[str] = Query(None),
    store_name: Optional[str] = Query(None),
    limit: int = Query(200, ge=1, le=2000),
):
    """Preview last-4-week sales data. Returns up to {limit} rows."""
    _require_oracle()
    try:
        t0 = time.perf_counter()
        df = _sales_repo.get_mc_sales(department=department, store_name=store_name)
        elapsed = round((time.perf_counter() - t0) * 1000, 1)
        return APIResponse.ok(data={
            "rows": df.head(limit).to_dict(orient="records"),
            "total_rows": len(df),
            "query_ms": elapsed,
        })
    except Exception as exc:
        logger.error("preview_sales: %s", exc)
        return APIResponse.fail(message=str(exc))


@router.get("/preview/stock", response_model=APIResponse)
async def preview_stock(
    department: Optional[str] = Query(None),
    store_name: Optional[str] = Query(None),
    limit: int = Query(200, ge=1, le=2000),
):
    """Preview current stock data."""
    _require_oracle()
    try:
        t0 = time.perf_counter()
        df = _stock_repo.get_mc_stock(department=department, store_name=store_name)
        elapsed = round((time.perf_counter() - t0) * 1000, 1)
        return APIResponse.ok(data={
            "rows": df.head(limit).to_dict(orient="records"),
            "total_rows": len(df),
            "query_ms": elapsed,
        })
    except Exception as exc:
        logger.error("preview_stock: %s", exc)
        return APIResponse.fail(message=str(exc))


@router.get("/preview/oracle-requirement", response_model=APIResponse)
async def preview_oracle_requirement(
    division: Optional[str] = Query(None),
    department: Optional[str] = Query(None),
    limit: int = Query(200, ge=1, le=2000),
):
    """Preview Oracle-computed requirement (V_MC_REQ_APPS) for reconciliation."""
    _require_oracle()
    try:
        t0 = time.perf_counter()
        df = _req_repo.get_oracle_requirement(division=division, department=department)
        elapsed = round((time.perf_counter() - t0) * 1000, 1)
        return APIResponse.ok(data={
            "rows": df.head(limit).to_dict(orient="records"),
            "total_rows": len(df),
            "query_ms": elapsed,
        })
    except Exception as exc:
        logger.error("preview_oracle_req: %s", exc)
        return APIResponse.fail(message=str(exc))


# ── Parquet-backed master table endpoints ─────────────────────────────────────

_MASTER_TABLES: dict[str, dict] = {
    "sales": {
        "owner": "CK_A2166", "name": "V_MC_SALES",
        "label": "Sales (L4W)", "oracle_view": "V_MC_SALES / V_MC_SL_SUM",
        "stale_hours": 24,   # warn if older than 1 day
    },
    "stock": {
        "owner": "CK_A2166", "name": "V_MC_ALLOCATION",
        "label": "Current Stock", "oracle_view": "V_MC_ALLOCATION",
        "stale_hours": 24,
    },
    "mdq": {
        "owner": "CK_A2166", "name": "V_MDQ_STR",
        "label": "MDQ / Capacity", "oracle_view": "V_MDQ_STR",
        "stale_hours": 168,  # 7 days — MDQ rarely changes
    },
}


# KPI in-memory cache: key → (computed_at_ts, kpi_dict)
_KPI_CACHE: dict[str, tuple[float, dict]] = {}
_KPI_TTL = 3600  # recompute at most once per hour


def _age_label(age_s: float) -> str:
    if age_s < 3600:
        return f"{round(age_s/60)}min ago"
    if age_s < 86400:
        h = int(age_s // 3600); m = int((age_s % 3600) // 60)
        return f"{h}hr {m}min ago" if m else f"{h}hr ago"
    d = int(age_s // 86400); h = int((age_s % 86400) // 3600)
    return f"{d}d {h}hr ago" if h else f"{d}d ago"


@router.get("/table/{key}/status", response_model=APIResponse)
async def master_table_status(key: str):
    """Return Parquet file status (exists, age, rows, stale flag, access count)."""
    if key not in _MASTER_TABLES:
        raise HTTPException(status_code=404, detail="Unknown table key.")
    t = _MASTER_TABLES[key]
    from app.core.parquet_cache import has_output, get_meta, get_access_stats
    import time as _t

    exists = has_output(t["owner"], t["name"])
    base = {"key": key, "label": t["label"], "oracle_view": t["oracle_view"],
            "stale_hours": t["stale_hours"]}

    if not exists:
        return APIResponse.ok(data={**base, "exists": False})

    meta = get_meta(t["owner"], t["name"]) or {}
    age_s = round(_t.time() - meta.get("fetched_at_ts", _t.time()))
    stale = age_s > t["stale_hours"] * 3600

    # access stats fetched separately (can be slow) — skip here for fast response
    return APIResponse.ok(data={
        **base, "exists": True,
        "rows": meta.get("rows", 0),
        "size_bytes": meta.get("size_bytes", 0),
        "fetched_at": meta.get("fetched_at"),
        "age_seconds": age_s,
        "age_label": _age_label(age_s),
        "stale": stale,
        "access_count": 0,
        "last_accessed": None,
    })


@router.get("/table/{key}/kpi", response_model=APIResponse)
async def master_table_kpi(key: str):
    """Compute quick KPIs from the local Parquet file (no Oracle needed). Cached for 1hr."""
    if key not in _MASTER_TABLES:
        raise HTTPException(status_code=404, detail="Unknown table key.")
    t = _MASTER_TABLES[key]
    from app.core.parquet_cache import has_output, read_cache
    import pandas as pd, numpy as np

    if not has_output(t["owner"], t["name"]):
        return APIResponse.ok(data={"available": False})

    # Return cached KPI if fresh
    cached = _KPI_CACHE.get(key)
    if cached and (time.time() - cached[0]) < _KPI_TTL:
        return APIResponse.ok(data=cached[1])

    df = read_cache(t["owner"], t["name"])
    if df is None or df.empty:
        return APIResponse.ok(data={"available": False})

    kpis: dict = {"available": True}

    # Detect store column
    store_col = next((c for c in df.columns if c.upper() in ("STR_CODE", "STORE_CODE", "STORE_ID", "STR_ID")), None)
    if store_col:
        kpis["stores"] = int(df[store_col].nunique())

    # Detect article/SKU column
    sku_col = next((c for c in df.columns if c.upper() in ("ARTICLE_CODE", "ART_CODE", "ITEM_CODE", "SKU_CODE", "SKU", "ARTICLE")), None)
    if sku_col:
        kpis["articles"] = int(df[sku_col].nunique())

    # Detect date/week columns
    date_cols = [c for c in df.columns if pd.api.types.is_datetime64_any_dtype(df[c])]
    if not date_cols:  # try string columns with "week" or "date" in name
        date_cols = [c for c in df.columns if any(k in c.upper() for k in ("WEEK", "DATE")) and df[c].dtype == object]
        if date_cols:
            try:
                df[date_cols[0]] = pd.to_datetime(df[date_cols[0]], errors="coerce")
                date_cols = [c for c in date_cols if pd.api.types.is_datetime64_any_dtype(df[c])]
            except Exception:
                date_cols = []

    if date_cols:
        col = date_cols[0]
        mn = df[col].min()
        mx = df[col].max()
        if pd.notnull(mn) and pd.notnull(mx):
            kpis["date_from"] = mn.strftime("%d %b %Y")
            kpis["date_to"]   = mx.strftime("%d %b %Y")

    _KPI_CACHE[key] = (time.time(), kpis)
    return APIResponse.ok(data=kpis)


@router.get("/table/{key}/preview", response_model=APIResponse)
async def master_table_preview(
    key: str,
    limit: int = Query(200, ge=1, le=2000),
    force_refresh: bool = Query(False),
    request: Request = None,
):
    """
    Return Parquet-cached preview for a master table.
    If no Parquet file exists (or force_refresh=true), fetches full data from Oracle
    and writes the Parquet. Tracking every access for frequency analytics.
    """
    if key not in _MASTER_TABLES:
        raise HTTPException(status_code=404, detail="Unknown table key.")

    t = _MASTER_TABLES[key]
    owner, name = t["owner"], t["name"]
    user_email = getattr(getattr(request, "state", None), "user", {}).get("email") if request else None

    from app.core.parquet_cache import has_output, read_cache, write_cache, get_meta, track_access, get_access_stats
    import time as _t

    served_from = "parquet"
    needs_oracle = force_refresh or not has_output(owner, name)

    if needs_oracle:
        # Only require Oracle when we actually need to fetch fresh data
        _require_oracle()

    if needs_oracle:
        t0 = _t.perf_counter()
        if key == "sales":
            df = _sales_repo.get_mc_sales()
        elif key == "stock":
            df = _stock_repo.get_mc_stock()
        else:
            df = _pbs_repo.get_mdq_str()
        fetch_ms = round((_t.perf_counter() - t0) * 1000, 1)
        meta = write_cache(owner, name, df)
        meta["fetch_ms"] = fetch_ms
        served_from = "oracle"
        logger.info("Master table downloaded: %s (%d rows, %.0f ms)", key, len(df), fetch_ms)
    else:
        df = read_cache(owner, name)
        meta = get_meta(owner, name) or {}
        if df is None:
            return APIResponse.fail(message="Parquet read error — click Refresh to re-download.")

    # Track every access
    track_access(owner, name, user_email)

    age_s = round(_t.time() - meta.get("fetched_at_ts", _t.time()))
    stale = age_s > t["stale_hours"] * 3600
    preview_df = df.head(limit)

    # Convert numpy/pandas types to plain Python so FastAPI can JSON-serialize them
    import numpy as np
    import pandas as pd
    def _to_python(v):
        if v is None:
            return None
        if isinstance(v, float) and v != v:  # NaN
            return None
        if isinstance(v, (np.integer,)):
            return int(v)
        if isinstance(v, (np.floating,)):
            return float(v)
        if isinstance(v, (np.bool_,)):
            return bool(v)
        if isinstance(v, pd.Timestamp):
            return v.isoformat() if not pd.isnull(v) else None
        if isinstance(v, float) and pd.isna(v):
            return None
        return v

    try:
        records = []
        cols = list(preview_df.columns)
        for row in preview_df.itertuples(index=False, name=None):
            records.append({col: _to_python(val) for col, val in zip(cols, row)})
    except Exception as exc:
        logger.error("master_table_preview serialization error [%s]: %s", key, exc, exc_info=True)
        return APIResponse.fail(message=f"Data serialization error: {exc}")

    return APIResponse.ok(data={
        "key": key,
        "label": t["label"],
        "oracle_view": t["oracle_view"],
        "rows_in_file": meta.get("rows", len(df)),
        "rows_returned": len(records),
        "columns": list(df.columns),
        "records": records,
        "served_from": served_from,
        "fetched_at": meta.get("fetched_at"),
        "age_seconds": age_s,
        "age_label": _age_label(age_s),
        "stale": stale,
        "stale_hours": t["stale_hours"],
        "size_bytes": meta.get("size_bytes", 0),
        "access_count": get_access_stats(owner, name)["access_count"],
    })


@router.get("/preview/mdq", response_model=APIResponse)
async def preview_mdq(
    division: Optional[str] = Query(None),
    department: Optional[str] = Query(None),
    limit: int = Query(200, ge=1, le=2000),
):
    """Preview MDQ and store capacity data (V_MDQ_STR)."""
    _require_oracle()
    try:
        t0 = time.perf_counter()
        df = _pbs_repo.get_mdq_str(division=division, department=department)
        elapsed = round((time.perf_counter() - t0) * 1000, 1)
        return APIResponse.ok(data={
            "rows": df.head(limit).to_dict(orient="records"),
            "total_rows": len(df),
            "query_ms": elapsed,
        })
    except Exception as exc:
        logger.error("preview_mdq: %s", exc)
        return APIResponse.fail(message=str(exc))


# ── Custom master tables (user-added from DB Explorer) ────────────────────────

from pydantic import BaseModel as _BM

class _AddCustom(_BM):
    schema_owner: str
    object_name:  str
    label:        str


@router.get("/custom", response_model=APIResponse)
async def list_custom_tables(request: Request = None):
    """Return all custom master tables added by users."""
    from app.db.sqlite import get_sqlite
    with get_sqlite() as db:
        rows = db.execute(
            "SELECT id, schema_owner, object_name, label, added_by, added_at, description FROM custom_master_tables ORDER BY added_at DESC"
        ).fetchall()
    return APIResponse.ok(data={"tables": [dict(r) for r in rows]})


@router.post("/custom", response_model=APIResponse)
async def add_custom_table(body: _AddCustom, request: Request = None):
    """Add a view/table from DB Explorer to Master Data."""
    import uuid
    from datetime import datetime, timezone
    from app.db.sqlite import get_sqlite
    user_email = getattr(getattr(request, "state", None), "user", {}).get("email", "unknown") if request else "unknown"
    tid = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    try:
        with get_sqlite() as db:
            db.execute(
                "INSERT INTO custom_master_tables (id,schema_owner,object_name,label,added_by,added_at) VALUES (?,?,?,?,?,?)",
                (tid, body.schema_owner.upper(), body.object_name.upper(), body.label, user_email, now),
            )
        return APIResponse.ok(data={"id": tid}, message="Added to Master Data.")
    except Exception as exc:
        if "UNIQUE" in str(exc).upper():
            return APIResponse.fail(message="This table is already in Master Data.")
        return APIResponse.fail(message=str(exc))


class _DescBody(_BM):
    description: str = ""


@router.patch("/custom/{table_id}/description", response_model=APIResponse)
async def update_custom_description(table_id: str, body: _DescBody):
    """Save or clear the user-editable description for a custom master table."""
    from app.db.sqlite import get_sqlite
    desc = body.description.strip() or None
    with get_sqlite() as db:
        row = db.execute("SELECT id FROM custom_master_tables WHERE id=?", (table_id,)).fetchone()
        if not row:
            return APIResponse.fail(message="Table not found.")
        db.execute("UPDATE custom_master_tables SET description=? WHERE id=?", (desc, table_id))
    return APIResponse.ok(data={"description": desc}, message="Description saved.")


@router.delete("/custom/{table_id}", response_model=APIResponse)
async def remove_custom_table(table_id: str):
    """Remove a custom master table."""
    from app.db.sqlite import get_sqlite
    with get_sqlite() as db:
        db.execute("DELETE FROM custom_master_tables WHERE id=?", (table_id,))
    return APIResponse.ok(message="Removed.")


@router.get("/custom/{table_id}/status", response_model=APIResponse)
async def custom_table_status(table_id: str):
    """Return Parquet file status for a custom table."""
    from app.db.sqlite import get_sqlite
    from app.core.parquet_cache import has_output, get_meta, get_access_stats
    import time as _t

    with get_sqlite() as db:
        row = db.execute("SELECT * FROM custom_master_tables WHERE id=?", (table_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Not found.")

    owner, name, label = row["schema_owner"], row["object_name"], row["label"]
    exists = has_output(owner, name)
    base = {"id": table_id, "schema_owner": owner, "object_name": name, "label": label}

    if not exists:
        return APIResponse.ok(data={**base, "exists": False})

    meta = get_meta(owner, name) or {}
    stats = get_access_stats(owner, name)
    age_s = round(_t.time() - meta.get("fetched_at_ts", _t.time()))

    return APIResponse.ok(data={
        **base, "exists": True,
        "rows": meta.get("rows", 0),
        "size_bytes": meta.get("size_bytes", 0),
        "fetched_at": meta.get("fetched_at"),
        "age_seconds": age_s,
        "age_label": _age_label(age_s),
        "access_count": stats["access_count"],
    })


# ── Visualisation helpers (aggregate + pivot from Parquet) ────────────────────

_VIZ_FUNCS = {"SUM", "AVG", "COUNT", "MIN", "MAX"}


def _agg_col(col, func: str):
    import pandas as pd, numpy as np
    if func == "COUNT":
        return int(col.count())
    if func == "SUM":
        return float(col.sum()) if pd.api.types.is_numeric_dtype(col) else None
    if func == "AVG":
        return float(col.mean()) if pd.api.types.is_numeric_dtype(col) else None
    v = col.dropna().min() if func == "MIN" else col.dropna().max()
    if isinstance(v, (int, float)):
        return float(v)
    if hasattr(v, 'item'):  # numpy scalar
        return float(v)
    return str(v) if v is not None else None


def _pivot_df(df, row_cols: list, value_col: str, func: str, limit: int):
    import pandas as pd
    agg_map = {"SUM": "sum", "AVG": "mean", "COUNT": "count", "MIN": "min", "MAX": "max"}
    # single col kept as str for groupby; multi-col uses list
    group_key = row_cols[0] if len(row_cols) == 1 else row_cols
    grp = df.groupby(group_key, dropna=False)[value_col].agg(agg_map[func]).reset_index()
    if pd.api.types.is_numeric_dtype(grp[value_col]):
        grp = grp.sort_values(value_col, ascending=False)
    grp = grp.head(limit)
    def _py(v):
        if v is None or (isinstance(v, float) and v != v): return None
        if hasattr(v, 'item'): return v.item()
        return v
    rows = []
    for tup in grp.itertuples(index=False, name=None):
        row = {}
        for i, col in enumerate(row_cols):
            row[col] = _py(tup[i])
        row[value_col] = _py(tup[len(row_cols)])
        rows.append(row)
    return rows


@router.get("/table/{key}/columns", response_model=APIResponse)
async def master_table_columns(key: str):
    """Return column list from meta.json (no Parquet read)."""
    if key not in _MASTER_TABLES:
        raise HTTPException(status_code=404, detail="Unknown table key.")
    t = _MASTER_TABLES[key]
    from app.core.parquet_cache import get_meta
    meta = get_meta(t["owner"], t["name"])
    if meta is None:
        return APIResponse.fail(message="Table not downloaded yet.")
    return APIResponse.ok(data={"columns": meta.get("columns", [])})


@router.get("/table/{key}/aggregate", response_model=APIResponse)
async def master_table_aggregate(key: str, field: str = Query(...), func: str = Query("SUM")):
    if key not in _MASTER_TABLES:
        raise HTTPException(status_code=404, detail="Unknown table key.")
    func = func.upper()
    if func not in _VIZ_FUNCS:
        return APIResponse.fail(message=f"func must be one of {sorted(_VIZ_FUNCS)}")
    from app.core.parquet_cache import read_cache
    t = _MASTER_TABLES[key]
    df = read_cache(t["owner"], t["name"])
    if df is None:
        return APIResponse.fail(message="Table not downloaded.")
    if field not in df.columns:
        return APIResponse.fail(message=f"Column '{field}' not found.")
    return APIResponse.ok(data={"field": field, "func": func, "value": _agg_col(df[field], func), "total_rows": len(df)})


@router.get("/table/{key}/pivot", response_model=APIResponse)
async def master_table_pivot(
    key: str,
    row_col: str = Query(...), value_col: str = Query(...),
    func: str = Query("SUM"), limit: int = Query(200, ge=1, le=2000),
):
    # row_col may be comma-separated for multi-column groupby
    row_cols = [c.strip() for c in row_col.split(",") if c.strip()]
    if key not in _MASTER_TABLES:
        raise HTTPException(status_code=404, detail="Unknown table key.")
    func = func.upper()
    if func not in _VIZ_FUNCS:
        return APIResponse.fail(message=f"func must be one of {sorted(_VIZ_FUNCS)}")
    from app.core.parquet_cache import read_cache
    t = _MASTER_TABLES[key]
    df = read_cache(t["owner"], t["name"])
    if df is None:
        return APIResponse.fail(message="Table not downloaded.")
    for c in row_cols + [value_col]:
        if c not in df.columns:
            return APIResponse.fail(message=f"Column '{c}' not found.")
    rows = _pivot_df(df, row_cols, value_col, func, limit)
    return APIResponse.ok(data={"row_col": row_col, "row_cols": row_cols, "value_col": value_col, "func": func, "rows": rows, "total_groups": len(rows)})


@router.get("/custom/{table_id}/columns", response_model=APIResponse)
async def custom_table_columns(table_id: str):
    from app.db.sqlite import get_sqlite
    from app.core.parquet_cache import get_meta
    with get_sqlite() as db:
        row = db.execute("SELECT schema_owner, object_name FROM custom_master_tables WHERE id=?", (table_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Not found.")
    meta = get_meta(row["schema_owner"], row["object_name"])
    if meta is None:
        return APIResponse.fail(message="Table not downloaded yet.")
    return APIResponse.ok(data={"columns": meta.get("columns", [])})


@router.get("/custom/{table_id}/aggregate", response_model=APIResponse)
async def custom_table_aggregate(table_id: str, field: str = Query(...), func: str = Query("SUM")):
    func = func.upper()
    if func not in _VIZ_FUNCS:
        return APIResponse.fail(message=f"func must be one of {sorted(_VIZ_FUNCS)}")
    from app.db.sqlite import get_sqlite
    from app.core.parquet_cache import read_cache
    with get_sqlite() as db:
        row = db.execute("SELECT schema_owner, object_name FROM custom_master_tables WHERE id=?", (table_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Not found.")
    df = read_cache(row["schema_owner"], row["object_name"])
    if df is None:
        return APIResponse.fail(message="Table not downloaded.")
    if field not in df.columns:
        return APIResponse.fail(message=f"Column '{field}' not found.")
    return APIResponse.ok(data={"field": field, "func": func, "value": _agg_col(df[field], func), "total_rows": len(df)})


@router.get("/custom/{table_id}/pivot", response_model=APIResponse)
async def custom_table_pivot(
    table_id: str,
    row_col: str = Query(...), value_col: str = Query(...),
    func: str = Query("SUM"), limit: int = Query(200, ge=1, le=2000),
):
    row_cols = [c.strip() for c in row_col.split(",") if c.strip()]
    func = func.upper()
    if func not in _VIZ_FUNCS:
        return APIResponse.fail(message=f"func must be one of {sorted(_VIZ_FUNCS)}")
    from app.db.sqlite import get_sqlite
    from app.core.parquet_cache import read_cache
    with get_sqlite() as db:
        row = db.execute("SELECT schema_owner, object_name FROM custom_master_tables WHERE id=?", (table_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Not found.")
    df = read_cache(row["schema_owner"], row["object_name"])
    if df is None:
        return APIResponse.fail(message="Table not downloaded.")
    for c in row_cols + [value_col]:
        if c not in df.columns:
            return APIResponse.fail(message=f"Column '{c}' not found.")
    rows = _pivot_df(df, row_cols, value_col, func, limit)
    return APIResponse.ok(data={"row_col": row_col, "row_cols": row_cols, "value_col": value_col, "func": func, "rows": rows, "total_groups": len(rows)})


@router.get("/custom/{table_id}/preview", response_model=APIResponse)
async def custom_table_preview(
    table_id: str,
    limit: int = Query(200, ge=1, le=2000),
    force_refresh: bool = Query(False),
    request: Request = None,
):
    """Preview a custom master table — serves from Parquet or fetches from Oracle."""
    from app.db.sqlite import get_sqlite
    from app.core.parquet_cache import has_output, read_cache, write_cache, get_meta, track_access, get_access_stats
    import time as _t, numpy as np, pandas as pd

    with get_sqlite() as db:
        row = db.execute("SELECT * FROM custom_master_tables WHERE id=?", (table_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Not found.")

    owner, name, label = row["schema_owner"], row["object_name"], row["label"]
    user_email = getattr(getattr(request, "state", None), "user", {}).get("email") if request else None

    needs_oracle = force_refresh or not has_output(owner, name)
    if needs_oracle:
        _require_oracle()
        from app.db.connection import get_connection
        from app.repositories.base_repository import fetch_df
        t0 = _t.perf_counter()
        with get_connection() as conn:
            df = fetch_df(conn, f"SELECT * FROM {owner}.{name}", label=name)
        meta = write_cache(owner, name, df)
        meta["fetch_ms"] = round((_t.perf_counter() - t0) * 1000, 1)
        served_from = "oracle"
    else:
        df = read_cache(owner, name)
        meta = get_meta(owner, name) or {}
        if df is None:
            return APIResponse.fail(message="Parquet read error — click Refresh.")
        served_from = "parquet"

    track_access(owner, name, user_email)
    age_s = round(_t.time() - meta.get("fetched_at_ts", _t.time()))
    preview_df = df.head(limit)

    def _to_python(v):
        if v is None: return None
        if isinstance(v, float) and v != v: return None
        if isinstance(v, (np.integer,)): return int(v)
        if isinstance(v, (np.floating,)): return float(v)
        if isinstance(v, (np.bool_,)): return bool(v)
        if isinstance(v, pd.Timestamp): return v.isoformat() if not pd.isnull(v) else None
        return v

    cols = list(preview_df.columns)
    records = [{col: _to_python(val) for col, val in zip(cols, row_)} for row_ in preview_df.itertuples(index=False, name=None)]

    return APIResponse.ok(data={
        "id": table_id, "label": label,
        "schema_owner": owner, "object_name": name,
        "rows_in_file": meta.get("rows", len(df)),
        "rows_returned": len(records),
        "columns": cols, "records": records,
        "served_from": served_from,
        "fetched_at": meta.get("fetched_at"),
        "age_seconds": age_s,
        "age_label": _age_label(age_s),
        "size_bytes": meta.get("size_bytes", 0),
        "access_count": get_access_stats(owner, name)["access_count"],
    })
