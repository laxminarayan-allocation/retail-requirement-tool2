"""
Parquet Data Store — Oracle → local .parquet cache layer.

Every registered source has:
  key        — unique slug
  label      — human-readable name
  table      — primary Oracle table (for display)
  sql        — query to run against Oracle
  filename   — saved as STORE_DIR/<filename>.parquet
  schedule   — "daily" | "weekly" (informational; actual download is triggered externally)

Download writes atomically: writes to .tmp then renames to avoid serving a half-written file.
Status returns freshness per file.
"""

from __future__ import annotations

import logging
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

IST = timezone(timedelta(hours=5, minutes=30))

# ── Storage directory ──────────────────────────────────────────────────────────
STORE_DIR = Path(r"D:\Prewinter Color Option Listing New Repeat\DataStore")

# ── Source registry ────────────────────────────────────────────────────────────
SOURCES: list[dict] = [
    {
        "key": "store_master",
        "label": "Store Master",
        "table": "MISRETAIL.T_STORE_OPENING_DATE",
        "schedule": "weekly",
        "sql": """
            SELECT s.SITE_CODE, s.STORE_NAME, s.STORE_GRADE, s.STORE_TAG,
                   s.CITY_NAME, s.STATE, s.DISTRICT, s.CLUSTER_TYPE,
                   s.OPENING_DATE, s.STORE_STATUS,
                   v.ZONE, v.LOCATION, v.STORE_NAME AS VM_STORE_NAME
            FROM MISRETAIL.T_STORE_OPENING_DATE s
            LEFT JOIN CK_A2166.V_STORE_MASTER v ON v.SITECODE = s.SITE_CODE
        """,
    },
    {
        "key": "item_master",
        "label": "Item Master",
        "table": "REPORT.V_ITEM_MASTER",
        "schedule": "daily",
        "sql": """
            SELECT ICODE, DIVISION, SECTION, DEPARTMENT, DISPLAY_TYPE,
                   ARTICLE_NAME, DESC6_FILTER, MRP, SZ_GRP,
                   ATTRIBUTE1, COLOR, CONCEPT_NEW, DESC3, CAT1, SEASON
            FROM REPORT.V_ITEM_MASTER
            WHERE SUBSTR(SEASON,1,4) IN ('AW26','SS26')
              AND DIVISION IN ('KIDS','LADIES','MENS')
              AND ATTRIBUTE1 IN ('LT WINTER','PREWINTER')
        """,
    },
    {
        "key": "grc_raw",
        "label": "GRC Raw",
        "table": "MISRETAIL.CUBE$PURCHASE",
        "schedule": "daily",
        "sql": """
            SELECT TRUNC(ENTRY_DATE,'DD') GRC_DATE, SITECODE, BARCODE,
                   SUM(ENTRY_QTY) AS GRC_QTY, SUM(NETAMT) AS GRC_NETAMT
            FROM MISRETAIL.CUBE$PURCHASE
            WHERE CUBENAME = 'GRC_ANA'
              AND TRUNC(ENTRY_DATE,'DD') >= TRUNC(SYSDATE) - 365
              AND TRUNC(ENTRY_DATE,'DD') <= TRUNC(SYSDATE) - 1
              AND BARCODE IN (
                  SELECT DISTINCT ICODE FROM REPORT.V_ITEM_MASTER
                  WHERE SUBSTR(SEASON,1,4) IN ('AW26','SS26')
                    AND DIVISION IN ('KIDS','LADIES','MENS')
                    AND ATTRIBUTE1 IN ('LT WINTER','PREWINTER')
              )
            GROUP BY TRUNC(ENTRY_DATE,'DD'), SITECODE, BARCODE
        """,
    },
    {
        "key": "sale_raw",
        "label": "SALE Raw",
        "table": "MISRETAIL.T_CUSTOM_COGS",
        "schedule": "daily",
        "sql": """
            SELECT TRUNC(BILLDATE,'DD') SALE_DATE, SITECODE, BARCODE AS ICODE,
                   SUM(CUSTOM_SL_Q) AS SALE_QTY, SUM(CUSTOM_SL_V) AS SALE_NETAMT
            FROM MISRETAIL.T_CUSTOM_COGS
            WHERE TRUNC(BILLDATE,'DD') >= TRUNC(SYSDATE) - 730
              AND TRUNC(BILLDATE,'DD') <= TRUNC(SYSDATE) - 1
            GROUP BY TRUNC(BILLDATE,'DD'), SITECODE, BARCODE
        """,
    },
    {
        "key": "req_raw",
        "label": "REQ Raw (MRP Req)",
        "table": "CK_A2166.V_MRP_REQ_APPS_PW",
        "schedule": "daily",
        "sql": """
            SELECT * FROM CK_A2166.V_MRP_REQ_APPS_PW
            WHERE REQ > 0 AND ATTRIBUTE1 IN ('LT WINTER','PREWINTER')
        """,
    },
    {
        "key": "art_grid",
        "label": "Article Grid",
        "table": "REPORT.T_GRID",
        "schedule": "daily",
        "sql": """
            SELECT ATTRIBUTE1, DIVISION, SECTION, DEPARTMENT,
                   ARTICLE_NAME, DISPLAY_TYPE, DESC6_FILTER,
                   GRADE AS STORE_GRADE, MAX_VALUE AS GRID
            FROM REPORT.T_GRID
            WHERE ATTRIBUTE1 IN ('LT WINTER','PREWINTER')
        """,
    },
    {
        "key": "prepack_avg",
        "label": "Prepack Avg",
        "table": "REPORT.T_PREPACK_AVG",
        "schedule": "daily",
        "sql": "SELECT * FROM REPORT.T_PREPACK_AVG WHERE ATTRIBUTE1 IN ('LT WINTER','PREWINTER')",
    },
    {
        "key": "prev_allocation",
        "label": "Prev Allocation (Option Listing)",
        "table": "REPORT.T_CLR_CONCEPT_AW26_V1",
        "schedule": "daily",
        "sql": "SELECT * FROM REPORT.T_CLR_CONCEPT_AW26_V1",
    },
    {
        "key": "mc_req_apps",
        "label": "MC REQ Apps",
        "table": "CK_A2166.V_MC_REQ_APPS_2",
        "schedule": "daily",
        "sql": "SELECT * FROM CK_A2166.V_MC_REQ_APPS_2 WHERE ATTRIBUTE1 IN ('LT WINTER','PREWINTER')",
    },
    {
        "key": "color_family",
        "label": "Color Family",
        "table": "REPORT.T_COLOR_FAMILY",
        "schedule": "daily",
        "sql": "SELECT * FROM REPORT.T_COLOR_FAMILY",
    },
    {
        "key": "pbs_req",
        "label": "PBS / Sparky REQ",
        "table": "CK_A2166.V_SPARKY_PBS_REQ",
        "schedule": "daily",
        "sql": "SELECT * FROM CK_A2166.V_SPARKY_PBS_REQ",
    },
    {
        "key": "wh_stock",
        "label": "Warehouse Stock",
        "table": "CK_A2166.V_WH_STOCK",
        "schedule": "daily",
        "sql": "SELECT * FROM CK_A2166.V_WH_STOCK WHERE ATTRIBUTE1 IN ('LT WINTER','PREWINTER')",
    },
]

SOURCE_MAP: dict[str, dict] = {s["key"]: s for s in SOURCES}

# ── In-memory download state ───────────────────────────────────────────────────
_dl_lock = threading.Lock()
_dl_status: dict[str, dict] = {}   # key → {status, started_at, finished_at, rows, error}


def _parquet_path(key: str) -> Path:
    return STORE_DIR / f"{key}.parquet"


def _meta_path(key: str) -> Path:
    return STORE_DIR / f"{key}.meta"


def _write_meta(key: str, rows: int) -> None:
    meta = {
        "downloaded_at": datetime.now(IST).isoformat(),
        "rows": rows,
    }
    import json
    _meta_path(key).write_text(json.dumps(meta), encoding="utf-8")


def _read_meta(key: str) -> dict | None:
    p = _meta_path(key)
    if not p.exists():
        return None
    import json
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return None


def get_status() -> list[dict]:
    """Return checklist status for every registered source."""
    STORE_DIR.mkdir(parents=True, exist_ok=True)
    result = []
    now_ist = datetime.now(IST)

    for src in SOURCES:
        key = src["key"]
        pq = _parquet_path(key)
        meta = _read_meta(key)

        with _dl_lock:
            dl = _dl_status.get(key, {})

        if meta:
            downloaded_at = datetime.fromisoformat(meta["downloaded_at"])
            age_hours = (now_ist - downloaded_at).total_seconds() / 3600
            is_fresh = age_hours < 26   # within ~1 day
            size_mb = round(pq.stat().st_size / 1_048_576, 2) if pq.exists() else 0
            file_status = "fresh" if is_fresh else "stale"
        else:
            downloaded_at = None
            age_hours = None
            is_fresh = False
            size_mb = 0
            file_status = "missing"

        result.append({
            "key": key,
            "label": src["label"],
            "table": src["table"],
            "schedule": src["schedule"],
            "file_status": file_status,          # "fresh" | "stale" | "missing"
            "download_status": dl.get("status"), # "running" | "done" | "failed" | None
            "downloaded_at": meta["downloaded_at"] if meta else None,
            "rows": meta["rows"] if meta else None,
            "size_mb": size_mb,
            "error": dl.get("error"),
        })

    return result


def download_source(key: str) -> None:
    """Download one source from Oracle and save as parquet. Runs synchronously — call in a thread."""
    src = SOURCE_MAP.get(key)
    if not src:
        raise ValueError(f"Unknown source key: {key}")

    STORE_DIR.mkdir(parents=True, exist_ok=True)
    started = datetime.now(IST).isoformat()

    with _dl_lock:
        _dl_status[key] = {"status": "running", "started_at": started, "finished_at": None, "rows": None, "error": None}

    try:
        import pandas as pd
        from app.db.oracle import get_pool

        pool = get_pool()
        with pool.acquire() as conn:
            df = pd.read_sql(src["sql"].strip(), conn)

        rows = len(df)
        tmp = _parquet_path(key).with_suffix(".tmp.parquet")
        df.to_parquet(tmp, index=False, engine="pyarrow", compression="snappy")
        tmp.replace(_parquet_path(key))  # replace() works on Windows even if dest exists
        _write_meta(key, rows)

        finished = datetime.now(IST).isoformat()
        with _dl_lock:
            _dl_status[key] = {"status": "done", "started_at": started, "finished_at": finished, "rows": rows, "error": None}

        logger.info("parquet_store: %s downloaded OK — %d rows", key, rows)

    except Exception as exc:
        finished = datetime.now(IST).isoformat()
        with _dl_lock:
            _dl_status[key] = {"status": "failed", "started_at": started, "finished_at": finished, "rows": None, "error": str(exc)}
        logger.error("parquet_store: %s FAILED — %s", key, exc)
        raise


def download_source_async(key: str) -> None:
    """Start download in a background thread."""
    threading.Thread(target=_download_safe, args=(key,), daemon=True, name=f"pq-dl-{key}").start()


def _download_safe(key: str) -> None:
    try:
        download_source(key)
    except Exception:
        pass  # status already recorded in _dl_status


def download_all_async(keys: list[str] | None = None) -> None:
    """Download all (or specified) sources sequentially in a background thread."""
    targets = keys or [s["key"] for s in SOURCES]

    def _run():
        for k in targets:
            try:
                download_source(k)
            except Exception:
                pass  # continue to next

    threading.Thread(target=_run, daemon=True, name="pq-dl-all").start()


def read_parquet(key: str):
    """Read a cached parquet file as a pandas DataFrame. Raises if not downloaded."""
    import pandas as pd
    p = _parquet_path(key)
    if not p.exists():
        raise FileNotFoundError(f"Parquet not downloaded yet for: {key}")
    return pd.read_parquet(p, engine="pyarrow")
