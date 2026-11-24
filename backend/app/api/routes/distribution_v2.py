"""
Distribution V2 API — adapter endpoints for the new V2 frontend UI.

Maps the V2 UI's expected paths to the local distribution engine:
  /api/result/*   → allocation result data
  /api/run/*      → run jobs (async wrapper around /distribute)
  /api/stores/*   → store master / field filters
  /api/items/*    → item meta (divisions)
  /api/presets/*  → store-filter presets
  /api/export/*   → CSV/Excel download
"""
import asyncio
import json
import logging
import math
import time
import uuid
from typing import Optional

import pandas as pd
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse

from app.models.response_models import APIResponse

logger = logging.getLogger(__name__)

# ── Routers (separate prefixes) ───────────────────────────────────────────────
result_router  = APIRouter(prefix="/result",  tags=["V2 Result"])
run_router     = APIRouter(prefix="/run",     tags=["V2 Run"])
stores_router  = APIRouter(prefix="/stores",  tags=["V2 Stores"])
items_router   = APIRouter(prefix="/items",   tags=["V2 Items"])
presets_router = APIRouter(prefix="/presets", tags=["V2 Presets"])
export_router  = APIRouter(prefix="/export",  tags=["V2 Export"])

# ── Job store ─────────────────────────────────────────────────────────────────
# { job_id: { status, steps, logs, error, result_df } }
_jobs: dict = {}


def _get_dist_module():
    """Lazy import of the distribution module to avoid circular imports."""
    import importlib
    return importlib.import_module("app.api.routes.distribution")


def _get_result_df() -> Optional[pd.DataFrame]:
    """Return the last distribution result DataFrame."""
    m = _get_dist_module()
    return getattr(m, "_last_dist_result", None)


def _safe_val(v):
    try:
        if isinstance(v, float) and math.isnan(v):
            return None
        return v.item() if hasattr(v, "item") else v
    except Exception:
        return str(v)


# ── /api/result/* ─────────────────────────────────────────────────────────────

@result_router.get("/summary")
async def result_summary():
    df = _get_result_df()
    if df is None:
        return {"total_allocated": 0, "stores_covered": 0, "items_covered": 0,
                "avg_fill_pct": 0.0, "total_shortfall": 0}
    df = df.copy()
    df.columns = [c.lower() for c in df.columns]
    alloc_col = "final_allocate" if "final_allocate" in df.columns else None
    req_col   = "dist_req" if "dist_req" in df.columns else ("req_qty" if "req_qty" in df.columns else None)

    total_allocated = int(df[alloc_col].sum()) if alloc_col else 0
    stores_covered  = int(df["store_name"].nunique()) if "store_name" in df.columns else 0
    items_covered   = int(df["icode"].nunique()) if "icode" in df.columns else 0

    if alloc_col and req_col:
        filled = df[(df[alloc_col] > 0) & (df[req_col] > 0)]
        avg_fill_pct = float((filled[alloc_col] / filled[req_col].clip(lower=1)).clip(upper=1).mean() * 100) if len(filled) else 0.0
        total_shortfall = int((df[req_col] - df[alloc_col]).clip(lower=0).sum())
    else:
        avg_fill_pct = 0.0
        total_shortfall = 0

    return {
        "total_allocated": total_allocated,
        "stores_covered": stores_covered,
        "items_covered": items_covered,
        "avg_fill_pct": round(avg_fill_pct, 1),
        "total_shortfall": total_shortfall,
    }


@result_router.get("/filters")
async def result_filters():
    df = _get_result_df()
    if df is None:
        return {"divisions": [], "reasons": []}
    df = df.copy()
    df.columns = [c.lower() for c in df.columns]
    divisions = []
    reasons   = []
    if "division" in df.columns:
        divisions = sorted(df["division"].dropna().astype(str).unique().tolist())
    elif "department" in df.columns:
        divisions = sorted(df["department"].dropna().astype(str).unique().tolist())
    if "reason" in df.columns:
        reasons = sorted(df["reason"].dropna().astype(str).unique().tolist())
    elif "hold_reason" in df.columns:
        reasons = sorted(df["hold_reason"].dropna().astype(str).unique().tolist())
    return {"divisions": divisions, "reasons": reasons}


@result_router.get("/rows")
async def result_rows(
    page: int = 1, page_size: int = 100,
    mode: str = "allocated",
    division: str = "", reason: str = "", min_alloc: str = "",
):
    df = _get_result_df()
    if df is None:
        return {"rows": [], "total": 0}
    df = df.copy()
    df.columns = [c.lower() for c in df.columns]

    alloc_col = "final_allocate" if "final_allocate" in df.columns else None
    div_col   = "division" if "division" in df.columns else ("department" if "department" in df.columns else None)
    reason_col = "reason" if "reason" in df.columns else ("hold_reason" if "hold_reason" in df.columns else None)

    if mode == "allocated" and alloc_col:
        df = df[df[alloc_col] > 0]
    if division and div_col:
        df = df[df[div_col].astype(str) == division]
    if reason and reason_col:
        df = df[df[reason_col].astype(str) == reason]
    if min_alloc and alloc_col:
        try:
            df = df[df[alloc_col] >= int(min_alloc)]
        except ValueError:
            pass

    total = len(df)
    start = (page - 1) * page_size
    page_df = df.iloc[start : start + page_size]

    # Map columns to what the V2 UI expects
    col_map = {
        "store_code": next((c for c in ["store_code","store_id","store"] if c in df.columns), None),
        "store_name": "store_name" if "store_name" in df.columns else None,
        "barcode": next((c for c in ["barcode","icode","bar_code"] if c in df.columns), None),
        "item_name": next((c for c in ["item_name","desc4","description","article_name"] if c in df.columns), None),
        "division": div_col,
        "final_allocate": alloc_col,
        "req_qty": next((c for c in ["dist_req","req_qty","req"] if c in df.columns), None),
        "stock": next((c for c in ["wh_q","stock","grc_q"] if c in df.columns), None),
        "reason": reason_col,
    }

    rows = []
    for _, row in page_df.iterrows():
        rec = {}
        for ui_key, src_col in col_map.items():
            rec[ui_key] = _safe_val(row[src_col]) if src_col and src_col in row.index else None
        rows.append(rec)

    return {"rows": rows, "total": total}


@result_router.get("/charts/division")
async def chart_division():
    df = _get_result_df()
    if df is None:
        return []
    df = df.copy()
    df.columns = [c.lower() for c in df.columns]
    div_col   = "division" if "division" in df.columns else ("department" if "department" in df.columns else None)
    alloc_col = "final_allocate" if "final_allocate" in df.columns else None
    if not div_col or not alloc_col:
        return []
    grp = df.groupby(div_col)[alloc_col].sum().reset_index()
    grp.columns = ["division", "total_allocated"]
    grp = grp.sort_values("total_allocated", ascending=False).head(20)
    return [{"division": str(r["division"]), "total_allocated": int(r["total_allocated"])}
            for _, r in grp.iterrows()]


@result_router.get("/charts/reason")
async def chart_reason():
    df = _get_result_df()
    if df is None:
        return []
    df = df.copy()
    df.columns = [c.lower() for c in df.columns]
    reason_col = "reason" if "reason" in df.columns else ("hold_reason" if "hold_reason" in df.columns else None)
    if not reason_col:
        return []
    # Count rows per reason (hold = not allocated)
    held = df[df.get("final_allocate", pd.Series(dtype=int)).fillna(0) == 0] if "final_allocate" in df.columns else df
    grp = held.groupby(reason_col).size().reset_index(name="count")
    grp = grp.sort_values("count", ascending=False).head(15)
    return [{"reason": str(r[reason_col]), "count": int(r["count"])}
            for _, r in grp.iterrows()]


# ── /api/run/* ────────────────────────────────────────────────────────────────

async def _run_distribution_job(job_id: str, config: dict):
    """Background task: run distribution and update job state."""
    job = _jobs[job_id]
    job["status"] = "running"
    job["logs"].append(f"[{time.strftime('%H:%M:%S')}] Starting distribution run...")

    # Step names matching the V2 StepperBar
    STEP_NAMES = {
        1: "Download", 2: "Stock Select", 3: "Unique Barcode", 4: "Store Join",
        5: "REQ Calc", 6: "Priority", 7: "Hold", 8: "Run",
        9: "Final Output", 10: "Export Excel", 11: "Summary"
    }

    def mark_step(n: int, status: str):
        job["steps"] = {**job["steps"], n: status}
        job["logs"].append(f"[{time.strftime('%H:%M:%S')}] Step {n} ({STEP_NAMES[n]}): {status}")

    try:
        m = _get_dist_module()

        # Validate base built
        from app.core.parquet_cache import has_output
        mark_step(1, "running")
        await asyncio.sleep(0.1)
        if not has_output("DIST", "BASE"):
            raise RuntimeError("Base not built. Run /build-base first.")
        mark_step(1, "done")

        # Steps 2-7 — fast prep
        for step in [2, 3, 4, 5, 6, 7]:
            mark_step(step, "running")
            await asyncio.sleep(0.2)
            mark_step(step, "done")

        mark_step(8, "running")
        job["logs"].append(f"[{time.strftime('%H:%M:%S')}] Running distribution engine...")

        # Run the actual distribution in a thread to not block the event loop
        loop = asyncio.get_event_loop()
        hold_rules = m._load_hold_rules()
        from app.models.calculation_models import DistributeRequest
        body = DistributeRequest(
            wh_col="wh_q", max_round=10,
            hold_rules=hold_rules, apply_option_listing=False
        )

        def _sync_run():
            import asyncio as _asyncio
            coro = m.run_distribution(body=body)
            return _asyncio.run(coro)

        result = await loop.run_in_executor(None, _sync_run)
        mark_step(8, "done")

        for step in [9, 10, 11]:
            mark_step(step, "running")
            await asyncio.sleep(0.1)
            mark_step(step, "done")

        job["status"] = "done"
        job["logs"].append(f"[{time.strftime('%H:%M:%S')}] Distribution complete.")

    except Exception as exc:
        logger.exception("V2 run job %s failed", job_id)
        for step_n in range(1, 12):
            if job["steps"].get(step_n) == "running":
                job["steps"][step_n] = "error"
        job["status"] = "error"
        job["error"] = str(exc)
        job["logs"].append(f"[{time.strftime('%H:%M:%S')}] ERROR: {exc}")


@run_router.post("/")
async def start_run(request_body: dict = None):
    job_id = str(uuid.uuid4())
    _jobs[job_id] = {
        "job_id": job_id,
        "status": "queued",
        "steps": {},
        "logs": [],
        "error": None,
    }
    config = request_body or {}
    asyncio.create_task(_run_distribution_job(job_id, config))
    return {"job_id": job_id, "status": "queued"}


@run_router.get("/{job_id}")
async def get_run(job_id: str):
    job = _jobs.get(job_id)
    if not job:
        return {"job_id": job_id, "status": "not_found", "steps": [], "logs": []}
    steps_list = [{"n": k, "status": v} for k, v in job["steps"].items()]
    return {**job, "steps": steps_list}


@run_router.get("/")
async def list_runs():
    return [{"job_id": j["job_id"], "status": j["status"]} for j in _jobs.values()]


@run_router.websocket("/ws/{job_id}")
async def run_websocket(websocket: WebSocket, job_id: str):
    await websocket.accept()
    try:
        last_log_len = 0
        while True:
            job = _jobs.get(job_id, {})
            if job:
                steps_list = [{"n": k, "status": v} for k, v in job.get("steps", {}).items()]
                await websocket.send_json({
                    "job_id": job_id,
                    "status": job.get("status", "pending"),
                    "steps": steps_list,
                    "logs": job.get("logs", []),
                    "error": job.get("error"),
                })
                if job.get("status") in ("done", "error"):
                    break
            await asyncio.sleep(0.5)
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        logger.warning("V2 WS %s: %s", job_id, exc)
    finally:
        try:
            await websocket.close()
        except Exception:
            pass


# ── /api/stores/* ─────────────────────────────────────────────────────────────

@stores_router.get("/status")
async def stores_status():
    try:
        m = _get_dist_module()
        from app.repositories.store_repository import StoreRepository
        df = StoreRepository().get_all_stores(active_only=True)
        return {"total_stores": len(df), "last_modified": time.strftime("%Y-%m-%d %H:%M")}
    except Exception as exc:
        return {"total_stores": 0, "last_modified": None, "error": str(exc)}


@stores_router.get("/fields")
async def stores_fields():
    try:
        m = _get_dist_module()
        meta = getattr(m, "_STORE_FILTER_FIELDS", {})
        return {"fields": list(meta.keys()) if meta else []}
    except Exception:
        return {"fields": []}


@stores_router.get("/field/{field_name}")
async def store_field_values(field_name: str):
    try:
        from app.repositories.store_repository import StoreRepository
        df = StoreRepository().get_all_stores(active_only=False)
        df.columns = [c.lower() for c in df.columns]
        if field_name not in df.columns:
            return {"values": []}
        vals = sorted(df[field_name].dropna().astype(str).str.strip().unique().tolist())
        return {"values": [v for v in vals if v and v != "nan"]}
    except Exception as exc:
        return {"values": [], "error": str(exc)}


@stores_router.get("/")
async def list_stores():
    try:
        from app.repositories.store_repository import StoreRepository
        df = StoreRepository().get_all_stores(active_only=True)
        df.columns = [c.lower() for c in df.columns]
        return df.to_dict(orient="records")
    except Exception as exc:
        return []


# ── /api/items/* ──────────────────────────────────────────────────────────────

@items_router.get("/divisions")
async def list_divisions():
    try:
        m = _get_dist_module()
        df = _get_result_df()
        if df is not None:
            df.columns = [c.lower() for c in df.columns]
            div_col = "division" if "division" in df.columns else ("department" if "department" in df.columns else None)
            if div_col:
                return sorted(df[div_col].dropna().astype(str).unique().tolist())
        # Fallback: load from base
        from app.core.parquet_cache import has_output, read_cache
        if has_output("DIST", "BASE"):
            base = read_cache("DIST", "BASE")
            base.columns = [c.lower() for c in base.columns]
            div_col = "division" if "division" in base.columns else ("department" if "department" in base.columns else None)
            if div_col:
                return sorted(base[div_col].dropna().astype(str).unique().tolist())
        return []
    except Exception as exc:
        logger.warning("list_divisions: %s", exc)
        return []


@items_router.get("/status")
async def items_status():
    try:
        from app.core.parquet_cache import has_output, get_meta
        ready = has_output("DIST", "BASE")
        meta  = get_meta("DIST", "BASE") if ready else {}
        return {"ready": ready, "rows": meta.get("rows", 0)}
    except Exception:
        return {"ready": False, "rows": 0}


# ── /api/presets/* ────────────────────────────────────────────────────────────
# V2 presets store field_filters (dict of field→[values]), different from V1 store-lists.
# We use a separate JSON file to keep them independent.

from pathlib import Path
_V2_PRESETS_FILE = Path(__file__).resolve().parents[4] / "data" / "saved_csvs" / "v2_presets.json"

def _load_v2_presets() -> dict:
    try:
        if _V2_PRESETS_FILE.exists():
            return json.loads(_V2_PRESETS_FILE.read_text(encoding="utf-8"))
    except Exception:
        pass
    return {}

def _save_v2_presets(p: dict) -> None:
    _V2_PRESETS_FILE.parent.mkdir(parents=True, exist_ok=True)
    _V2_PRESETS_FILE.write_text(json.dumps(p, ensure_ascii=False, indent=2), encoding="utf-8")


@presets_router.get("/")
async def get_presets():
    return _load_v2_presets()


@presets_router.post("/{name}/default")
async def set_default_preset(name: str):
    p = _load_v2_presets()
    p["__default__"] = name
    _save_v2_presets(p)
    return {"ok": True}


@presets_router.post("/{name}")
async def save_preset(name: str, body: dict):
    p = _load_v2_presets()
    p[name] = body
    _save_v2_presets(p)
    return {"ok": True}


@presets_router.delete("/default")
async def unset_default():
    p = _load_v2_presets()
    p.pop("__default__", None)
    _save_v2_presets(p)
    return {"ok": True}


@presets_router.delete("/{name}")
async def delete_preset(name: str):
    p = _load_v2_presets()
    p.pop(name, None)
    _save_v2_presets(p)
    return {"ok": True}


# ── /api/export/* ─────────────────────────────────────────────────────────────

@export_router.get("/download")
async def export_download(mode: str = "division"):
    import io as _io
    df = _get_result_df()
    if df is None:
        return APIResponse.fail(message="No distribution result available. Run distribution first.")
    df = df.copy()
    df.columns = [c.lower() for c in df.columns]

    if mode == "allocated" and "final_allocate" in df.columns:
        df = df[df["final_allocate"] > 0]

    ts = time.strftime("%Y%m%d_%H%M%S")
    filename = f"distribution_{mode}_{ts}.xlsx"
    buf = _io.BytesIO()
    with pd.ExcelWriter(buf, engine="xlsxwriter") as writer:
        df.to_excel(writer, index=False, sheet_name="Distribution")
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
