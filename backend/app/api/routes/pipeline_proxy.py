"""
Proxy router — forwards Allocation Pipeline requests to the 8642 backend.
All routes are planner+ (enforced by main.py ROUTE_ROLES via /api/pipeline/ prefix).
"""
import httpx
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, StreamingResponse

router = APIRouter()

PIPELINE_ORIGIN = "http://10.0.1.12:8642"
_client = httpx.AsyncClient(base_url=PIPELINE_ORIGIN, timeout=300.0)


async def _proxy(method: str, path: str, request: Request) -> JSONResponse:
    try:
        body = None
        if method in ("POST", "PUT", "PATCH"):
            body = await request.body()
        resp = await _client.request(
            method,
            path,
            content=body,
            headers={"Content-Type": request.headers.get("Content-Type", "application/json")},
        )
        try:
            return JSONResponse(content=resp.json(), status_code=resp.status_code)
        except Exception:
            return JSONResponse(content={"raw": resp.text}, status_code=resp.status_code)
    except httpx.ConnectError:
        return JSONResponse(
            content={"success": False, "message": "Pipeline backend (8642) is unreachable."},
            status_code=503,
        )
    except Exception as e:
        return JSONResponse(
            content={"success": False, "message": str(e)},
            status_code=500,
        )


# ── Config ──────────────────────────────────────────────────────────────────

@router.get("/pipeline/config")
async def get_config(request: Request):
    return await _proxy("GET", "/api/config", request)


@router.post("/pipeline/config")
async def save_config(request: Request):
    return await _proxy("POST", "/api/config", request)


@router.post("/pipeline/config/reset")
async def reset_config(request: Request):
    return await _proxy("POST", "/api/config/reset", request)


# ── Grid / dataset helpers ───────────────────────────────────────────────────

@router.get("/pipeline/grid-columns")
async def grid_columns(request: Request):
    return await _proxy("GET", "/api/grid-columns", request)


@router.get("/pipeline/dataset-columns/{key}")
async def dataset_columns(key: str, request: Request):
    return await _proxy("GET", f"/api/dataset-columns/{key}", request)


@router.post("/pipeline/query/preview")
async def query_preview(request: Request):
    return await _proxy("POST", "/api/query/preview", request)


# ── Module runner ────────────────────────────────────────────────────────────

@router.post("/pipeline/module/{mod_id}/run")
async def run_module(mod_id: str, request: Request):
    return await _proxy("POST", f"/module/{mod_id}/run", request)


# ── SSE stream proxy ─────────────────────────────────────────────────────────

@router.get("/pipeline/stream/{job_id}")
async def stream_job(job_id: str, request: Request):
    """Proxy SSE stream from 8642 to the SS27 frontend."""
    async def event_generator():
        try:
            async with _client.stream("GET", f"/stream/{job_id}") as resp:
                async for chunk in resp.aiter_bytes():
                    yield chunk
        except httpx.ConnectError:
            yield b'data: {"status":"error","message":"Pipeline backend unreachable"}\n\n'
        except Exception as e:
            yield f'data: {{"status":"error","message":"{str(e)}"}}\n\n'.encode()

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
