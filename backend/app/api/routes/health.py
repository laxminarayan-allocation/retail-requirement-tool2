"""
Health and readiness endpoints — Phase 14.

GET /api/health       — liveness (no DB required, always fast)
GET /api/health/ready — readiness (checks Oracle pool + SQLite)
GET /api/database/status — detailed Oracle connectivity metadata
"""
import logging
import time
from fastapi import APIRouter

from app.core.config import settings
from app.models.response_models import APIResponse, HealthResponse, DatabaseStatusResponse

logger = logging.getLogger(__name__)
router = APIRouter()


def _sanitise_oracle_error(exc: Exception) -> str:
    """
    Return a safe error string that does not leak connection strings,
    credentials, or internal hostnames to API callers.
    """
    msg = str(exc)
    # oracledb error codes are safe to expose; the full message may contain DSN fragments
    for prefix in ("ORA-", "DPY-", "DPI-"):
        if prefix in msg:
            # Return only up to the first newline — the code + summary line
            return msg.split("\n")[0].strip()
    # Generic message for anything that doesn't carry an Oracle error code
    return "Database connection error. Check server logs for details."


@router.get("/health", response_model=APIResponse, tags=["Health"])
async def health_check():
    """Liveness probe — returns ok immediately, no Oracle required."""
    return APIResponse.ok(data=HealthResponse(
        status="ok",
        version=settings.app_version,
        environment=settings.app_env,
    ).model_dump())


@router.get("/health/ready", response_model=APIResponse, tags=["Health"])
async def readiness_check():
    """
    Readiness probe — verifies Oracle pool and SQLite are accessible.
    Returns 200 with ready=True when healthy, 200 with ready=False when degraded.
    Container orchestrators should watch the `ready` field, not just the HTTP status.
    """
    checks: dict[str, dict] = {}

    # Oracle check
    if settings.is_oracle_configured:
        try:
            t0 = time.perf_counter()
            from app.db.oracle import get_pool
            pool = get_pool()
            with pool.acquire() as conn:
                conn.ping()
            checks["oracle"] = {"ok": True, "ms": round((time.perf_counter() - t0) * 1000, 1)}
        except Exception as exc:
            checks["oracle"] = {"ok": False, "error": _sanitise_oracle_error(exc)}
    else:
        checks["oracle"] = {"ok": False, "error": "Oracle not configured"}

    # SQLite check
    try:
        from app.db.sqlite import get_sqlite
        with get_sqlite() as conn:
            conn.execute("SELECT 1").fetchone()
        checks["sqlite"] = {"ok": True}
    except Exception as exc:
        checks["sqlite"] = {"ok": False, "error": str(exc)}

    ready = all(c["ok"] for c in checks.values())
    return APIResponse.ok(data={
        "ready": ready,
        "checks": checks,
        "version": settings.app_version,
        "environment": settings.app_env,
    })


@router.get("/database/status", response_model=APIResponse, tags=["Database"])
async def database_status():
    """Detailed Oracle connectivity probe — for the Database Explorer page."""
    if not settings.is_oracle_configured:
        return APIResponse.ok(
            data=DatabaseStatusResponse(
                status="not_configured",
                database="Oracle",
                message="Oracle credentials not set in .env",
            ).model_dump(),
            message="Oracle not configured",
        )

    try:
        import oracledb
        t0 = time.perf_counter()
        with oracledb.connect(
            user=settings.oracle_user,
            password=settings.oracle_password.get_secret_value(),
            dsn=settings.oracle_dsn,
        ) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT banner, SYS_CONTEXT('USERENV','CURRENT_SCHEMA') "
                    "FROM v$version WHERE ROWNUM = 1"
                )
                row = cur.fetchone()
                oracle_version = row[0] if row else "Unknown"
                schema = row[1] if row else "Unknown"

        elapsed_ms = round((time.perf_counter() - t0) * 1000, 2)
        logger.info("Oracle connected — %.0f ms", elapsed_ms)
        return APIResponse.ok(data=DatabaseStatusResponse(
            status="connected",
            database="Oracle",
            db_schema=schema,
            oracle_version=oracle_version,
            response_time_ms=elapsed_ms,
        ).model_dump())

    except Exception as exc:
        safe_msg = _sanitise_oracle_error(exc)
        logger.error("Oracle connection check failed: %s", exc)
        return APIResponse.fail(
            message="Oracle connection failed",
            errors=[safe_msg],
        )
