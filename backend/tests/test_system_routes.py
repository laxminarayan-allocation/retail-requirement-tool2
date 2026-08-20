"""
Tests for the system status / cache endpoints (Phase 12).

Oracle pool and repository caches are mocked so these tests run offline.
"""
import pytest
from httpx import AsyncClient, ASGITransport
from unittest.mock import patch

from app.main import app


async def _get(path: str, **kwargs):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        return await c.get(path, **kwargs)


async def _post(path: str, **kwargs):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        return await c.post(path, **kwargs)


# ── GET /api/system/status ────────────────────────────────────────────────────

async def test_system_status_ok():
    r = await _get("/api/system/status")
    assert r.status_code == 200
    body = r.json()
    assert body["success"] is True
    data = body["data"]
    assert "oracle_pool" in data
    assert "item_cache" in data
    assert "store_cache" in data
    assert "run_store" in data
    assert "warmup" in data
    assert "recommendations" in data
    assert "status_query_ms" in data
    assert "timestamp" in data


async def test_system_status_cold_caches_give_recommendation():
    """When item cache is not loaded, recommendations should mention warmup."""
    with patch("app.api.routes.system._item_cache_info", return_value={"loaded": False, "rows": 0}), \
         patch("app.api.routes.system._store_cache_info", return_value={"loaded": False, "rows": 0}):
        r = await _get("/api/system/status")
    body = r.json()
    recs = body["data"]["recommendations"]
    assert any("warmup" in rec.lower() for rec in recs)


async def test_system_status_warm_caches_positive_message():
    with patch("app.api.routes.system._item_cache_info", return_value={"loaded": True, "rows": 5000}), \
         patch("app.api.routes.system._store_cache_info", return_value={"loaded": True, "rows": 200}), \
         patch("app.api.routes.system._oracle_pool_info", return_value={"min_size": 2, "max_size": 10, "open": 3, "busy": 1, "free": 2}):
        r = await _get("/api/system/status")
    body = r.json()
    recs = body["data"]["recommendations"]
    assert any("ready" in rec.lower() for rec in recs)


async def test_system_status_run_store_counts(minimal_run_record):
    from app.engine import run_store
    run_store.save_run(minimal_run_record)
    r = await _get("/api/system/status")
    body = r.json()
    assert body["data"]["run_store"]["runs_in_memory"] == 1


# ── POST /api/system/cache/invalidate ────────────────────────────────────────

async def test_cache_invalidate_calls_both_repos():
    from unittest.mock import MagicMock, patch
    item_mock = MagicMock()
    store_mock = MagicMock()
    with patch("app.repositories.item_repository.ItemRepository") as im, \
         patch("app.repositories.store_repository.StoreRepository") as sm:
        im.return_value = item_mock
        sm.return_value = store_mock
        r = await _post("/api/system/cache/invalidate")
    assert r.status_code == 200
    body = r.json()
    assert body["success"] is True
    assert "cleared" in body["data"]


async def test_cache_invalidate_graceful_on_error():
    """Even if both repos raise, the endpoint should return success with empty cleared list."""
    with patch("app.repositories.item_repository.ItemRepository",
               side_effect=RuntimeError("no oracle")), \
         patch("app.repositories.store_repository.StoreRepository",
               side_effect=RuntimeError("no oracle")):
        r = await _post("/api/system/cache/invalidate")
    assert r.status_code == 200
    body = r.json()
    assert body["success"] is True


# ── POST /api/system/cache/warmup ─────────────────────────────────────────────

async def test_cache_warmup_starts_background_thread():
    from app.api.routes import system as sys_mod
    with patch("app.api.routes.system._warmup_status", {
        "running": False, "last_run": None,
        "last_duration_s": None, "items_loaded": 0,
        "stores_loaded": 0, "error": None,
    }):
        with patch("app.api.routes.system._do_warmup"):
            r = await _post("/api/system/cache/warmup")
    assert r.status_code == 200
    body = r.json()
    assert body["success"] is True


async def test_cache_warmup_idempotent_when_running():
    """If warmup is already running, return 200 with the current status."""
    import app.api.routes.system as sys_mod
    original = dict(sys_mod._warmup_status)
    sys_mod._warmup_status["running"] = True
    try:
        r = await _post("/api/system/cache/warmup")
        body = r.json()
        assert body["success"] is True
        assert "already running" in body["message"].lower()
    finally:
        sys_mod._warmup_status.update(original)
        sys_mod._warmup_status["running"] = False


# ── Process-time header ───────────────────────────────────────────────────────

async def test_process_time_header_present():
    r = await _get("/api/health")
    assert "x-process-time-ms" in r.headers


async def test_process_time_header_is_numeric():
    r = await _get("/api/health")
    val = r.headers.get("x-process-time-ms", "")
    assert float(val) >= 0
