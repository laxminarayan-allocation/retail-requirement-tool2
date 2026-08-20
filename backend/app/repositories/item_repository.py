"""
ItemRepository — fetch item/SKU master from CK_A2166.ITEM_MASTER.

The full item master is fetched once and cached. Python-side filtering
avoids Oracle 12.1 issues with optional bind-variable IS NULL patterns.
"""
import logging
from typing import Optional

import pandas as pd

from app.db.connection import get_connection
from app.repositories.base_repository import fetch_df, load_sql

logger = logging.getLogger(__name__)

_CACHE: Optional[pd.DataFrame] = None


class ItemRepository:

    def _load(self) -> pd.DataFrame:
        global _CACHE
        if _CACHE is not None:
            return _CACHE
        sql = load_sql("item_base.sql")
        with get_connection() as conn:
            df = fetch_df(conn, sql, label="item_master_full")
        # rename aliased columns to canonical names used throughout the app
        rename = {"item_size": "size", "item_color": "color"}
        df.rename(columns={k: v for k, v in rename.items() if k in df.columns}, inplace=True)

        for col in ["mrp", "last_in_rate", "standard_rate"]:
            if col in df.columns:
                df[col] = pd.to_numeric(df[col], errors="coerce")
        _CACHE = df
        logger.info("ItemRepository cached %d SKUs", len(df))
        return df

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
        df = self._load()
        return sorted(df["season"].dropna().unique().tolist())

    def get_attributes(self) -> list[str]:
        df = self._load()
        return sorted(df["attribute1"].dropna().unique().tolist())

    def get_divisions(self, season: Optional[str] = None, attribute1: Optional[str] = None) -> list[str]:
        df = self.get_items(season=season, attribute1=attribute1)
        return sorted(df["division"].dropna().unique().tolist())

    def get_sections(self, season: Optional[str] = None, attribute1: Optional[str] = None, division: Optional[str] = None) -> list[str]:
        df = self.get_items(season=season, attribute1=attribute1, division=division)
        return sorted(df["section"].dropna().unique().tolist())

    def get_departments(self, season: Optional[str] = None, attribute1: Optional[str] = None, division: Optional[str] = None) -> list[str]:
        df = self.get_items(season=season, attribute1=attribute1, division=division)
        return sorted(df["department"].dropna().unique().tolist())

    def get_article_names(self, season: Optional[str] = None, attribute1: Optional[str] = None, division: Optional[str] = None) -> list[str]:
        df = self.get_items(season=season, attribute1=attribute1, division=division)
        return sorted(df["article_name"].dropna().unique().tolist())

    def get_mrp_values(self, season: Optional[str] = None, attribute1: Optional[str] = None, division: Optional[str] = None) -> list[float]:
        df = self.get_items(season=season, attribute1=attribute1, division=division)
        return sorted(df["mrp"].dropna().unique().tolist())

    def invalidate_cache(self) -> None:
        global _CACHE
        _CACHE = None
        logger.info("ItemRepository cache invalidated")
