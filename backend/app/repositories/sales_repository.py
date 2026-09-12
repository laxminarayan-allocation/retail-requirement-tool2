"""
SalesRepository — fetch last-4-week rolling sales from CK_A2166.V_LAST_4WK_SL_ST_MC.

Cache: fetched once per process (T-1 data, 23h TTL).
Oracle hit only on first call or after explicit invalidation.
"""
import logging
import threading
import time
from typing import Optional

import pandas as pd

from app.db.connection import get_connection
from app.repositories.base_repository import fetch_df, load_sql

logger = logging.getLogger(__name__)

_CACHE: Optional[pd.DataFrame] = None
_CACHE_LOCK = threading.Lock()
_CACHE_TS: float = 0.0
_TTL = 23 * 3600


def _load_fresh() -> pd.DataFrame:
    sql = load_sql("sales_base.sql")
    with get_connection() as conn:
        df = fetch_df(conn, sql, label="sales_mc")
    week_cols = ["wk1", "wk2", "wk3", "wk4", "wk5"]
    for col in week_cols:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)
    if all(c in df.columns for c in ["wk1", "wk2", "wk3", "wk4"]):
        df["sl_4wk_q"] = df["wk1"] + df["wk2"] + df["wk3"] + df["wk4"]
        df["avg_wk_sl"] = (df["sl_4wk_q"] / 4).round(2)
    if "max_slq" in df.columns:
        df["max_slq"] = pd.to_numeric(df["max_slq"], errors="coerce").fillna(0)
    logger.info("SalesRepository: loaded %d rows from Oracle", len(df))
    return df


class SalesRepository:

    def _load(self) -> pd.DataFrame:
        global _CACHE, _CACHE_TS
        if _CACHE is not None and (time.time() - _CACHE_TS) < _TTL:
            return _CACHE
        with _CACHE_LOCK:
            if _CACHE is not None and (time.time() - _CACHE_TS) < _TTL:
                return _CACHE
            df = _load_fresh()
            _CACHE = df
            _CACHE_TS = time.time()
        return _CACHE

    def get_mc_sales(
        self,
        department: Optional[str] = None,
        store_name: Optional[str] = None,
    ) -> pd.DataFrame:
        df = self._load().copy()
        if department:
            df = df[df["department"] == department]
        if store_name:
            df = df[df["store_name"] == store_name]
        return df.reset_index(drop=True)

    def invalidate_cache(self) -> None:
        global _CACHE, _CACHE_TS
        _CACHE = None
        _CACHE_TS = 0.0
        logger.info("SalesRepository cache invalidated")


def warm_sales_cache() -> None:
    try:
        SalesRepository()._load()
        logger.info("sales-cache-warmup: done")
    except Exception as exc:
        logger.warning("sales-cache-warmup: failed — %s", exc)
