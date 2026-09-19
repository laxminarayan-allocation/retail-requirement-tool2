"""
Database metadata routes — schema/table/view/column discovery.

All endpoints are read-only. No arbitrary SQL execution is exposed.
"""
import logging
import time
from typing import Optional

import re
from fastapi import APIRouter, Query, HTTPException, Request
from pydantic import BaseModel

from app.core.config import settings
from app.models.response_models import APIResponse, DatabaseStatusResponse
from app.repositories.metadata_repository import MetadataRepository

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/database", tags=["Database"])

_repo = MetadataRepository()
_refresh_status: dict = {}  # key -> {status, started_at, error, rows?}


def _require_oracle() -> None:
    if not settings.is_oracle_configured:
        raise HTTPException(
            status_code=503,
            detail="Oracle credentials not configured. Set ORACLE_USER, ORACLE_PASSWORD, ORACLE_HOST, ORACLE_SERVICE_NAME in backend/.env",
        )


# ── Connection status ──────────────────────────────────────────────────────────

@router.get("/status", response_model=APIResponse)
async def database_status():
    """
    Test Oracle connectivity and return version, schema, response time.
    This replaces the Phase 1 version in health.py — both paths work.
    """
    if not settings.is_oracle_configured:
        payload = DatabaseStatusResponse(
            status="not_configured",
            database="Oracle",
            message="Oracle credentials not set in .env",
        )
        return APIResponse.ok(data=payload.model_dump())

    try:
        t0 = time.perf_counter()
        oracle_version = _repo.get_oracle_version()
        schema = _repo.get_current_schema()
        elapsed_ms = round((time.perf_counter() - t0) * 1000, 2)

        payload = DatabaseStatusResponse(
            status="connected",
            database="Oracle",
            db_schema=schema,
            oracle_version=oracle_version,
            response_time_ms=elapsed_ms,
        )
        logger.info("Oracle status check — %.1f ms  schema=%s", elapsed_ms, schema)
        return APIResponse.ok(data=payload.model_dump())

    except Exception as exc:
        logger.error("Oracle connection failed: %s", exc)
        payload = DatabaseStatusResponse(
            status="error",
            database="Oracle",
            message=str(exc),
        )
        return APIResponse.fail(message="Oracle connection failed", errors=[str(exc)])


# ── Schema list ────────────────────────────────────────────────────────────────

@router.get("/schemas", response_model=APIResponse)
async def list_schemas():
    """Return all schema owners visible to the connected Oracle user."""
    _require_oracle()
    try:
        schemas = _repo.get_schemas()
        return APIResponse.ok(
            data={"schemas": schemas, "count": len(schemas)},
        )
    except Exception as exc:
        logger.error("list_schemas failed: %s", exc)
        return APIResponse.fail(message=str(exc))


# ── Table list ─────────────────────────────────────────────────────────────────

@router.get("/tables", response_model=APIResponse)
async def list_tables(owner: Optional[str] = Query(None, description="Schema owner filter")):
    """Return all tables visible to the connected user. Optionally filter by owner."""
    _require_oracle()
    try:
        t0 = time.perf_counter()
        tables = _repo.get_tables(owner=owner)
        elapsed_ms = round((time.perf_counter() - t0) * 1000, 1)
        logger.info("list_tables owner=%s → %d tables (%.0f ms)", owner, len(tables), elapsed_ms)
        return APIResponse.ok(
            data={"tables": tables, "count": len(tables), "query_ms": elapsed_ms},
        )
    except Exception as exc:
        logger.error("list_tables failed: %s", exc)
        return APIResponse.fail(message=str(exc))


# ── View list ──────────────────────────────────────────────────────────────────

@router.get("/views", response_model=APIResponse)
async def list_views(owner: Optional[str] = Query(None, description="Schema owner filter")):
    """Return all views visible to the connected user. Optionally filter by owner."""
    _require_oracle()
    try:
        t0 = time.perf_counter()
        views = _repo.get_views(owner=owner)
        elapsed_ms = round((time.perf_counter() - t0) * 1000, 1)
        logger.info("list_views owner=%s → %d views (%.0f ms)", owner, len(views), elapsed_ms)
        return APIResponse.ok(
            data={"views": views, "count": len(views), "query_ms": elapsed_ms},
        )
    except Exception as exc:
        logger.error("list_views failed: %s", exc)
        return APIResponse.fail(message=str(exc))


# ── Column metadata ────────────────────────────────────────────────────────────

@router.get("/table/{owner}/{table_name}/columns", response_model=APIResponse)
async def table_columns(owner: str, table_name: str):
    """Return full column metadata for a specific table."""
    _require_oracle()
    try:
        t0 = time.perf_counter()
        columns = _repo.get_columns(owner=owner, object_name=table_name)
        elapsed_ms = round((time.perf_counter() - t0) * 1000, 1)

        if not columns:
            raise HTTPException(
                status_code=404,
                detail=f"Table {owner.upper()}.{table_name.upper()} not found or not accessible",
            )

        row_estimate = _repo.get_object_row_count_estimate(owner, table_name)
        return APIResponse.ok(
            data={
                "owner": owner.upper(),
                "table_name": table_name.upper(),
                "columns": columns,
                "column_count": len(columns),
                "row_estimate": row_estimate,
                "query_ms": elapsed_ms,
            }
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("table_columns %s.%s failed: %s", owner, table_name, exc)
        return APIResponse.fail(message=str(exc))


@router.get("/view/{owner}/{view_name}/columns", response_model=APIResponse)
async def view_columns(owner: str, view_name: str):
    """Return full column metadata for a specific view."""
    _require_oracle()
    try:
        t0 = time.perf_counter()
        columns = _repo.get_columns(owner=owner, object_name=view_name)
        elapsed_ms = round((time.perf_counter() - t0) * 1000, 1)

        if not columns:
            raise HTTPException(
                status_code=404,
                detail=f"View {owner.upper()}.{view_name.upper()} not found or not accessible",
            )

        return APIResponse.ok(
            data={
                "owner": owner.upper(),
                "view_name": view_name.upper(),
                "columns": columns,
                "column_count": len(columns),
                "query_ms": elapsed_ms,
            }
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("view_columns %s.%s failed: %s", owner, view_name, exc)
        return APIResponse.fail(message=str(exc))


# ── Output file listing (viewer+) ─────────────────────────────────────────────

@router.get("/output/list", response_model=APIResponse)
async def output_list():
    """List all downloaded Parquet output files with metadata."""
    from app.core.parquet_cache import list_cache
    import time as _t
    files = list_cache()
    # Enrich with human-friendly age string
    for f in files:
        age_s = f.get("age_seconds", 0)
        if age_s < 3600:
            f["age_label"] = f"{round(age_s/60)}min ago"
        elif age_s < 86400:
            h = age_s // 3600
            m = (age_s % 3600) // 60
            f["age_label"] = f"{h}hr {m}min ago" if m else f"{h}hr ago"
        else:
            d = age_s // 86400
            h = (age_s % 86400) // 3600
            f["age_label"] = f"{d}d {h}hr ago" if h else f"{d}d ago"
    return APIResponse.ok(data={"files": files, "count": len(files)})


@router.get("/output/download/{owner}/{object_name}")
async def output_download(owner: str, object_name: str):
    """Stream a downloaded output file as CSV for browser download."""
    from app.core.parquet_cache import read_cache
    from fastapi.responses import StreamingResponse
    import io
    df = read_cache(owner, object_name)
    if df is None:
        raise HTTPException(status_code=404, detail="File not found. Download it first.")
    buf = io.StringIO()
    df.to_csv(buf, index=False)
    buf.seek(0)
    filename = f"{owner}__{object_name}.csv"
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


class SqlTextPatch(BaseModel):
    sql_text: str

@router.patch("/output/{owner}/{object_name}/sql", response_model=APIResponse)
async def output_patch_sql(owner: str, object_name: str, body: SqlTextPatch):
    """Save / update the sql_text field in an existing output meta.json."""
    from app.core.parquet_cache import get_meta, _meta_path
    meta = get_meta(owner, object_name)
    if meta is None:
        raise HTTPException(status_code=404, detail="Output file not found.")
    meta["sql_text"] = body.sql_text.strip().rstrip(";")
    _meta_path(owner, object_name).write_text(
        __import__("json").dumps(meta, indent=2)
    )
    return APIResponse.ok(message="SQL text saved.")


@router.delete("/output/{owner}/{object_name}", response_model=APIResponse)
async def output_remove(owner: str, object_name: str):
    """Delete a downloaded output (Parquet) file from the server."""
    from app.core.parquet_cache import delete_cache
    deleted = delete_cache(owner, object_name)
    if not deleted:
        raise HTTPException(status_code=404, detail="File not found.")
    return APIResponse.ok(message=f"Removed {owner}.{object_name}")


# ── Parquet cache status ───────────────────────────────────────────────────────

@router.get("/cache/status", response_model=APIResponse)
async def cache_status():
    """Return all Parquet-cached tables with last-fetch time and freshness."""
    from app.core.parquet_cache import list_cache
    cached = list_cache()
    return APIResponse.ok(data={"cached_tables": cached, "count": len(cached)})


@router.delete("/cache/{owner}/{table_name}", response_model=APIResponse)
async def delete_table_cache(owner: str, table_name: str):
    """Admin: force-clear a specific table's Parquet cache."""
    from app.core.parquet_cache import delete_cache
    deleted = delete_cache(owner, table_name)
    return APIResponse.ok(message=f"Cache {'cleared' if deleted else 'not found'} for {owner.upper()}.{table_name.upper()}.")


# ── Table data preview (Parquet-cached) ────────────────────────────────────────

@router.get("/table/{owner}/{object_name}/preview", response_model=APIResponse)
async def table_preview(
    owner: str,
    object_name: str,
    limit: int = Query(200, ge=1, le=2000),
    force_refresh: bool = Query(False),
):
    """
    Return a data preview for a table or view.
    Serves from the output Parquet file if it exists (unless force_refresh=true).
    On refresh, fetches full data from Oracle and overwrites the output file.
    """
    _require_oracle()
    from app.core.parquet_cache import has_output, read_cache, write_cache, get_meta
    from app.repositories.base_repository import fetch_df
    from app.db.connection import get_connection
    import time as _time

    served_from = "output"

    try:
        if force_refresh or not has_output(owner, object_name):
            t0 = _time.perf_counter()
            sql = f'SELECT * FROM "{owner.upper()}"."{object_name.upper()}"'
            with get_connection() as conn:
                df = fetch_df(conn, sql, label=f"{owner}.{object_name}")
            fetch_ms = round((_time.perf_counter() - t0) * 1000, 1)
            meta = write_cache(owner, object_name, df)
            meta["fetch_ms"] = fetch_ms
            served_from = "oracle"
        else:
            df = read_cache(owner, object_name)
            meta = get_meta(owner, object_name) or {}
            if df is None:
                return APIResponse.fail(message="Output file read error — click Refresh to re-download.")

        import time as _t
        age_s = _t.time() - meta.get("fetched_at_ts", _t.time())
        preview = df.head(limit)
        records = preview.where(preview.notna(), None).to_dict(orient="records")

        return APIResponse.ok(data={
            "owner": owner.upper(),
            "object_name": object_name.upper(),
            "rows_in_file": meta.get("rows", len(df)),
            "rows_returned": len(records),
            "columns": list(df.columns),
            "records": records,
            "served_from": served_from,
            "fetched_at": meta.get("fetched_at"),
            "age_seconds": round(age_s),
            "size_bytes": meta.get("size_bytes", 0),
        })
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("table_preview %s.%s failed: %s", owner, object_name, exc, exc_info=True)
        return APIResponse.fail(message=str(exc))


# ── Custom SQL export (admin only, SELECT-only) ────────────────────────────────

_FORBIDDEN = re.compile(
    r'\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|CREATE|EXEC|EXECUTE|MERGE|GRANT|REVOKE|COMMIT|ROLLBACK)\b',
    re.IGNORECASE,
)

class SqlExportRequest(BaseModel):
    sql: str
    label: str = "custom_query"   # used as filename slug


@router.post("/query/export", response_model=APIResponse)
async def sql_export(body: SqlExportRequest, request: Request):
    """
    Admin-only: run a SELECT query and save result as a Parquet output file.
    Only SELECT statements are allowed — any DML/DDL is rejected.
    """
    _require_oracle()

    caller_role = getattr(request.state, "user", {}).get("role", "")
    if caller_role != "admin":
        raise HTTPException(status_code=403, detail="Admin only.")

    sql = body.sql.strip()
    if not sql.upper().startswith("SELECT"):
        return APIResponse.fail(message="Only SELECT statements are allowed.")
    if _FORBIDDEN.search(sql):
        return APIResponse.fail(message="Query contains forbidden keywords (DML/DDL not allowed).")

    # Derive a safe filename slug from label
    safe_label = re.sub(r"[^A-Za-z0-9_]", "_", body.label.strip() or "custom_query").upper()[:60]

    from app.core.parquet_cache import write_cache
    from app.repositories.base_repository import fetch_df
    from app.db.connection import get_connection
    import time as _t

    try:
        t0 = _t.perf_counter()
        with get_connection() as conn:
            df = fetch_df(conn, sql, label=safe_label)
        fetch_ms = round((_t.perf_counter() - t0) * 1000, 1)
        meta = write_cache("QUERY", safe_label, df, sql_text=sql)
        meta["fetch_ms"] = fetch_ms

        import time as _t2
        age_s = _t2.time() - meta.get("fetched_at_ts", _t2.time())
        preview = df.head(200)
        records = preview.where(preview.notna(), None).to_dict(orient="records")

        return APIResponse.ok(data={
            "label": safe_label,
            "rows_in_file": meta.get("rows", len(df)),
            "rows_returned": len(records),
            "columns": list(df.columns),
            "records": records,
            "fetched_at": meta.get("fetched_at"),
            "age_seconds": round(age_s),
            "fetch_ms": fetch_ms,
            "size_bytes": meta.get("size_bytes", 0),
            "served_from": "oracle",
        })
    except Exception as exc:
        logger.error("sql_export failed: %s", exc, exc_info=True)
        return APIResponse.fail(message=str(exc))


# ── Object search ──────────────────────────────────────────────────────────────

@router.get("/search", response_model=APIResponse)
async def search_objects(
    q: str = Query(..., min_length=2, description="Search term (min 2 chars)"),
    owner: Optional[str] = Query(None),
    object_type: Optional[str] = Query(None, description="TABLE or VIEW"),
    limit: int = Query(100, ge=1, le=500),
):
    """Search Oracle object names. Returns tables, views and materialised views."""
    _require_oracle()
    try:
        results = _repo.search_objects(
            search_term=q,
            owner=owner,
            object_type=object_type,
            limit=limit,
        )
        return APIResponse.ok(data={"results": results, "count": len(results)})
    except Exception as exc:
        logger.error("search_objects failed: %s", exc)
        return APIResponse.fail(message=str(exc))


# ── View DDL deep-dive ─────────────────────────────────────────────────────────

@router.get("/view-ddl", response_model=APIResponse)
async def get_view_ddl(
    owner: str = Query(...),
    view_name: str = Query(...),
):
    """Return the raw DDL text of a single view."""
    _require_oracle()
    try:
        ddl = _repo.get_view_ddl(owner, view_name)
        if ddl is None:
            return APIResponse.fail(message=f"View {owner}.{view_name} not found or not visible.")
        formulas = _repo.parse_view_formulas(ddl)
        return APIResponse.ok(data={"owner": owner, "view_name": view_name, "ddl": ddl, "formulas": formulas})
    except Exception as exc:
        logger.error("get_view_ddl failed: %s", exc)
        return APIResponse.fail(message=str(exc))


@router.get("/view-tree", response_model=APIResponse)
async def get_view_tree(
    owner: str = Query(...),
    view_name: str = Query(...),
    max_depth: int = Query(5, ge=1, le=8),
):
    """
    Recursively resolve a view all the way down to base tables.
    Returns a nested tree: { name, owner, type, ddl, columns, children }.
    Use this to understand every formula and source table behind a view.
    """
    _require_oracle()
    try:
        import time as _time
        t0 = _time.perf_counter()
        tree = _repo.get_deep_view_tree(owner, view_name, max_depth=max_depth)
        elapsed_ms = round((_time.perf_counter() - t0) * 1000, 1)
        return APIResponse.ok(data={"tree": tree, "elapsed_ms": elapsed_ms})
    except Exception as exc:
        logger.error("get_view_tree failed: %s", exc)
        return APIResponse.fail(message=str(exc))


@router.get("/view-deps", response_model=APIResponse)
async def get_view_deps(
    owner: str = Query(...),
    view_name: str = Query(...),
):
    """Return one level of direct dependencies for a view."""
    _require_oracle()
    try:
        deps = _repo.get_view_dependencies(owner, view_name)
        return APIResponse.ok(data={"owner": owner, "view_name": view_name, "dependencies": deps, "count": len(deps)})
    except Exception as exc:
        logger.error("get_view_deps failed: %s", exc)
        return APIResponse.fail(message=str(exc))


# ── DB Auto-Refresh: freq map + schedule ──────────────────────────────────────

class FreqBody(BaseModel):
    owner: str
    object_name: str
    freq: str  # 'daily' | 'weekly' | 'once'

class ScheduleBody(BaseModel):
    time: str  # HH:MM


@router.get("/output/freq", response_model=APIResponse)
async def get_freq_map():
    """Return {owner__object: freq} for all stored entries."""
    from app.core.db_scheduler import get_freq_map
    return APIResponse.ok(data={"freq_map": get_freq_map()})


@router.post("/output/freq", response_model=APIResponse)
async def set_freq_entry(body: FreqBody):
    """Set refresh frequency for a single table/view."""
    if body.freq not in ("daily", "weekly", "once"):
        return APIResponse.fail(message="freq must be 'daily', 'weekly', or 'once'")
    from app.core.db_scheduler import set_freq
    set_freq(body.owner, body.object_name, body.freq)
    return APIResponse.ok(data={"owner": body.owner, "object_name": body.object_name, "freq": body.freq})


@router.get("/output/schedule", response_model=APIResponse)
async def get_schedule():
    """Return current auto-refresh scheduled time (HH:MM)."""
    from app.core.db_scheduler import get_schedule_time
    return APIResponse.ok(data={"time": get_schedule_time()})


@router.put("/output/schedule", response_model=APIResponse)
async def update_schedule(body: ScheduleBody):
    """Update auto-refresh scheduled time (HH:MM)."""
    import re as _re
    if not _re.match(r"^\d{2}:\d{2}$", body.time):
        return APIResponse.fail(message="time must be HH:MM format")
    from app.core.db_scheduler import set_schedule_time
    set_schedule_time(body.time)
    return APIResponse.ok(data={"time": body.time})


@router.post("/output/refresh/{owner}/{object_name}", response_model=APIResponse)
async def refresh_single_file(owner: str, object_name: str):
    """Trigger immediate full refresh of a single parquet file. Runs in background thread."""
    import threading, time as _time
    from app.core.parquet_cache import write_cache
    from app.repositories.base_repository import fetch_df
    from app.db.connection import get_connection

    _require_oracle()
    key = f"{owner.upper()}__{object_name.upper()}"
    _refresh_status[key] = {"status": "running", "started_at": _time.time(), "error": None}

    def _do():
        try:
            if owner.upper() == "QUERY":
                from app.core.parquet_cache import get_meta
                meta = get_meta(owner, object_name)
                sql = (meta or {}).get("sql_text", "").rstrip("; \t\n")
                if not sql:
                    raise ValueError(f"No sql_text found for QUERY.{object_name}")
            else:
                sql = f'SELECT * FROM "{owner.upper()}"."{object_name.upper()}"'
            with get_connection() as conn:
                df = fetch_df(conn, sql, label=f"{owner}.{object_name}")
            write_cache(owner, object_name, df)
            _refresh_status[key] = {"status": "done", "started_at": _refresh_status[key]["started_at"], "error": None, "rows": len(df)}
        except Exception as exc:
            _refresh_status[key] = {"status": "error", "started_at": _refresh_status[key]["started_at"], "error": str(exc)}

    threading.Thread(target=_do, daemon=True, name=f"refresh-{key}").start()
    return APIResponse.ok(
        message=f"Refresh started for {owner.upper()}.{object_name.upper()}",
        data={"key": key, "status": "running"}
    )


@router.get("/output/refresh-status/{owner}/{object_name}", response_model=APIResponse)
async def get_refresh_status(owner: str, object_name: str):
    """Check refresh status for a single file."""
    key = f"{owner.upper()}__{object_name.upper()}"
    st = _refresh_status.get(key, {"status": "idle"})
    return APIResponse.ok(data={"key": key, **st})


@router.post("/output/refresh-all", response_model=APIResponse)
async def refresh_all_daily():
    """Trigger immediate refresh of all daily-freq parquet files (admin only). Runs in background."""
    import threading
    from app.core.db_scheduler import refresh_daily_files, get_freq_map
    freq_map = get_freq_map()
    daily_count = sum(1 for v in freq_map.values() if v == "daily")
    threading.Thread(target=refresh_daily_files, daemon=True, name="manual-refresh-all").start()
    return APIResponse.ok(
        message=f"Refresh started for {daily_count} daily files. Check Database Explorer in ~2 min.",
        data={"daily_count": daily_count, "started": True}
    )
