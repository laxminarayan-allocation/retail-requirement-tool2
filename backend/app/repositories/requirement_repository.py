"""
RequirementRepository — fetch the Oracle-computed requirement from V_MC_REQ_APPS.

This is used as the REFERENCE result during Phase 7 reconciliation.
Python calculation results are validated against this.
"""
import logging
from typing import Optional

import pandas as pd

from app.db.connection import get_connection
from app.repositories.base_repository import fetch_df, load_sql

logger = logging.getLogger(__name__)


class RequirementRepository:

    def get_oracle_requirement(
        self,
        division: Optional[str] = None,
        department: Optional[str] = None,
        store_name: Optional[str] = None,
        store_grade: Optional[str] = None,
        active_only: bool = True,
    ) -> pd.DataFrame:
        """
        Fetch the Oracle-computed requirement from V_MC_REQ_APPS.

        This is the ground truth used for Python vs Oracle reconciliation.
        """
        sql = load_sql("requirement_base.sql")
        with get_connection() as conn:
            df = fetch_df(conn, sql, label="oracle_requirement")

        # Python-side filters
        if active_only and "store_status" in df.columns:
            df = df[df["store_status"] == "ACTIVE"]
        if division and "division" in df.columns:
            df = df[df["division"] == division]
        if department and "department" in df.columns:
            df = df[df["department"] == department]
        if store_name and "store_name" in df.columns:
            df = df[df["store_name"] == store_name]
        if store_grade and "store_grade" in df.columns:
            df = df[df["store_grade"] == store_grade]

        num_cols = [
            "mc_str", "pbs", "pbs_fill", "pbs_achv",
            "fresh_ttl_stk_q", "ttl_25_stk_q", "old_ttl_stk_q",
            "mdq", "lm_sl_q", "mtd_sl_q",
            "adj_ttl_stk_q", "ttl_stk_q", "stk_q",
            "intr_q", "prd_q", "to_q", "adj_stk_q",
            "sl_7d_q", "tgt_q", "tgt_v", "sl_q", "sl_v",
            "achv_per", "use_ach", "fnl_pbs", "req",
            "fill_rate",
        ]
        for col in num_cols:
            if col in df.columns:
                df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)

        return df.reset_index(drop=True)
