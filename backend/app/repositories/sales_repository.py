"""
SalesRepository — fetch last-4-week rolling sales from CK_A2166.V_LAST_4WK_SL_ST_MC.

The view already aggregates weekly sales at store × department level.
WK1 = most recent week, WK5 = oldest week in the rolling window.
"""
import logging
from typing import Optional

import pandas as pd

from app.db.connection import get_connection
from app.repositories.base_repository import fetch_df, load_sql

logger = logging.getLogger(__name__)


class SalesRepository:

    def get_mc_sales(
        self,
        department: Optional[str] = None,
        store_name: Optional[str] = None,
    ) -> pd.DataFrame:
        """
        Return last-5-week sales at MC (department) × store level.

        Columns returned:
            store_name, department, display_type,
            wk1, wk2, wk3, wk4, wk5,
            max_slq, max_week, max_week_start_date, max_week_end_date

        Derived columns added here (not in Oracle):
            sl_4wk_q  = wk1+wk2+wk3+wk4  (last 4 complete weeks)
            avg_wk_sl = sl_4wk_q / 4      (weekly average)
        """
        sql = load_sql("sales_base.sql")
        with get_connection() as conn:
            df = fetch_df(conn, sql, label="sales_mc")

        # Apply Python-side filters (avoids adding bind vars to shared SQL)
        if department:
            df = df[df["department"] == department]
        if store_name:
            df = df[df["store_name"] == store_name]

        # Derived metrics
        week_cols = ["wk1", "wk2", "wk3", "wk4", "wk5"]
        for col in week_cols:
            df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)

        df["sl_4wk_q"] = df["wk1"] + df["wk2"] + df["wk3"] + df["wk4"]
        df["avg_wk_sl"] = (df["sl_4wk_q"] / 4).round(2)
        df["max_slq"] = pd.to_numeric(df["max_slq"], errors="coerce").fillna(0)

        return df.reset_index(drop=True)
