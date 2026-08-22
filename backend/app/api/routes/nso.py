"""
NSO Dashboard — New Store Opening performance tracker.

Queries V_NSO (Oracle view) with optional filters.
All queries are parameterized — no raw string interpolation of user input.
"""
import logging
import time
from typing import Optional

from fastapi import APIRouter, Query, HTTPException

from app.models.response_models import APIResponse
from app.db.connection import get_connection
from app.core.config import settings

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/nso", tags=["NSO Dashboard"])


def _require_oracle():
    if not settings.is_oracle_configured:
        raise HTTPException(status_code=503, detail="Oracle not configured")


def _col_names(cursor) -> list[str]:
    """Extract column names from cursor description."""
    return [d[0].upper() for d in cursor.description]


@router.get("/data", response_model=APIResponse)
async def get_nso_data(
    attribute1: Optional[str] = Query(None),
    store_status: Optional[str] = Query(None),
    division: Optional[str] = Query(None),
    limit: int = Query(500, ge=1, le=5000),
):
    """
    Return rows from V_NSO with optional filters.
    Filters are applied server-side with bind variables.
    """
    _require_oracle()
    try:
        t0 = time.perf_counter()

        clauses: list[str] = []
        binds: dict = {}

        if attribute1:
            clauses.append("ATTRIBUTE1 = :attribute1")
            binds["attribute1"] = attribute1.upper()
        if store_status:
            clauses.append("STORE_STATUS = :store_status")
            binds["store_status"] = store_status.upper()
        if division:
            clauses.append("DIVISION = :division")
            binds["division"] = division.upper()

        where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
        sql = f"""
            SELECT * FROM (
                SELECT n.*, ROWNUM rn
                FROM MISRETAIL.V_NSO n
                {where}
                ORDER BY STORE_STATUS, TENTATIVE_DATE, STORE_F_NAME
            ) WHERE rn <= :lim
        """
        binds["lim"] = limit

        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(sql, binds)
                cols = _col_names(cur)
                rows_raw = cur.fetchall()

        # Convert to list of dicts; handle Decimal/date types
        rows = []
        for r in rows_raw:
            row: dict = {}
            for col, val in zip(cols, r):
                if hasattr(val, "isoformat"):
                    row[col] = val.isoformat()
                elif hasattr(val, "__float__"):
                    try:
                        row[col] = float(val)
                    except Exception:
                        row[col] = str(val)
                else:
                    row[col] = val
            rows.append(row)

        elapsed = round((time.perf_counter() - t0) * 1000, 1)
        return APIResponse.ok(data={
            "rows": rows,
            "count": len(rows),
            "columns": cols,
            "elapsed_ms": elapsed,
        })

    except Exception as exc:
        logger.error("NSO data query failed: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/filters", response_model=APIResponse)
async def get_nso_filters():
    """Return distinct filter values (ATTRIBUTE1, STORE_STATUS, DIVISION) from V_NSO."""
    _require_oracle()
    try:
        t0 = time.perf_counter()
        result: dict = {}

        with get_connection() as conn:
            for col in ("ATTRIBUTE1", "STORE_STATUS", "DIVISION"):
                with conn.cursor() as cur:
                    cur.execute(
                        f"SELECT DISTINCT {col} FROM MISRETAIL.V_NSO "
                        f"WHERE {col} IS NOT NULL ORDER BY {col}"
                    )
                    result[col.lower()] = [r[0] for r in cur.fetchall()]

        elapsed = round((time.perf_counter() - t0) * 1000, 1)
        return APIResponse.ok(data={**result, "elapsed_ms": elapsed})

    except Exception as exc:
        logger.error("NSO filters query failed: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))
