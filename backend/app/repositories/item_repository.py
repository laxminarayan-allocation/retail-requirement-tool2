"""
ItemRepository — fetch item/SKU master.

Load priority:
  1. Parquet DataStore (item_master.parquet) — instant, sub-10ms
  2. Oracle V_ITEM_MASTER — fallback when parquet not downloaded yet

Cache is populated once per process; call invalidate_cache() to force refresh.
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


def _load_from_parquet() -> Optional[pd.DataFrame]:
    try:
        from app.core.parquet_store import read_parquet
        df = read_parquet("item_master")
        df.columns = [c.lower() for c in df.columns]
        rename = {"item_size": "size", "item_color": "color"}
        df.rename(columns={k: v for k, v in rename.items() if k in df.columns}, inplace=True)
        for col in ["mrp", "last_in_rate", "standard_rate"]:
            if col in df.columns:
                df[col] = pd.to_numeric(df[col], errors="coerce")
        logger.info("ItemRepository: loaded %d SKUs from parquet", len(df))
        return df
    except FileNotFoundError:
        return None
    except Exception as exc:
        logger.warning("ItemRepository: parquet load failed (%s) — falling back to Oracle", exc)
        return None


def _load_from_oracle() -> pd.DataFrame:
    sql = load_sql("item_base.sql")
    with get_connection() as conn:
        df = fetch_df(conn, sql, label="item_master_full")
    rename = {"item_size": "size", "item_color": "color"}
    df.rename(columns={k: v for k, v in rename.items() if k in df.columns}, inplace=True)
    for col in ["mrp", "last_in_rate", "standard_rate"]:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")
    logger.info("ItemRepository: loaded %d SKUs from Oracle", len(df))
    return df


class ItemRepository:

    def _load(self) -> pd.DataFrame:
        global _CACHE
        if _CACHE is not None:
            return _CACHE
        with _CACHE_LOCK:
            if _CACHE is not None:
                return _CACHE
            df = _load_from_parquet()
            if df is None:
                df = _load_from_oracle()
            _CACHE = df
        return _CACHE

    def get_items(
        self,
        season: Optional[str] = None,
        attribute1: Optional[str] = None,
        division: Optional[str] = None,
        department: Optional[str] = None,
        article_name: Optional[str] = None,
    ) -> pd.DataFrame:
        df = self._load().copy()
        if season:
            df = df[df["season"] == season]
        if attribute1:
            df = df[df["attribute1"] == attribute1]
        if division:
            df = df[df["division"] == division]
        if department:
            df = df[df["department"] == department]
        if article_name:
            df = df[df["article_name"] == article_name]
        return df.reset_index(drop=True)

    def get_seasons(self) -> list[str]:
        return sorted(self._load()["season"].dropna().unique().tolist())

    def get_attributes(self) -> list[str]:
        return sorted(self._load()["attribute1"].dropna().unique().tolist())

    def get_divisions(self, season: Optional[str] = None, attribute1: Optional[str] = None) -> list[str]:
        return sorted(self.get_items(season=season, attribute1=attribute1)["division"].dropna().unique().tolist())

    def get_sections(self, season: Optional[str] = None, attribute1: Optional[str] = None, division: Optional[str] = None) -> list[str]:
        return sorted(self.get_items(season=season, attribute1=attribute1, division=division)["section"].dropna().unique().tolist())

    def get_departments(self, season: Optional[str] = None, attribute1: Optional[str] = None, division: Optional[str] = None) -> list[str]:
        return sorted(self.get_items(season=season, attribute1=attribute1, division=division)["department"].dropna().unique().tolist())

    def get_article_names(self, season: Optional[str] = None, attribute1: Optional[str] = None, division: Optional[str] = None) -> list[str]:
        return sorted(self.get_items(season=season, attribute1=attribute1, division=division)["article_name"].dropna().unique().tolist())

    def get_mrp_values(self, season: Optional[str] = None, attribute1: Optional[str] = None, division: Optional[str] = None) -> list[float]:
        return sorted(self.get_items(season=season, attribute1=attribute1, division=division)["mrp"].dropna().unique().tolist())

    def invalidate_cache(self) -> None:
        global _CACHE
        _CACHE = None
        logger.info("ItemRepository cache invalidated")


def warm_item_cache() -> None:
    """Pre-load item master at startup."""
    try:
        ItemRepository()._load()
        logger.info("item-cache-warmup: done")
    except Exception as exc:
        logger.warning("item-cache-warmup: failed — %s", exc)
