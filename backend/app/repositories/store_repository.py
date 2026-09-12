"""
StoreRepository — fetch and cache the store master.

Load priority:
  1. Parquet DataStore (store_master.parquet) — instant, sub-10ms
  2. Oracle V_STORE_MASTER — fallback when parquet not downloaded yet

The cache is populated once per process; call invalidate_cache() to force refresh.
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

# Parquet column → expected name mapping (lowercase after read).
# Applied simultaneously by pandas rename — no collision risk.
_COL_ALIASES = {
    "site_code":      "store_name",      # SITE_CODE = alphanumeric store code
    "store_name":     "store_name_f",    # STORE_NAME (T_STORE_OPENING_DATE) = full display name
    "vm_store_name":  "store_name_short",# STORE_NAME (V_STORE_MASTER) = short code e.g. SIDDHI-SDH
    "city_name":      "city",
    "state":          "state_name",
    "location":       "site_id",         # numeric Oracle LOCATION = matches sale_raw SITECODE
}


def _load_from_parquet() -> Optional[pd.DataFrame]:
    """Try to read store_master.parquet from the DataStore. Returns None on failure."""
    try:
        from app.core.parquet_store import read_parquet
        df = read_parquet("store_master")
        # Normalise column names to lowercase
        df.columns = [c.lower() for c in df.columns]
        # Rename aliased columns so downstream code finds them
        df = df.rename(columns=_COL_ALIASES)
        logger.info("StoreRepository: loaded %d rows from parquet cache", len(df))
        return df
    except FileNotFoundError:
        return None
    except Exception as exc:
        logger.warning("StoreRepository: parquet load failed (%s) — falling back to Oracle", exc)
        return None


def _load_from_oracle() -> pd.DataFrame:
    sql = load_sql("store_base.sql")
    with get_connection() as conn:
        df = fetch_df(conn, sql, label="store_master")
    logger.info("StoreRepository: loaded %d rows from Oracle", len(df))
    return df


class StoreRepository:

    def get_all_stores(self, active_only: bool = True) -> pd.DataFrame:
        """
        Return store master — from parquet if available, else Oracle.

        Columns returned (best-effort; parquet and Oracle may differ slightly):
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
                    df = _load_from_parquet()
                    if df is None:
                        df = _load_from_oracle()
                    _CACHE = df

        if active_only:
            status_col = "store_status"
            if status_col in df.columns:
                return df[df[status_col].fillna("").str.upper() == "ACTIVE"].reset_index(drop=True)
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


def warm_store_cache() -> None:
    """Pre-load store master at startup so first zone click is instant."""
    try:
        StoreRepository().get_all_stores(active_only=False)
        logger.info("store-cache-warmup: done")
    except Exception as exc:
        logger.warning("store-cache-warmup: failed — %s", exc)
