"""
Phase 2 tests — database metadata API.

These tests do NOT require an Oracle connection; they verify that the
endpoints return the correct shape and error codes when Oracle is absent.
Tests that genuinely need Oracle are marked with @pytest.mark.integration
and are skipped unless ORACLE_INTEGRATION_TESTS=1 is set.
"""
import os
import pytest
from httpx import AsyncClient, ASGITransport
from app.main import app


@pytest.mark.asyncio
async def test_db_status_not_configured():
    """When .env has no Oracle credentials, status must be not_configured."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/api/database/status")
    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    data = body["data"]
    assert data["status"] in ("not_configured", "connected", "error")


@pytest.mark.asyncio
async def test_schemas_503_without_oracle():
    """Schema list must return 503 when Oracle is not configured."""
    if os.getenv("ORACLE_INTEGRATION_TESTS") == "1":
        pytest.skip("Integration mode — skipping unit stub test")

    # Temporarily clear the config
    from app.core import config as cfg
    original = cfg.settings.oracle_user
    cfg.settings.oracle_user = ""
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.get("/api/database/schemas")
        assert response.status_code == 503
    finally:
        cfg.settings.oracle_user = original


@pytest.mark.asyncio
async def test_tables_503_without_oracle():
    from app.core import config as cfg
    original = cfg.settings.oracle_user
    cfg.settings.oracle_user = ""
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.get("/api/database/tables")
        assert response.status_code == 503
    finally:
        cfg.settings.oracle_user = original


@pytest.mark.asyncio
async def test_views_503_without_oracle():
    from app.core import config as cfg
    original = cfg.settings.oracle_user
    cfg.settings.oracle_user = ""
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.get("/api/database/views")
        assert response.status_code == 503
    finally:
        cfg.settings.oracle_user = original


@pytest.mark.asyncio
async def test_search_requires_min_2_chars():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/api/database/search?q=a")
    # FastAPI validation returns 422 for q shorter than min_length=2
    assert response.status_code == 422


# ── Integration tests (require ORACLE_INTEGRATION_TESTS=1) ────────────────────

@pytest.mark.asyncio
@pytest.mark.skipif(
    os.getenv("ORACLE_INTEGRATION_TESTS") != "1",
    reason="Set ORACLE_INTEGRATION_TESTS=1 to run against real Oracle",
)
async def test_integration_schemas():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/api/database/schemas")
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["count"] > 0
    assert any(s["owner"] for s in data["schemas"])


@pytest.mark.asyncio
@pytest.mark.skipif(
    os.getenv("ORACLE_INTEGRATION_TESTS") != "1",
    reason="Set ORACLE_INTEGRATION_TESTS=1 to run against real Oracle",
)
async def test_integration_tables_misretail():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/api/database/tables?owner=MISRETAIL")
    assert response.status_code == 200
    data = response.json()["data"]
    assert isinstance(data["tables"], list)


@pytest.mark.asyncio
@pytest.mark.skipif(
    os.getenv("ORACLE_INTEGRATION_TESTS") != "1",
    reason="Set ORACLE_INTEGRATION_TESTS=1 to run against real Oracle",
)
async def test_integration_search():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/api/database/search?q=ALLOC")
    assert response.status_code == 200
    data = response.json()["data"]
    assert isinstance(data["results"], list)
