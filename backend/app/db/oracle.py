"""
Oracle connection pool.

Thin mode  — default, no Oracle client software needed.
Thick mode — required when the Oracle user account uses the old 10g password
             verifier (DPY-3015 error). Set ORACLE_THICK_MODE=1 in .env and
             point ORACLE_CLIENT_LIB_DIR at an extracted Instant Client folder.

Thick mode setup (Windows):
  1. Download Instant Client Basic (ZIP) from:
       https://www.oracle.com/database/technologies/instant-client/winx64-64-downloads.html
  2. Extract to e.g.  C:\\oracle\\instantclient_21_15
  3. In backend/.env set:
       ORACLE_THICK_MODE=1
       ORACLE_CLIENT_LIB_DIR=C:\\oracle\\instantclient_21_15
  4. Re-run: python scripts/test_oracle.py
"""
import logging
import os
import threading
from typing import Optional

import oracledb

from app.core.config import settings

logger = logging.getLogger(__name__)

_pool: Optional[oracledb.ConnectionPool] = None
_pool_lock = threading.Lock()
_thick_initialised = False


def _ensure_thick_mode() -> None:
    """Initialise oracledb thick mode exactly once per process."""
    global _thick_initialised
    if _thick_initialised:
        return
    lib_dir: Optional[str] = settings.oracle_client_lib_dir or None
    oracledb.init_oracle_client(lib_dir=lib_dir)
    _thick_initialised = True
    logger.info("oracledb thick mode initialised — lib_dir=%s", lib_dir or "(auto-detect)")


def get_pool() -> oracledb.ConnectionPool:
    """Return the shared connection pool, creating it on first call."""
    global _pool
    if _pool is not None:
        return _pool

    with _pool_lock:
        if _pool is not None:
            return _pool

        if not settings.is_oracle_configured:
            raise RuntimeError(
                "Oracle credentials not configured. "
                "Set ORACLE_USER, ORACLE_PASSWORD, ORACLE_HOST, ORACLE_SERVICE_NAME in .env"
            )

        thick_mode = settings.oracle_thick_mode
        if thick_mode:
            _ensure_thick_mode()
        else:
            logger.info("oracledb thin mode (default)")

        def _session_init(conn, requested_tag):
            """Enable all granted roles on each new pooled connection."""
            try:
                conn.cursor().execute("SET ROLE ALL")
            except Exception:
                pass

        _pool = oracledb.create_pool(
            user=settings.oracle_user,
            password=settings.oracle_password.get_secret_value(),
            dsn=settings.oracle_dsn,
            min=settings.oracle_pool_min,
            max=settings.oracle_pool_max,
            increment=1,
            getmode=oracledb.POOL_GETMODE_WAIT,
            timeout=30,
            session_callback=_session_init,
        )
        mode = "thick" if thick_mode else "thin"
        logger.info(
            "Oracle pool created [%s] — dsn=%s user=%s",
            mode,
            settings.oracle_dsn,
            settings.oracle_user,
        )
        return _pool


def close_pool() -> None:
    global _pool
    if _pool is not None:
        _pool.close()
        _pool = None
        logger.info("Oracle pool closed")
