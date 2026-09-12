"""
Data Store API — manage parquet cache of Oracle sources.

GET  /api/data-store/status          — checklist of all sources
POST /api/data-store/download/{key}  — trigger download for one source
POST /api/data-store/download-all    — trigger download for all sources
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/data-store", tags=["Data Store"])


@router.get("/status")
def data_store_status():
    from app.core.parquet_store import get_status
    return get_status()


@router.post("/download/{key}")
def download_one(key: str):
    from app.core.parquet_store import SOURCE_MAP, download_source_async, _dl_status, _dl_lock
    if key not in SOURCE_MAP:
        raise HTTPException(404, f"Unknown source: {key}")
    with _dl_lock:
        if _dl_status.get(key, {}).get("status") == "running":
            raise HTTPException(409, f"{key} download already running")
    download_source_async(key)
    return {"triggered": True, "key": key}


class DownloadAllBody(BaseModel):
    keys: list[str] | None = None   # None = all


@router.post("/download-all")
def download_all(body: DownloadAllBody = DownloadAllBody()):
    from app.core.parquet_store import SOURCE_MAP, download_all_async, SOURCES
    keys = body.keys or [s["key"] for s in SOURCES]
    invalid = [k for k in keys if k not in SOURCE_MAP]
    if invalid:
        raise HTTPException(400, f"Unknown keys: {invalid}")
    download_all_async(keys)
    return {"triggered": True, "keys": keys}
