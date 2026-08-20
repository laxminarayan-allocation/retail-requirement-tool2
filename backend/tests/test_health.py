import pytest
from httpx import AsyncClient, ASGITransport
from app.main import app


@pytest.mark.asyncio
async def test_health_returns_ok():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/api/health")
    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    assert body["data"]["status"] == "ok"


@pytest.mark.asyncio
async def test_database_status_not_configured():
    """When Oracle credentials are empty the endpoint should return not_configured gracefully."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/api/database/status")
    assert response.status_code == 200
    body = response.json()
    # Success envelope is still true — just not connected
    assert body["success"] is True
    assert body["data"]["database"] == "Oracle"
