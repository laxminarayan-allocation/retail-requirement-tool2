"""
StockRepository — fetch current store stock from CK_A2166.V_ST_STK_MC.

V_ST_STK_MC provides stock at store × department level:
  STK_Q      = physical store stock
  INTR_Q     = in-transit quantity
  PRD_Q      = pack-pending (packing room) quantity
  TO_Q       = transfer-out quantity
  ADJ_*      = adjusted versions (after exclusions)

Standard total stock formula (configurable):
  TTL_STK_Q = ADJ_STK_Q + ADJ_INTR_Q + ADJ_PRD_Q + ADJ_TO_Q
"""
import logging
from typing import Optional

import pandas as pd

from app.db.connection import get_connection
from app.repositories.base_repository import fetch_df, load_sql

logger = logging.getLogger(__name__)


class StockRepository:

    def get_mc_stock(
        self,
        department: Optional[str] = None,
        store_name: Optional[str] = None,
        include_transit: bool = True,
        include_pack_pending: bool = True,
        include_transfer_out: bool = False,
    ) -> pd.DataFrame:
        """
        Return current stock at MC (department) × store level.

        Columns returned (all numeric, NULLs filled to 0):
            store_name, department, display_type,
            stk_q, intr_q, prd_q, to_q,
            adj_stk_q, adj_intr_q, adj_prd_q, adj_to_q,
            lm_sl_q, mtd_sl_q

        Derived columns added here:
            ttl_stk_q     = adj_stk_q [+ adj_intr_q] [+ adj_prd_q] [+ adj_to_q]
            adj_ttl_stk_q = same as ttl_stk_q (alias used in Oracle views)
        """
        sql = load_sql("stock_base.sql")
        with get_connection() as conn:
            df = fetch_df(conn, sql, label="stock_mc")

        # Python-side filters
        if department:
            df = df[df["department"] == department]
        if store_name:
            df = df[df["store_name"] == store_name]

        # Ensure numeric
        num_cols = [
            "stk_q", "intr_q", "prd_q", "to_q",
            "adj_stk_q", "adj_intr_q", "adj_prd_q", "adj_to_q",
            "lm_sl_q", "mtd_sl_q",
        ]
        for col in num_cols:
            if col in df.columns:
                df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)

        # Configurable total stock formula
        df["ttl_stk_q"] = df["adj_stk_q"].copy()
        if include_transit:
            df["ttl_stk_q"] += df["adj_intr_q"]
        if include_pack_pending:
            df["ttl_stk_q"] += df["adj_prd_q"]
        if include_transfer_out:
            df["ttl_stk_q"] += df["adj_to_q"]

        df["adj_ttl_stk_q"] = df["ttl_stk_q"]  # alias to match Oracle view naming

        return df.reset_index(drop=True)
