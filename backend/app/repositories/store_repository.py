"""
StoreRepository — fetch and cache the store master from CK_A2166.V_STORE_MASTER.

The store master rarely changes during a session so it is cached after the
first fetch.  Call invalidate_cache() to force a refresh.
"""
import logging
import threading
from typing import Optional

import pandas as pd

from app.db.connection import get_connection
from app.repositories.base_repository import fetch_df, load_sql

logger = logging.getLogger(__name__)

_CACHE: Optional[pd.DataFrame] = None
_CACHE_LOCK = threading.Lock()


class StoreRepository:

    def get_all_stores(self, active_only: bool = True) -> pd.DataFrame:
        """
        Return all stores from V_STORE_MASTER.

        Columns returned:
            sitecode, location, sitealias, store_name, store_name_f,
            zone, city, state_name, cluster_type, store_grade, gm_grd,
            store_tag, store_status, opening_date, store_type, area,
            vm_filter, store_desc_filter
        """
        global _CACHE
        if _CACHE is not None:
            logger.debug("StoreRepository: returning cached store master (%d rows)", len(_CACHE))
            df = _CACHE
        else:
            with _CACHE_LOCK:
                if _CACHE is not None:
                    df = _CACHE
                else:
                    sql = load_sql("store_base.sql")
                    with get_connection() as conn:
                        df = fetch_df(conn, sql, label="store_master")
                    _CACHE = df

        if active_only:
            return df[df["store_status"] == "ACTIVE"].reset_index(drop=True)
        return df.copy()

    def get_store_names(self) -> list[str]:
        df = self.get_all_stores()
        return sorted(df["store_name"].dropna().unique().tolist())

    def get_store_grades(self) -> list[str]:
        df = self.get_all_stores()
        return sorted(df["store_grade"].dropna().unique().tolist())

    def get_zones(self) -> list[str]:
        df = self.get_all_stores()
        return sorted(df["zone"].dropna().unique().tolist())

    def get_clusters(self) -> list[str]:
        df = self.get_all_stores()
        return sorted(df["cluster_type"].dropna().unique().tolist())

    def invalidate_cache(self) -> None:
        global _CACHE
        _CACHE = None
        logger.info("StoreRepository cache invalidated")
