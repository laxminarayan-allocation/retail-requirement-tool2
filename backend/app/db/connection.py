"""
Context manager for borrowing an Oracle connection from the pool.

Usage:
    from app.db.connection import get_connection

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT ...")
"""
import logging
import time
from contextlib import contextmanager
from typing import Generator

import oracledb

from app.db.oracle import get_pool

logger = logging.getLogger(__name__)


@contextmanager
def get_connection() -> Generator[oracledb.Connection, None, None]:
    """Borrow a connection from the pool, yield it, then return it."""
    pool = get_pool()
    t0 = time.perf_counter()
    conn: oracledb.Connection = pool.acquire()
    try:
        try:
            conn.cursor().execute("SET ROLE ALL")
        except Exception:
            pass
        logger.debug("Connection acquired (%.1f ms)", (time.perf_counter() - t0) * 1000)
        yield conn
    finally:
        pool.release(conn)
        logger.debug("Connection released")
