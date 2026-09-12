"""
PBSRepository — fetch PBS from CK_A2166.V_PBS_MC and MDQ from CK_A2166.V_MDQ_STR.

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

_PBS_CACHE: Optional[pd.DataFrame] = None
_MDQ_CACHE: Optional[pd.DataFrame] = None
_CACHE_LOCK = threading.Lock()
_PBS_TS: float = 0.0
_MDQ_TS: float = 0.0
_TTL = 23 * 3600

_PBS_NUM = ["proj_1", "proj_2", "proj_3", "proj_4", "proj_5", "proj_6", "pbs", "new_bgt_str"]
_MDQ_NUM = ["mdq", "mdq_str_actual", "max_cap", "safety_days",
            "new_bgt_str", "bgt_mc_str", "ly_sl_q",
            "month_1", "month_2", "month_3"]


class PBSRepository:

    def get_pbs_mc(
        self,
        division: Optional[str] = None,
        department: Optional[str] = None,
    ) -> pd.DataFrame:
        global _PBS_CACHE, _PBS_TS
        if _PBS_CACHE is None or (time.time() - _PBS_TS) >= _TTL:
            with _CACHE_LOCK:
                if _PBS_CACHE is None or (time.time() - _PBS_TS) >= _TTL:
                    sql = load_sql("pbs_base.sql")
                    with get_connection() as conn:
                        df = fetch_df(conn, sql, label="pbs_mc")
                    for col in _PBS_NUM:
                        if col in df.columns:
                            df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)
                    _PBS_CACHE = df
                    _PBS_TS = time.time()
                    logger.info("PBSRepository: loaded %d PBS rows from Oracle", len(df))

        df = _PBS_CACHE.copy()
        if division:
            df = df[df["division"] == division]
        if department:
            df = df[df["department"] == department]
        return df.reset_index(drop=True)

    def get_mdq_str(
        self,
        division: Optional[str] = None,
        department: Optional[str] = None,
    ) -> pd.DataFrame:
        global _MDQ_CACHE, _MDQ_TS
        if _MDQ_CACHE is None or (time.time() - _MDQ_TS) >= _TTL:
            with _CACHE_LOCK:
                if _MDQ_CACHE is None or (time.time() - _MDQ_TS) >= _TTL:
                    sql = load_sql("mdq_base.sql")
                    with get_connection() as conn:
                        df = fetch_df(conn, sql, label="mdq_str")
                    for col in _MDQ_NUM:
                        if col in df.columns:
                            df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)
                    _MDQ_CACHE = df
                    _MDQ_TS = time.time()
                    logger.info("PBSRepository: loaded %d MDQ rows from Oracle", len(df))

        df = _MDQ_CACHE.copy()
        if division:
            df = df[df["division"] == division]
        if department:
            df = df[df["department"] == department]
        return df.reset_index(drop=True)

    def invalidate_cache(self) -> None:
        global _PBS_CACHE, _MDQ_CACHE, _PBS_TS, _MDQ_TS
        _PBS_CACHE = _MDQ_CACHE = None
        _PBS_TS = _MDQ_TS = 0.0
        logger.info("PBSRepository cache invalidated")


def warm_pbs_cache() -> None:
    try:
        repo = PBSRepository()
        repo.get_pbs_mc()
        repo.get_mdq_str()
        logger.info("pbs-cache-warmup: done")
    except Exception as exc:
        logger.warning("pbs-cache-warmup: failed — %s", exc)
