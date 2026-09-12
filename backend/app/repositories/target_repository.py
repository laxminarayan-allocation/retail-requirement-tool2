"""
TargetRepository — fetch AOP targets from CK_A2166.V_AOP_TGT_ART.

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


class TargetRepository:

    def _load(self) -> pd.DataFrame:
        global _CACHE, _CACHE_TS
        if _CACHE is not None and (time.time() - _CACHE_TS) < _TTL:
            return _CACHE
        with _CACHE_LOCK:
            if _CACHE is not None and (time.time() - _CACHE_TS) < _TTL:
                return _CACHE
            sql = load_sql("target_base.sql")
            with get_connection() as conn:
                df = fetch_df(conn, sql, label="target_art")
            num_cols = ["tgt_q", "tgt_v", "sl_q", "sl_val", "sl_v", "achv_per"]
            for col in num_cols:
                if col in df.columns:
                    df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)
            _CACHE = df
            _CACHE_TS = time.time()
            logger.info("TargetRepository: loaded %d rows from Oracle", len(df))
        return _CACHE

    def get_article_targets(
        self,
        division: Optional[str] = None,
        department: Optional[str] = None,
        store_name: Optional[str] = None,
    ) -> pd.DataFrame:
        df = self._load().copy()
        if division:
            df = df[df["division"] == division]
        if department:
            df = df[df["department"] == department]
        if store_name:
            df = df[df["store_name"] == store_name]
        return df.reset_index(drop=True)

    def invalidate_cache(self) -> None:
        global _CACHE, _CACHE_TS
        _CACHE = None
        _CACHE_TS = 0.0
        logger.info("TargetRepository cache invalidated")
