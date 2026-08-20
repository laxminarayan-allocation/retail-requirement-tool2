"""
Phase 14 tests — readiness endpoint, security headers, sanitised errors,
version from config, global exception handler.
"""
import pytest
from httpx import AsyncClient, ASGITransport
from unittest.mock import patch

from app.main import app
from app.core.config import settings


async def _get(path: str):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        return await c.get(path)


# ── /api/health ───────────────────────────────────────────────────────────────

async def test_health_returns_app_version():
    r = await _get("/api/health")
    body = r.json()
    assert body["success"] is True
    assert body["data"]["version"] == settings.app_version


async def test_health_returns_environment():
    r = await _get("/api/health")
    assert body["data"]["environment"] == settings.app_env if (body := r.json()) else True


# ── /api/health/ready ─────────────────────────────────────────────────────────

async def test_readiness_returns_200():
    r = await _get("/api/health/ready")
    assert r.status_code == 200


async def test_readiness_has_ready_field():
    r = await _get("/api/health/ready")
    body = r.json()
    assert body["success"] is True
    assert "ready" in body["data"]
    assert isinstance(body["data"]["ready"], bool)


async def test_readiness_has_checks_dict():
    r = await _get("/api/health/ready")
    body = r.json()
    assert "checks" in body["data"]
    assert isinstance(body["data"]["checks"], dict)


async def test_readiness_sqlite_check_present():
    """SQLite check is always present (it's always available)."""
    r = await _get("/api/health/ready")
    checks = r.json()["data"]["checks"]
    assert "sqlite" in checks


async def test_readiness_oracle_check_present():
    """Oracle check is present regardless of configuration."""
    r = await _get("/api/health/ready")
    checks = r.json()["data"]["checks"]
    assert "oracle" in checks


async def test_readiness_unconfigured_oracle_not_ready():
    """When Oracle is not configured, readiness should be False."""
    r = await _get("/api/health/ready")
    body = r.json()
    if not settings.is_oracle_configured:
        assert body["data"]["ready"] is False


# ── Security headers ──────────────────────────────────────────────────────────

async def test_security_header_nosniff():
    r = await _get("/api/health")
    assert r.headers.get("x-content-type-options") == "nosniff"


async def test_security_header_frame_deny():
    r = await _get("/api/health")
    assert r.headers.get("x-frame-options") == "DENY"


async def test_security_header_referrer():
    r = await _get("/api/health")
    assert r.headers.get("referrer-policy") == "strict-origin-when-cross-origin"


async def test_api_cache_control_no_store():
    r = await _get("/api/health")
    cc = r.headers.get("cache-control", "")
    assert "no-store" in cc


async def test_process_time_header_numeric():
    r = await _get("/api/health")
    val = r.headers.get("x-process-time-ms", "")
    assert float(val) >= 0


# ── Global exception handler ──────────────────────────────────────────────────

async def test_global_exception_handler_is_registered():
    """The global exception handler must be registered on the app."""
    from fastapi.exception_handlers import http_exception_handler
    # FastAPI stores exception handlers in the app's exception_handlers dict
    # Our handler covers the base Exception class
    handler_keys = [str(k) for k in app.exception_handlers.keys()]
    # 500 or Exception — either key indicates a global handler is wired
    assert any("500" in k or "Exception" in k for k in handler_keys), \
        f"No global exception handler found. Keys: {handler_keys}"


async def test_global_exception_handler_response_shape():
    """The handler must return our standard APIResponse-shaped JSON."""
    from app.main import unhandled_exception_handler
    from fastapi import Request
    from starlette.testclient import TestClient

    # Directly call the handler with a fake request and exception
    scope = {"type": "http", "method": "GET", "path": "/test", "query_string": b"",
             "headers": [], "app": app}

    class FakeRequest:
        method = "GET"
        class url:
            path = "/test"

    response = await unhandled_exception_handler(FakeRequest(), RuntimeError("boom"))
    import json
    body = json.loads(response.body)
    assert response.status_code == 500
    assert body["success"] is False
    assert "boom" not in body["message"]     # internal detail not exposed
    assert "unexpected error" in body["message"].lower()


# ── Oracle error sanitisation ─────────────────────────────────────────────────

def test_sanitise_oracle_error_ora_code():
    from app.api.routes.health import _sanitise_oracle_error
    exc = Exception("ORA-12541: TNS:no listener\nAdditional info: host=10.0.0.15")
    result = _sanitise_oracle_error(exc)
    assert result.startswith("ORA-12541")
    assert "host=" not in result    # DSN fragment stripped


def test_sanitise_oracle_error_dpy_code():
    from app.api.routes.health import _sanitise_oracle_error
    exc = Exception("DPY-3015: password verifier type 0x939 is not supported by python-oracledb in thin mode")
    result = _sanitise_oracle_error(exc)
    assert result.startswith("DPY-3015")


def test_sanitise_oracle_error_generic():
    from app.api.routes.health import _sanitise_oracle_error
    exc = Exception("socket.gaierror: [Errno 11001] getaddrinfo failed")
    result = _sanitise_oracle_error(exc)
    assert "getaddrinfo" not in result    # internal detail not exposed
    assert "Database connection error" in result


# ── SecretStr — password not exposed in dumps ─────────────────────────────────

def test_oracle_password_not_in_settings_repr():
    """SecretStr must hide the value in repr/str so it can't leak into logs."""
    if not settings.oracle_password.get_secret_value():
        pytest.skip("No oracle password configured to test")
    repr_str = repr(settings)
    assert settings.oracle_password.get_secret_value() not in repr_str


def test_oracle_password_secret_str_type():
    from pydantic import SecretStr
    assert isinstance(settings.oracle_password, SecretStr)
