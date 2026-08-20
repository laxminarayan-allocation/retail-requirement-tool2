"""
TargetRepository — fetch AOP targets from CK_A2166.V_AOP_TGT_ART.
"""
import logging
from typing import Optional

import pandas as pd

from app.db.connection import get_connection
from app.repositories.base_repository import fetch_df, load_sql

logger = logging.getLogger(__name__)


class TargetRepository:

    def get_article_targets(
        self,
        division: Optional[str] = None,
        department: Optional[str] = None,
        store_name: Optional[str] = None,
    ) -> pd.DataFrame:
        """
        Return AOP targets at article × store level.

        Columns: store_name, division, department, display_type,
                 article_name, tgt_q, tgt_v, sl_q, sl_val, sl_v, achv_per
        """
        sql = load_sql("target_base.sql")
        with get_connection() as conn:
            df = fetch_df(conn, sql, label="target_art")

        if division:
            df = df[df["division"] == division]
        if department:
            df = df[df["department"] == department]
        if store_name:
            df = df[df["store_name"] == store_name]

        num_cols = ["tgt_q", "tgt_v", "sl_q", "sl_val", "sl_v", "achv_per"]
        for col in num_cols:
            if col in df.columns:
                df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)

        return df.reset_index(drop=True)
