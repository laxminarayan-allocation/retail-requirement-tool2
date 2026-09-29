"""
Retail Requirement Tool — FastAPI application entry point.
Phase 14: production hardening — security headers, global exception handler,
          readiness endpoint, structured logging, startup banner.
"""
import logging
import time
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse, FileResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.config import settings
from app.core.logging_config import configure_logging
import jwt as _jwt

from app.api.routes import health
from app.api.routes import database
from app.api.routes import master_data
from app.api.routes import factors
from app.api.routes import calculation
from app.api.routes import dashboard
from app.api.routes import system as system_routes
from app.api.routes import auth as auth_routes
from app.api.routes import assistant as assistant_routes
from app.api.routes import notifications as notif_routes
from app.api.routes import sop as sop_routes
from app.api.routes import nso as nso_routes
from app.api.routes import sale as sale_routes
from app.api.routes import req_dashboard as req_dashboard_routes
from app.api.routes import distribution as distribution_routes
from app.api.routes import simulation as simulation_routes
from app.api.routes import option_listing as option_listing_routes
from app.api.routes import oracle_refresh as oracle_refresh_routes
from app.api.routes import versions as versions_routes
from app.api.routes import warehouse_inventory as warehouse_inventory_routes
from app.api.routes import data_store as data_store_routes
from app.api.routes import preferences as preferences_routes
from app.api.routes import pipeline as pipeline_routes

import mimetypes
mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("application/javascript", ".mjs")
mimetypes.add_type("text/css", ".css")
mimetypes.add_type("image/svg+xml", ".svg")

configure_logging()
logger = logging.getLogger(__name__)


# ── Lifespan ──────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    _log_startup_banner()

    from app.db.sqlite import init_db
    init_db()

    if settings.is_oracle_configured:
        try:
            from app.db.oracle import get_pool
            get_pool()
            logger.info("Oracle connection pool ready")
        except Exception as exc:
            logger.warning("Oracle pool pre-warm failed — will retry on first request: %s", exc)

        from app.api.routes.system import _do_warmup
        import threading
        threading.Thread(target=_do_warmup, daemon=True, name="startup-cache-warmup").start()
        logger.info("Background cache warmup thread started")

    # Auto-logout: mark non-admin users as force_logout if last_seen_at is > 2 hrs ago
    import threading as _threading
    _threading.Thread(target=_run_inactivity_checker, daemon=True, name="inactivity-checker").start()
    logger.info("Inactivity auto-logout checker started (2hr screen-lock threshold)")

    # Requirements views: register in master data + start daily 6 AM refresh
    from app.core.req_scheduler import register_views_in_master_data, start_scheduler
    register_views_in_master_data()
    if settings.is_oracle_configured:
        start_scheduler()

    # Pipeline: auto-run all 8 steps at 09:00 IST daily
    from app.core.pipeline_scheduler import start_scheduler as pipeline_start_scheduler
    pipeline_start_scheduler()

    # DB Explorer: start configurable auto-refresh scheduler
    from app.core.db_scheduler import start_scheduler as db_start_scheduler
    if settings.is_oracle_configured:
        db_start_scheduler()

        # Layer 2b: Master data caches — parquet-first, Oracle fallback
        # All T-1 data: load once at startup, never hit Oracle again intra-day
        def _warm_all_caches():
            import time as _t
            _t.sleep(3)  # let Oracle pool settle first
            from app.repositories.store_repository import warm_store_cache
            from app.repositories.item_repository import warm_item_cache
            from app.repositories.stock_repository import warm_stock_cache
            from app.repositories.sales_repository import warm_sales_cache
            from app.repositories.pbs_repository import warm_pbs_cache
            warm_store_cache()   # parquet → instant
            warm_item_cache()    # parquet → instant
            warm_stock_cache()   # Oracle (no parquet yet) — runs once
            warm_sales_cache()   # Oracle (no parquet yet) — runs once
            warm_pbs_cache()     # Oracle (no parquet yet) — runs once

        import threading as _th_warm
        _th_warm.Thread(target=_warm_all_caches, daemon=True, name="master-cache-warmup").start()
        logger.info("Master data cache warmup thread started (parquet-first)")

        # Layer 3: Dashboard cache warm — refresh every 2 hours so viewers never wait
        import threading as _th2
        def _dashboard_cache_loop():
            import time as _t
            _t.sleep(5)   # brief pause then warm dashboard cache immediately
            while True:
                try:
                    from app.api.routes.dashboard import _fetch_oracle_stats_fresh
                    _fetch_oracle_stats_fresh()
                    logger.info("dashboard-cache-refresh: oracle stats refreshed")
                except Exception as exc:
                    logger.warning("dashboard-cache-refresh: failed — %s", exc)
                _t.sleep(2 * 3600)  # sleep 2 hours

        _th2.Thread(target=_dashboard_cache_loop, daemon=True, name="dashboard-cache-refresh").start()
        logger.info("Dashboard cache refresh thread started (every 2 hrs)")

    yield

    from app.db.oracle import close_pool
    close_pool()
    logger.info("=== Retail Requirement Tool — shutdown ===")


def _run_inactivity_checker() -> None:
    """
    Background thread: every 15 minutes, flag non-admin users whose
    last_seen_at is older than 2 hours as force_logout=1.
    On their next request the middleware rejects the JWT and they are signed out.
    When they sign in again, force_logout is cleared.
    """
    import time as _time
    from datetime import datetime, timezone, timedelta
    from app.db.sqlite import get_sqlite

    IDLE_LIMIT = timedelta(hours=2)
    CHECK_INTERVAL = 15 * 60  # 15 minutes

    while True:
        _time.sleep(CHECK_INTERVAL)
        try:
            cutoff = (datetime.now(timezone.utc) - IDLE_LIMIT).isoformat()
            with get_sqlite() as db:
                rows = db.execute(
                    """UPDATE users SET force_logout=1
                       WHERE role != 'admin'
                         AND is_active=1
                         AND last_seen_at IS NOT NULL
                         AND last_seen_at < ?
                         AND force_logout=0""",
                    (cutoff,),
                ).rowcount
            if rows:
                logger.info("Auto-logout: flagged %d inactive non-admin user(s) (idle ≥ 2 hrs)", rows)
        except Exception as exc:
            logger.warning("Inactivity checker error: %s", exc)


def _log_startup_banner() -> None:
    logger.info("=" * 60)
    logger.info("Retail Requirement Tool  v%s", settings.app_version)
    logger.info("  env=%s  port=%s  log_level=%s  json_logs=%s",
                settings.app_env, settings.app_port,
                settings.log_level, settings.log_json or settings.is_production)
    logger.info("  oracle_configured=%s", settings.is_oracle_configured)
    if settings.is_oracle_configured:
        logger.info("  oracle_dsn=%s  oracle_user=%s  pool=%d-%d",
                    settings.oracle_dsn, settings.oracle_user,
                    settings.oracle_pool_min, settings.oracle_pool_max)
    logger.info("  cors_origins=%s", settings.cors_origins_list)
    logger.info("=" * 60)


# ── App ───────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="Retail Requirement Tool API",
    description="Replenishment calculation engine for 200+ stores.",
    version=settings.app_version,
    lifespan=lifespan,
    # Hide /docs and /redoc in production
    docs_url=None if settings.is_production else "/docs",
    redoc_url=None if settings.is_production else "/redoc",
)

# ── Middleware (outermost first) ───────────────────────────────────────────────

# GZip all responses >= 1 KB
app.add_middleware(GZipMiddleware, minimum_size=1024)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


from app.repositories.user_repository import ROLE_LEVEL

# (path_prefix, method_set_or_None, minimum_role_or_None)
# None role = fully public. Checked in order — first matching prefix+method wins.
_ROUTE_ROLES: list[tuple] = [
    # Public — no token needed
    ("/api/auth/signup",            None,          None),
    ("/api/auth/signin",            None,          None),
    ("/api/auth/forgot-password",   None,          None),
    ("/api/health",                 None,          None),
    ("/api/oracle-refresh/test-win32", None,       None),
    # Any authenticated (pending+)
    ("/api/auth/me",                None,          "pending"),
    ("/api/auth/signout",           None,          "pending"),
    ("/api/auth/request-role",      {"POST"},      "pending"),
    # Any authenticated user can see their own data
    ("/api/auth/my-logs",          {"GET"},       "viewer"),
    ("/api/auth/my-page-access",   {"GET"},       "viewer"),
    ("/api/auth/session/heartbeat", {"POST"},      "viewer"),
    ("/api/auth/active-sessions",  {"GET"},       "viewer"),
    # Admin only
    ("/api/auth/",                  None,          "admin"),
    ("/api/system/",               None,          "admin"),
    # Planner+ (write operations, database explorer, factors)
    ("/api/sop/",                  None,          "viewer"),   # read all; write enforced in route
    ("/api/database/query/export",   {"POST"},      "admin"),
    ("/api/database/output/freq",    {"POST"},      "planner"),
    ("/api/database/output/schedule",{"PUT"},       "planner"),
    ("/api/database/output/",        None,          "viewer"),
    ("/api/database/",               None,          "planner"),
    ("/api/factors/",              None,          "planner"),
    ("/api/calculation/run",       {"POST"},      "planner"),
    # Viewer+ (read-only browsing)
    ("/api/calculation/",          None,          "viewer"),
    ("/api/dashboard/",            None,          "viewer"),
    ("/api/req/",                  None,          "viewer"),
    ("/api/master-data/",          None,          "viewer"),
    # Assistant logs — admin only
    ("/api/assistant/logs",        {"GET"},       "admin"),
    # Assistant — viewer+
    ("/api/assistant/",            None,          "viewer"),
    # Notifications — send is admin only, rest is viewer+
    ("/api/notifications/send",    {"POST"},      "admin"),
    ("/api/notifications/",        None,          "viewer"),
    # Simulation — planner+ (reads Oracle-derived data)
    ("/api/simulation/",           None,          "planner"),
    # Option Listing — Pre-Winter AW26 allocation (planner+)
    ("/api/option-listing/",       None,          "planner"),
    # Pipeline proxy → 8642 (planner+)
    ("/api/pipeline/",             None,          "planner"),
    # Oracle / Excel Refresh (planner+)
    ("/api/oracle-refresh/",       None,          "planner"),
    # Version Control — GET public, write ops admin
    ("/api/versions",              {"GET"},       None),
    ("/api/versions/",             {"GET"},       None),
    ("/api/versions/",             None,          "admin"),
    # Warehouse Inventory — viewer+
    ("/api/warehouse-inventory/",  None,          "viewer"),
    ("/api/warehouse-inventory",   None,          "viewer"),
    # Fallback — any API route needs at least viewer
    ("/api/",                      None,          "viewer"),
]


def _required_role(path: str, method: str) -> str | None:
    """Return the minimum required role for this path+method, or None if public."""
    for prefix, methods, min_role in _ROUTE_ROLES:
        if path.startswith(prefix):
            if methods is None or method.upper() in methods:
                return min_role
    return "viewer"  # safe default


def _403(message: str):
    return JSONResponse(
        status_code=403,
        content={"success": False, "data": None, "message": message, "errors": []},
    )


def _401(message: str):
    return JSONResponse(
        status_code=401,
        content={"success": False, "data": None, "message": message, "errors": []},
    )


@app.middleware("http")
async def jwt_auth_middleware(request: Request, call_next):
    path = request.url.path
    method = request.method

    if (path.startswith("/assets")
            or path in ("/favicon.ico", "/manifest.json", "/robots.txt")
            or path.startswith("/docs")
            or path.startswith("/redoc")
            or path.startswith("/openapi")):
        return await call_next(request)

    # SPA routes (non-API paths) — pass through; index.html is public
    if not path.startswith("/api"):
        return await call_next(request)

    min_role = _required_role(path, method)

    if min_role is None:
        return await call_next(request)

    # Token required for all non-public routes
    token = request.headers.get("Authorization", "")
    if token.startswith("Bearer "):
        token = token[7:]

    if not token:
        return _401("Authentication required.")

    try:
        payload = _jwt.decode(
            token, settings.jwt_secret.get_secret_value(), algorithms=["HS256"]
        )
        request.state.user = payload
    except _jwt.ExpiredSignatureError:
        return _401("Session expired. Please sign in again.")
    except _jwt.PyJWTError:
        return _401("Invalid token.")

    # Check force_logout flag (set by inactivity auto-logout for screen-lock)
    user_email = payload.get("email", "")
    user_role = payload.get("role", "pending")
    if user_role != "admin":
        from app.db.sqlite import get_sqlite
        import time as _t
        now_iso = __import__('datetime').datetime.utcnow().isoformat()
        try:
            with get_sqlite() as _db:
                row = _db.execute(
                    "SELECT force_logout FROM users WHERE email=?", (user_email,)
                ).fetchone()
                if row and row["force_logout"]:
                    return _401("Your session was ended due to inactivity (screen locked ≥ 2 hrs). Please sign in again.")
                # Update last_seen_at on every authenticated request
                _db.execute(
                    "UPDATE users SET last_seen_at=? WHERE email=?", (now_iso, user_email)
                )
        except Exception:
            pass  # Never block a request due to SQLite update failure

    # Role check
    if ROLE_LEVEL.get(user_role, 0) < ROLE_LEVEL.get(min_role, 0):
        if user_role == "pending":
            return _403("Your account is pending approval. Request access from your admin.")
        return _403("You do not have permission to access this resource.")

    return await call_next(request)


@app.middleware("http")
async def security_and_timing_headers(request: Request, call_next):
    t0 = time.perf_counter()
    response = await call_next(request)
    # Performance
    response.headers["X-Process-Time-Ms"] = str(round((time.perf_counter() - t0) * 1000, 1))
    # Security hardening
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    # API responses must not be cached by default — prevents stale data in proxies/browsers
    if request.url.path.startswith("/api"):
        response.headers.setdefault("Cache-Control", "no-store")
    return response


# ── Global exception handler ───────────────────────────────────────────────────

@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    logger.error(
        "Unhandled exception [%s %s]: %s",
        request.method, request.url.path, exc,
        exc_info=True,
    )
    return JSONResponse(
        status_code=500,
        content={
            "success": False,
            "data": None,
            "message": "An unexpected error occurred. The request has been logged.",
            "errors": [],
        },
    )


# ── Routes ────────────────────────────────────────────────────────────────────

app.include_router(auth_routes.router, prefix="/api")      # Auth
app.include_router(health.router, prefix="/api")           # Phase 1 + 14 (readiness)
app.include_router(database.router, prefix="/api")         # Phase 2
app.include_router(master_data.router, prefix="/api")      # Phase 3
app.include_router(factors.router, prefix="/api")          # Phase 5
app.include_router(calculation.router, prefix="/api")      # Phase 6–11
app.include_router(dashboard.router, prefix="/api")        # Phase 9
app.include_router(system_routes.router, prefix="/api")    # Phase 12
app.include_router(assistant_routes.router, prefix="/api") # Assistant
app.include_router(notif_routes.router, prefix="/api")    # Notifications
app.include_router(sop_routes.router,   prefix="/api")    # SOP / Procedures
app.include_router(nso_routes.router,   prefix="/api")    # NSO Dashboard
app.include_router(sale_routes.router,  prefix="/api")    # Sale Dashboard
app.include_router(req_dashboard_routes.router, prefix="/api")  # Requirements Dashboard
app.include_router(distribution_routes.router, prefix="/api")  # Distribution Model
app.include_router(simulation_routes.router, prefix="/api")   # Allocation Simulation
app.include_router(option_listing_routes.router, prefix="/api")  # Option Listing (Pre-Winter AW26)
app.include_router(oracle_refresh_routes.router, prefix="/api")  # Oracle / Excel Refresh
app.include_router(versions_routes.router, prefix="/api")          # Version Control / Changelog
app.include_router(warehouse_inventory_routes.router, prefix="/api")  # Warehouse Inventory
app.include_router(data_store_routes.router,         prefix="/api")  # Parquet Data Store
app.include_router(preferences_routes.router,        prefix="/api")  # User Preferences
app.include_router(pipeline_routes.router,            prefix="/api")  # Native pipeline


@app.get("/api", tags=["Root"])
async def root():
    return {
        "message": "Retail Requirement Tool API",
        "version": settings.app_version,
        "environment": settings.app_env,
        "docs": "/docs" if not settings.is_production else None,
    }


# ── Static file serving (production build) ────────────────────────────────────
# Mount frontend/dist so Tailscale Funnel can proxy port 8000 directly.
# This must come AFTER all /api routes so it never shadows API endpoints.

_DIST_DIR = Path(__file__).parent.parent.parent / "frontend" / "dist"


class _CharsetMiddleware(BaseHTTPMiddleware):
    """Ensure JS/CSS responses have correct MIME type and charset.

    Windows registry may map .js to text/plain; nosniff would then cause
    mobile browsers to refuse execution. Override to the correct types.
    """
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        path = request.url.path
        if path.endswith((".js", ".mjs")):
            response.headers["content-type"] = "application/javascript; charset=utf-8"
        elif path.endswith(".css"):
            response.headers["content-type"] = "text/css; charset=utf-8"
        return response

app.add_middleware(_CharsetMiddleware)

if _DIST_DIR.exists():
    app.mount(
        "/assets",
        StaticFiles(directory=str(_DIST_DIR / "assets")),
        name="static-assets",
    )

    @app.get("/citykart-logo.png", include_in_schema=False)
    async def serve_logo():
        return FileResponse(str(_DIST_DIR / "citykart-logo.png"))

    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa_fallback(full_path: str, request: Request):
        # Never serve HTML for API routes — return 404 so the error is obvious
        if full_path.startswith("api/"):
            return JSONResponse(status_code=404, content={"detail": f"API route not found: /{full_path}"})
        # Serve index.html — no-cache so browser always gets the latest build
        return FileResponse(
            str(_DIST_DIR / "index.html"),
            headers={"Cache-Control": "no-cache, no-store, must-revalidate"},
        )
