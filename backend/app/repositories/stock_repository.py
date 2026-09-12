"""
StockRepository — fetch current store stock from CK_A2166.V_ST_STK_MC.

Cache: fetched once per process (T-1 data doesn't change intra-day).
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
_TTL = 23 * 3600  # 23 hours — T-1 data, refresh once per day


def _load_fresh() -> pd.DataFrame:
    sql = load_sql("stock_base.sql")
    with get_connection() as conn:
        df = fetch_df(conn, sql, label="stock_mc")
    num_cols = ["stk_q", "intr_q", "prd_q", "to_q",
                "adj_stk_q", "adj_intr_q", "adj_prd_q", "adj_to_q",
                "lm_sl_q", "mtd_sl_q"]
    for col in num_cols:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)
    logger.info("StockRepository: loaded %d rows from Oracle", len(df))
    return df


class StockRepository:

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

    def get_mc_stock(
        self,
        department: Optional[str] = None,
        store_name: Optional[str] = None,
        include_transit: bool = True,
        include_pack_pending: bool = True,
        include_transfer_out: bool = False,
    ) -> pd.DataFrame:
        df = self._load().copy()

        if department:
            df = df[df["department"] == department]
        if store_name:
            df = df[df["store_name"] == store_name]

        df["ttl_stk_q"] = df["adj_stk_q"].copy()
        if include_transit:
            df["ttl_stk_q"] += df.get("adj_intr_q", 0)
        if include_pack_pending:
            df["ttl_stk_q"] += df.get("adj_prd_q", 0)
        if include_transfer_out:
            df["ttl_stk_q"] += df.get("adj_to_q", 0)

        df["adj_ttl_stk_q"] = df["ttl_stk_q"]
        return df.reset_index(drop=True)

    def invalidate_cache(self) -> None:
        global _CACHE, _CACHE_TS
        _CACHE = None
        _CACHE_TS = 0.0
        logger.info("StockRepository cache invalidated")


def warm_stock_cache() -> None:
    try:
        StockRepository()._load()
        logger.info("stock-cache-warmup: done")
    except Exception as exc:
        logger.warning("stock-cache-warmup: failed — %s", exc)
