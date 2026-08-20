"""
Base repository — shared fetch utilities used by all repositories.

All queries use bind variables. Never use string formatting to inject
user-supplied values into SQL.
"""
import logging
import time
from pathlib import Path
from typing import Any

import oracledb
import pandas as pd

logger = logging.getLogger(__name__)

SQL_DIR = Path(__file__).parent.parent / "sql"


def load_sql(filename: str) -> str:
    """Load a SQL file from app/sql/. Raises if not found."""
    path = SQL_DIR / filename
    if not path.exists():
        raise FileNotFoundError(f"SQL file not found: {path}")
    return path.read_text(encoding="utf-8")


def fetch_df(
    conn: oracledb.Connection,
    sql: str,
    params: dict[str, Any] | None = None,
    label: str = "query",
) -> pd.DataFrame:
    """
    Execute a SELECT and return a Pandas DataFrame.
    Logs row count and execution time.
    Uses arraysize=50000 for efficient network batching.
    """
    t0 = time.perf_counter()
    with conn.cursor() as cur:
        cur.arraysize = 50_000
        if params:
            cur.execute(sql, params)
        else:
            cur.execute(sql)
        cols = [d[0].lower() for d in cur.description]
        rows = cur.fetchall()

    df = pd.DataFrame(rows, columns=cols)
    elapsed = round((time.perf_counter() - t0) * 1000, 1)
    logger.info("[%s] %d rows in %.0f ms", label, len(df), elapsed)
    return df


def safe_divide(numerator: pd.Series, denominator: pd.Series, fill: float = 0.0) -> pd.Series:
    """Vectorised division that returns fill when denominator is zero or null."""
    return numerator.where(denominator == 0, numerator / denominator.replace(0, pd.NA)).fillna(fill)
