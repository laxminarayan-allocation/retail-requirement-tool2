"""
PBSRepository — fetch PBS (Planogram Build Standard) from CK_A2166.V_PBS_MC
and MDQ (Minimum Display Quantity) from CK_A2166.V_MDQ_STR.
"""
import logging
from typing import Optional

import pandas as pd

from app.db.connection import get_connection
from app.repositories.base_repository import fetch_df, load_sql

logger = logging.getLogger(__name__)


class PBSRepository:

    def get_pbs_mc(
        self,
        division: Optional[str] = None,
        department: Optional[str] = None,
    ) -> pd.DataFrame:
        """
        Return PBS targets at store × department level from V_PBS_MC.

        Columns: attribute1, division, section, department, display_type_code,
                 store_name, proj_1..6, pbs, new_bgt_str
        """
        sql = load_sql("pbs_base.sql")
        with get_connection() as conn:
            df = fetch_df(conn, sql, label="pbs_mc")

        if division:
            df = df[df["division"] == division]
        if department:
            df = df[df["department"] == department]

        num_cols = ["proj_1", "proj_2", "proj_3", "proj_4", "proj_5", "proj_6",
                    "pbs", "new_bgt_str"]
        for col in num_cols:
            if col in df.columns:
                df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)

        return df.reset_index(drop=True)

    def get_mdq_str(
        self,
        division: Optional[str] = None,
        department: Optional[str] = None,
    ) -> pd.DataFrame:
        """
        Return MDQ and store capacity from V_MDQ_STR.

        Key columns:
            store_name, division, department, attribute1, display_type,
            mdq, mdq_str_actual, max_cap, safety_days,
            new_bgt_str, bgt_mc_str, ly_sl_q
        """
        sql = load_sql("mdq_base.sql")
        with get_connection() as conn:
            df = fetch_df(conn, sql, label="mdq_str")

        if division:
            df = df[df["division"] == division]
        if department:
            df = df[df["department"] == department]

        num_cols = ["mdq", "mdq_str_actual", "max_cap", "safety_days",
                    "new_bgt_str", "bgt_mc_str", "ly_sl_q",
                    "month_1", "month_2", "month_3"]
        for col in num_cols:
            if col in df.columns:
                df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)

        return df.reset_index(drop=True)
