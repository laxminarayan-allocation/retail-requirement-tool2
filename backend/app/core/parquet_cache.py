"""
Parquet output store for Oracle table/view data.

Each downloaded object is saved as a single file (always overwritten on refresh):
  backend/data/output/<OWNER>__<OBJECT>.parquet
  backend/data/output/<OWNER>__<OBJECT>.meta.json  ← download time, row count, columns

Files are permanent until the user explicitly clicks Refresh/Download.
"""
import json
import logging
import time
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

logger = logging.getLogger(__name__)

OUTPUT_DIR = Path(__file__).parent.parent.parent / "data" / "output"


def _pq_path(owner: str, obj: str) -> Path:
    return OUTPUT_DIR / f"{owner.upper()}__{obj.upper()}.parquet"

def _meta_path(owner: str, obj: str) -> Path:
    return OUTPUT_DIR / f"{owner.upper()}__{obj.upper()}.meta.json"


def _ensure_dir() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


def get_meta(owner: str, obj: str) -> dict | None:
    mp = _meta_path(owner, obj)
    if mp.exists():
        try:
            return json.loads(mp.read_text())
        except Exception:
            return None
    return None


def has_output(owner: str, obj: str) -> bool:
    """True if a downloaded file exists for this object."""
    return _pq_path(owner, obj).exists()


def read_cache(owner: str, obj: str) -> pd.DataFrame | None:
    pp = _pq_path(owner, obj)
    if pp.exists():
        try:
            return pq.read_table(pp).to_pandas()
        except Exception as exc:
            logger.warning("Parquet read failed %s.%s: %s", owner, obj, exc)
    return None


def write_cache(owner: str, obj: str, df: pd.DataFrame, sql_text: str | None = None) -> dict:
    """Save DataFrame to Parquet + write meta. Always overwrites previous file."""
    _ensure_dir()
    pp = _pq_path(owner, obj)
    mp = _meta_path(owner, obj)

    safe_df = df.copy()
    for col in safe_df.columns:
        if safe_df[col].dtype == object:
            safe_df[col] = safe_df[col].astype(str).where(safe_df[col].notna(), None)

    arrow_table = pa.Table.from_pandas(safe_df, preserve_index=False)
    pq.write_table(arrow_table, pp, compression="snappy")

    now = datetime.now(timezone.utc)
    meta = {
        "owner": owner.upper(),
        "object": obj.upper(),
        "rows": len(df),
        "columns": list(df.columns),
        "fetched_at": now.isoformat(),
        "fetched_at_ts": now.timestamp(),
        "size_bytes": pp.stat().st_size,
    }
    if sql_text:
        meta["sql_text"] = sql_text.strip()
    mp.write_text(json.dumps(meta, indent=2))
    logger.info("Output written: %s.%s (%d rows, %.1f KB)",
                owner, obj, len(df), meta["size_bytes"] / 1024)
    return meta


def delete_cache(owner: str, obj: str) -> bool:
    deleted = False
    for p in [_pq_path(owner, obj), _meta_path(owner, obj)]:
        if p.exists():
            p.unlink()
            deleted = True
    return deleted


def track_access(owner: str, obj: str, user_email: str = None) -> None:
    """Record a file access for usage-frequency tracking."""
    import uuid
    from app.db.sqlite import get_sqlite
    key = f"{owner.upper()}__{obj.upper()}"
    try:
        with get_sqlite() as db:
            db.execute(
                "INSERT INTO file_access_log (id,file_key,accessed_at,user_email) VALUES (?,?,?,?)",
                (str(uuid.uuid4()), key, datetime.now(timezone.utc).isoformat(), user_email),
            )
    except Exception as exc:
        logger.debug("track_access failed: %s", exc)


def get_access_stats(owner: str, obj: str) -> dict:
    """Return total access count and last accessed ISO string."""
    from app.db.sqlite import get_sqlite
    key = f"{owner.upper()}__{obj.upper()}"
    try:
        with get_sqlite() as db:
            row = db.execute(
                "SELECT COUNT(*) as cnt, MAX(accessed_at) as last FROM file_access_log WHERE file_key=?",
                (key,),
            ).fetchone()
        return {"access_count": row["cnt"] or 0, "last_accessed": row["last"]}
    except Exception:
        return {"access_count": 0, "last_accessed": None}


def list_cache() -> list[dict]:
    """Return all parquet files in OUTPUT_DIR, using .meta.json when available,
    synthesising metadata from file stats for orphan parquet files."""
    _ensure_dir()
    results = []
    seen: set[str] = set()

    # First pass: files with meta JSON
    for mp in OUTPUT_DIR.glob("*.meta.json"):
        try:
            meta = json.loads(mp.read_text())
            age_s = time.time() - meta.get("fetched_at_ts", 0)
            meta["age_seconds"] = round(age_s)
            meta["age_minutes"] = round(age_s / 60, 1)
            seen.add(mp.stem.replace(".meta", "").upper())
            results.append(meta)
        except Exception:
            continue

    # Second pass: orphan parquet files (no meta)
    for pq_path in OUTPUT_DIR.glob("*.parquet"):
        stem = pq_path.stem.upper()
        if stem in seen:
            continue
        try:
            parts = stem.split("__", 1)
            owner = parts[0] if len(parts) == 2 else "UNKNOWN"
            obj   = parts[1] if len(parts) == 2 else stem
            st = pq_path.stat()
            age_s = time.time() - st.st_mtime
            row_count = 0
            columns = []
            meta = {
                "owner": owner,
                "object_name": obj,
                "file": str(pq_path.name),
                "rows": row_count,
                "columns": columns,
                "col_count": len(columns),
                "size_bytes": st.st_size,
                "size_mb": round(st.st_size / 1_048_576, 2),
                "fetched_at": datetime.fromtimestamp(st.st_mtime, tz=timezone.utc).isoformat(),
                "fetched_at_ts": st.st_mtime,
                "age_seconds": round(age_s),
                "age_minutes": round(age_s / 60, 1),
                "orphan": True,  # no meta.json — synthesised from file stats
            }
            results.append(meta)
            seen.add(stem)
        except Exception:
            continue

    results.sort(key=lambda m: m.get("fetched_at_ts", 0), reverse=True)
    return results
