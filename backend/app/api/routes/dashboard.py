"""
Dashboard summary endpoint — Phase 9.

GET /api/dashboard/summary
  Aggregates live KPIs from Oracle (cached), SQLite history, and in-memory run store.
  All Oracle reads hit the item/store caches — no extra DB round-trips after first load.
"""
import logging
import time
from datetime import date
from typing import Optional

import pandas as pd

from fastapi import APIRouter

from app.models.response_models import APIResponse
from app.repositories.history_repository import list_history
from app.repositories.factor_repository import FactorRepository
from app.engine import run_store

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/dashboard", tags=["Dashboard"])

_factor_repo = FactorRepository()

# ── Oracle stats cache (4-hour TTL — refreshed by background scheduler) ────────
_oracle_cache: dict = {}
_oracle_cache_ts: float = 0.0
_ORACLE_TTL = 4 * 3600  # 4 hours; background thread refreshes every 2 hrs


def warm_dashboard_cache() -> None:
    """Called by the background scheduler to keep the oracle stats cache warm.
    Runs the full Oracle aggregation and stores the result so viewers never wait."""
    try:
        _safe_oracle_stats.__wrapped__() if hasattr(_safe_oracle_stats, '__wrapped__') else _fetch_oracle_stats_fresh()
    except Exception:
        pass


def _fetch_oracle_stats_fresh() -> None:
    """Force-refresh the oracle stats cache regardless of TTL."""
    global _oracle_cache, _oracle_cache_ts
    _oracle_cache_ts = 0.0  # expire cache to force re-fetch
    _safe_oracle_stats()    # populates _oracle_cache


def _safe_oracle_stats() -> dict:
    """Pull aggregate counts from parquet (preferred) or Oracle caches.
    Result is cached for _ORACLE_TTL seconds to avoid repeated computation."""
    global _oracle_cache, _oracle_cache_ts
    age = time.time() - _oracle_cache_ts
    if _oracle_cache and age < _ORACLE_TTL:
        cached = dict(_oracle_cache)
        cached["oracle_cache_ms"] = round(age * 1000, 1)
        cached["from_cache"] = True
        return cached
    try:
        from app.repositories.item_repository import ItemRepository
        from app.repositories.store_repository import StoreRepository

        item_repo = ItemRepository()
        store_repo = StoreRepository()

        t0 = time.perf_counter()
        # Both repositories load from parquet first — sub-10ms if parquet present
        item_df       = item_repo._load()
        store_df      = store_repo.get_all_stores(active_only=True)
        all_stores_df = store_repo.get_all_stores(active_only=False)  # fetched once, reused below
        oracle_ms = round((time.perf_counter() - t0) * 1000, 1)

        # Item stats
        total_items = len(item_df)
        attrs = sorted(item_df["attribute1"].dropna().unique().tolist()) if "attribute1" in item_df.columns else []
        divisions = item_df["division"].nunique() if "division" in item_df.columns else 0
        departments = item_df["department"].nunique() if "department" in item_df.columns else 0
        articles = item_df["article_name"].nunique() if "article_name" in item_df.columns else 0

        # Items by attribute1
        items_by_attr: dict = {}
        if "attribute1" in item_df.columns:
            items_by_attr = item_df.groupby("attribute1").size().to_dict()

        # Store stats
        active_stores = len(store_df)

        # Read T_STORE_OPENING_DATE parquet once — reused throughout this function
        _sod: pd.DataFrame | None = None
        try:
            from app.core.parquet_cache import has_output, read_cache
            if has_output("MISRETAIL", "T_STORE_OPENING_DATE"):
                _sod = read_cache("MISRETAIL", "T_STORE_OPENING_DATE")
        except Exception as exc:
            logger.warning("parquet read (T_STORE_OPENING_DATE) failed: %s", exc)

        # Upcoming stores — from Parquet cache if available, else skip (avoid Oracle timeout)
        upcoming_stores = 0
        opening_2026 = 0
        opening_60d = 0
        try:
            if _sod is not None:
                col_status = next((c for c in _sod.columns if c.lower() == "store_status"), None)
                if col_status:
                    upcoming_stores = int((_sod[col_status].str.upper() == "UPCOMING_STORE").sum())
        except Exception as exc:
            logger.warning("upcoming store count failed: %s", exc)

        # opening_60d / opening_2026 / last_opened — from T_STORE_OPENING_DATE parquet
        last_opened_name = ""
        last_opened_date = ""
        _sod_src = _sod
        if _sod_src is not None and "opening_date" in _sod_src.columns:
            _sod_src = _sod_src.copy()
            _sod_src.columns = [c.lower() for c in _sod_src.columns]
            od_active = pd.to_datetime(_sod_src["opening_date"], errors="coerce")
            today = pd.Timestamp.now().normalize()
            cutoff_60 = today - pd.Timedelta(days=60)
            opening_60d  = int(((od_active >= cutoff_60) & (od_active <= today)).sum())
            opening_2026 = int((od_active.dt.year == 2026).sum())
            valid_mask = od_active.notna() & (od_active <= today)
            if valid_mask.any():
                max_date = od_active[valid_mask].max()
                same_day_mask = od_active == max_date
                name_col = "store_name" if "store_name" in _sod_src.columns else "sitealias"
                names = _sod_src.loc[same_day_mask, name_col].dropna().tolist()
                last_opened_name = ", ".join(str(n) for n in names)
                last_opened_date = max_date.strftime("%d %b %Y")

        # Closed stores count
        closed_stores = 0
        try:
            if _sod is not None:
                col_status = next((c for c in _sod.columns if c.lower() == "store_status"), None)
                if col_status:
                    closed_stores = int((_sod[col_status].str.upper() == "CLOSED").sum())
        except Exception as exc:
            logger.warning("closed store count failed: %s", exc)

        total_all_stores = active_stores + upcoming_stores
        status_dist: dict = {"ACTIVE": active_stores}
        if upcoming_stores:
            status_dist["UPCOMING"] = upcoming_stores
        if closed_stores:
            status_dist["CLOSED"] = closed_stores

        # NSO: active stores opened on/after the 1st of two months ago (dynamic)
        # Aug → 01-Jun, Sep → 01-Jul, Jan → 01-Nov of prior year, etc.
        today = date.today()
        nso_month = today.month - 2
        nso_year = today.year
        if nso_month <= 0:
            nso_month += 12
            nso_year -= 1
        nso_start = date(nso_year, nso_month, 1)
        nso_label = nso_start.strftime("01-%b-%Y").upper()   # e.g. "01-JUN-2026"

        active_nso = 0
        if "opening_date" in store_df.columns:
            od = pd.to_datetime(store_df["opening_date"], errors="coerce")
            active_nso = int((od >= pd.Timestamp(nso_start)).sum())

        grade_dist: dict = {}
        zone_grade_dist: dict = {}
        if "store_grade" in store_df.columns:
            grade_dist = store_df["store_grade"].fillna("—").value_counts().to_dict()
        if "store_grade" in store_df.columns and "zone" in store_df.columns:
            try:
                zg = store_df[["zone", "store_grade"]].fillna("—")
                for zone_val, grp in zg.groupby("zone"):
                    zone_key = str(zone_val).strip()
                    if zone_key and zone_key not in ("-", "—", ""):
                        zone_grade_dist[zone_key] = {str(k): int(v) for k, v in grp["store_grade"].value_counts().to_dict().items() if str(k) not in ("-", "—")}
            except Exception as _zge:
                logger.warning("zone_grade dist failed: %s", _zge)

        upcoming_grade_dist: dict = {}
        try:
            if _sod is not None and "store_status" in _sod.columns and "store_grade" in _sod.columns:
                upcoming_df = _sod[_sod["store_status"].str.upper() == "UPCOMING_STORE"]
                upcoming_grade_dist = upcoming_df["store_grade"].fillna("—").value_counts().to_dict()
        except Exception as exc:
            logger.warning("upcoming grade dist failed: %s", exc)

        zone_dist: dict = {}
        zone_upcoming_dist: dict = {}
        try:
            if "zone" in store_df.columns:
                if "zone" in all_stores_df.columns and "store_status" in all_stores_df.columns:
                    active_zone_df = all_stores_df[all_stores_df["store_status"].str.upper() == "ACTIVE"]
                    upcoming_zone_df = all_stores_df[all_stores_df["store_status"].str.upper() == "UPCOMING_STORE"]
                    zone_dist = {k: v for k, v in active_zone_df["zone"].fillna("").value_counts().to_dict().items()
                                 if str(k).strip() and str(k).strip() not in ("-", "—", "")}
                    zone_upcoming_dist = {k: v for k, v in upcoming_zone_df["zone"].fillna("").value_counts().to_dict().items()
                                          if str(k).strip() and str(k).strip() not in ("-", "—", "")}
                else:
                    zone_dist = store_df["zone"].fillna("—").value_counts().to_dict()
        except Exception as _ze:
            logger.warning("zone dist failed: %s", _ze)

        state_dist: dict = {}
        state_upcoming_dist: dict = {}
        try:
            if _sod is not None and "store_status" in _sod.columns and "state" in _sod.columns:
                active_sod = _sod[_sod["store_status"].str.upper() == "ACTIVE"]
                upcoming_sod = _sod[_sod["store_status"].str.upper() == "UPCOMING_STORE"]
                state_dist = _norm_state_dict(active_sod["state"].fillna("—").value_counts().to_dict())
                state_upcoming_dist = _norm_state_dict(upcoming_sod["state"].fillna("—").value_counts().to_dict())
        except Exception:
            pass
        if not state_dist:
            for col in ("state", "store_state", "state_name"):
                if col in store_df.columns:
                    state_dist = _norm_state_dict(store_df[col].fillna("—").value_counts().to_dict())
                    break

        store_tag_dist: dict = {}
        store_tag_upcoming_dist: dict = {}
        try:
            if _sod is not None and "store_status" in _sod.columns and "store_tag" in _sod.columns:
                active_tag = _sod[_sod["store_status"].str.upper() == "ACTIVE"]
                upcoming_tag = _sod[_sod["store_status"].str.upper() == "UPCOMING_STORE"]
                store_tag_dist = active_tag["store_tag"].fillna("-").value_counts().to_dict()
                store_tag_upcoming_dist = upcoming_tag["store_tag"].fillna("-").value_counts().to_dict()
        except Exception as _te:
            logger.warning("store_tag dist failed: %s", _te)

        # Closed store distributions
        closed_grade_dist: dict = {}
        closed_zone_dist: dict = {}
        closed_tag_dist: dict = {}
        closed_state_dist: dict = {}
        closed_city_dist: dict = {}
        cal_year_closed_dist: dict = {}
        fin_year_closed_dist: dict = {}
        try:
            if _sod is not None and "store_status" in _sod.columns:
                closed_df = _sod[_sod["store_status"].str.upper() == "CLOSED"].copy()
                if "store_grade" in closed_df.columns:
                    closed_grade_dist = closed_df["store_grade"].fillna("—").value_counts().to_dict()
                # Get zone from store_master (T_STORE_OPENING_DATE has no zone col)
                try:
                    if "zone" in all_stores_df.columns and "store_status" in all_stores_df.columns:
                        _closed_sm = all_stores_df[all_stores_df["store_status"].str.upper().isin(["CLOSED", "IN-ACTIVE", "INACTIVE"])]
                        closed_zone_dist = {k: v for k, v in _closed_sm["zone"].fillna("").value_counts().to_dict().items()
                                            if str(k).strip() and str(k).strip() not in ("-", "—", "")}
                except Exception:
                    pass
                if "store_tag" in closed_df.columns:
                    closed_tag_dist = closed_df["store_tag"].fillna("-").value_counts().to_dict()
                if "state" in closed_df.columns:
                    closed_state_dist = _norm_state_dict(closed_df["state"].fillna("—").value_counts().to_dict())
                # Use last_bill_date for FY/CY distribution of closed stores
                date_col_c = "last_bill_date" if "last_bill_date" in closed_df.columns else "opening_date"
                if date_col_c in closed_df.columns:
                    od_c = pd.to_datetime(closed_df[date_col_c], errors="coerce")
                    valid_c = closed_df[od_c.notna()].copy()
                    valid_c["_cy"] = od_c[od_c.notna()].dt.year.astype(str)
                    cal_year_closed_dist = valid_c["_cy"].value_counts().sort_index().to_dict()
                    valid_c["_fy"] = od_c[od_c.notna()].apply(_fy_label)
                    fin_year_closed_dist = valid_c["_fy"].value_counts().sort_index().to_dict()
        except Exception as _cle:
            logger.warning("closed dist failed: %s", _cle)

        store_city_dist: dict = {}
        store_city_upcoming_dist: dict = {}
        state_city_dist: dict = {}   # {state: {city: count}}
        unique_state_count: int = 0
        unique_city_count: int = 0
        active_state_count: int = 0
        active_city_count: int = 0
        upcoming_state_count: int = 0
        upcoming_city_count: int = 0
        upcoming_new_city_count: int = 0
        try:
            city_col = next((c for c in ("city", "store_city", "city_name") if _sod is not None and c in _sod.columns), None)
            if _sod is not None and "store_status" in _sod.columns and city_col:
                active_city = _sod[_sod["store_status"].str.upper() == "ACTIVE"]
                upcoming_city = _sod[_sod["store_status"].str.upper() == "UPCOMING_STORE"]
                closed_city_df = _sod[_sod["store_status"].str.upper() == "CLOSED"]
                store_city_dist = active_city[city_col].fillna("—").value_counts().to_dict()
                store_city_upcoming_dist = upcoming_city[city_col].fillna("—").value_counts().to_dict()
                closed_city_dist = {k: v for k, v in closed_city_df[city_col].fillna("—").value_counts().to_dict().items() if str(k).strip() not in ("-", "—", "")}
                # Unique state/city across active + upcoming
                # Normalize known short-form aliases (e.g. "JH" == "JHARKHAND" in data)
                _STATE_NORM = {
                    # Short codes
                    "JH": "JHARKHAND", "RJ": "RAJASTHAN", "MH": "MAHARASHTRA",
                    "UP": "UP", "MP": "MP", "HR": "HARYANA", "PB": "PUNJAB",
                    "GJ": "GUJARAT", "AP": "ANDHRA PRADESH", "TN": "TAMIL NADU",
                    "KA": "KARNATAKA", "KL": "KERALA", "WB": "WEST BENGAL",
                    "OR": "ODISHA", "OD": "ODISHA", "CG": "CHHATTISGARH",
                    "UK": "UTTARAKHAND", "CH": "CHHATTISGARH", "AR": "ARUNACHAL PRADESH",
                    # J&K variants
                    "KASHMIR": "JAMMU AND KASHMIR", "JAMMU": "JAMMU AND KASHMIR",
                    "J&K": "JAMMU AND KASHMIR", "JAMMU & KASHMIR": "JAMMU AND KASHMIR",
                    # Delhi
                    "NEW DELHI": "DELHI",
                    # Odisha variants
                    "ORISSA": "ODISHA",
                    # City incorrectly listed as state
                    "GURGAON": "HARYANA",
                    # Invalid/placeholder values
                    "-": None,
                }
                au_df = _sod[_sod["store_status"].str.upper().isin(["ACTIVE", "UPCOMING_STORE"])].copy()
                if "state" in au_df.columns:
                    au_df["state"] = au_df["state"].str.strip().str.upper().map(
                        lambda s: _STATE_NORM.get(s, s) if pd.notna(s) else s
                    )
                    unique_state_count = int(au_df["state"].dropna().nunique())
                unique_city_count = int(au_df[city_col].dropna().nunique())
                # Separate counts for active and upcoming
                if "state" in active_city.columns:
                    active_state_count = int(active_city["state"].dropna().nunique())
                active_city_count = int(active_city[city_col].dropna().nunique())
                if "state" in upcoming_city.columns:
                    upcoming_state_count = int(upcoming_city["state"].dropna().nunique())
                upcoming_city_count = int(upcoming_city[city_col].dropna().nunique())
                # New cities in upcoming not already in active
                _active_cities = set(active_city[city_col].dropna().str.strip().str.upper())
                _upcoming_cities = set(upcoming_city[city_col].dropna().str.strip().str.upper())
                upcoming_new_city_count = int(len(_upcoming_cities - _active_cities))
                if "state" in active_city.columns:
                    for state_val, grp in active_city.groupby("state"):
                        raw_sk = str(state_val).strip().upper()
                        sk = _STATE_NORM.get(raw_sk, raw_sk)
                        if sk and sk not in ("-", "—", ""):
                            existing = state_city_dist.get(sk, {})
                            for c, v in grp[city_col].fillna("—").value_counts().to_dict().items():
                                if str(c) not in ("-", "—"):
                                    existing[str(c)] = existing.get(str(c), 0) + int(v)
                            state_city_dist[sk] = existing
            elif "state_name" in store_df.columns:
                city_col_df = next((c for c in ("city", "store_city", "city_name") if c in store_df.columns), None)
                if city_col_df:
                    for state_val, grp in store_df.groupby("state_name"):
                        raw_sk = str(state_val).strip().upper()
                        sk = _STATE_NORM.get(raw_sk, raw_sk)
                        if sk and sk not in ("-", "—", ""):
                            existing = state_city_dist.get(sk, {})
                            for c, v in grp[city_col_df].fillna("—").value_counts().to_dict().items():
                                if str(c) not in ("-", "—"):
                                    existing[str(c)] = existing.get(str(c), 0) + int(v)
                            state_city_dist[sk] = existing
        except Exception as _ce:
            logger.warning("store_city dist failed: %s", _ce)

        # Calendar year and financial year store counts from opening_date
        cal_year_dist: dict = {}
        fin_year_dist: dict = {}
        cal_year_upcoming_dist: dict = {}
        fin_year_upcoming_dist: dict = {}

        def _fy_label(dt) -> str:
            return f"FY{str(dt.year + 1)[-2:]}" if dt.month >= 4 else f"FY{str(dt.year)[-2:]}"

        if "opening_date" in store_df.columns:
            od = pd.to_datetime(store_df["opening_date"], errors="coerce")
            valid = store_df[od.notna()].copy()
            valid["_cy"] = od[od.notna()].dt.year.astype(str)
            cal_year_dist = valid["_cy"].value_counts().sort_index().to_dict()
            valid["_fy"] = od[od.notna()].apply(_fy_label)
            fin_year_dist = valid["_fy"].value_counts().sort_index().to_dict()

        # Upcoming stores opening year distribution — extract FY from store_tag (e.g. "FY27 - Q3" → FY27)
        try:
            if _sod is not None and "store_status" in _sod.columns and "store_tag" in _sod.columns:
                sod_fy = _sod
                if sod_fy is not None and "store_status" in sod_fy.columns and "store_tag" in sod_fy.columns:
                    up_fy = sod_fy[sod_fy["store_status"].str.upper() == "UPCOMING_STORE"].copy()
                    import re as _re
                    def _tag_to_fy(tag: str) -> str:
                        m = _re.search(r"FY(\d{2,4})", str(tag), _re.IGNORECASE)
                        if m:
                            yr = m.group(1)
                            return f"FY{yr[-2:]}"
                        return "FY27"  # untagged upcoming default to current planning year
                    def _tag_to_cy(tag: str) -> str:
                        m = _re.search(r"FY(\d{2,4})", str(tag), _re.IGNORECASE)
                        if m:
                            yr_2d = int(m.group(1)[-2:])
                            return str(2000 + yr_2d - 1)
                        return "2026"  # FY27 → CY2026
                    up_fy["_fy_tag"] = up_fy["store_tag"].fillna("").apply(_tag_to_fy)
                    up_fy["_cy_tag"] = up_fy["store_tag"].fillna("").apply(_tag_to_cy)
                    fin_year_upcoming_dist = {k: v for k, v in
                                              up_fy[up_fy["_fy_tag"] != ""]["_fy_tag"].value_counts().to_dict().items()}
                    cal_year_upcoming_dist = {k: v for k, v in
                                              up_fy[up_fy["_cy_tag"] != ""]["_cy_tag"].value_counts().to_dict().items()}
        except Exception as _fye:
            logger.warning("upcoming fy/cy dist failed: %s", _fye)

        result = {
            "oracle_ok": True,
            "oracle_cache_ms": oracle_ms,
            "total_items": total_items,
            "total_stores": active_stores,
            "upcoming_stores": upcoming_stores,
            "opening_2026": opening_2026,
            "opening_60d": opening_60d,
            "last_opened_name": last_opened_name,
            "last_opened_date": last_opened_date,
            "total_all_stores": total_all_stores,
            "active_nso": active_nso,
            "nso_from_date": nso_label,
            "store_status_distribution": {str(k): int(v) for k, v in status_dist.items()},
            "divisions": int(divisions),
            "departments": int(departments),
            "articles": int(articles),
            "attributes": attrs,
            "items_by_attribute1": {str(k): int(v) for k, v in items_by_attr.items()},
            "store_grade_distribution": {str(k): int(v) for k, v in sorted(grade_dist.items())},
            "upcoming_grade_distribution": {str(k): int(v) for k, v in sorted(upcoming_grade_dist.items())},
            "zone_grade_distribution": zone_grade_dist,
            "store_zone_distribution": {str(k): int(v) for k, v in zone_dist.items()},
            "store_zone_upcoming": {str(k): int(v) for k, v in zone_upcoming_dist.items()},
            "store_state_distribution": {str(k): int(v) for k, v in state_dist.items()},
            "store_state_upcoming": {str(k): int(v) for k, v in state_upcoming_dist.items()},
            "store_tag_distribution": {str(k): int(v) for k, v in store_tag_dist.items()},
            "store_tag_upcoming": {str(k): int(v) for k, v in store_tag_upcoming_dist.items()},
            "store_cal_year_dist": {str(k): int(v) for k, v in cal_year_dist.items()},
            "store_fin_year_dist": {str(k): int(v) for k, v in fin_year_dist.items()},
            "store_cal_year_upcoming": {str(k): int(v) for k, v in cal_year_upcoming_dist.items()},
            "store_fin_year_upcoming": {str(k): int(v) for k, v in fin_year_upcoming_dist.items()},
            "store_city_distribution": {str(k): int(v) for k, v in store_city_dist.items()},
            "store_city_upcoming": {str(k): int(v) for k, v in store_city_upcoming_dist.items()},
            "state_city_distribution": state_city_dist,
            "closed_stores": closed_stores,
            "closed_grade_distribution": {str(k): int(v) for k, v in sorted(closed_grade_dist.items())},
            "closed_zone_distribution": {str(k): int(v) for k, v in closed_zone_dist.items()},
            "closed_tag_distribution": {str(k): int(v) for k, v in closed_tag_dist.items()},
            "closed_state_distribution": {str(k): int(v) for k, v in closed_state_dist.items()},
            "closed_city_distribution": {str(k): int(v) for k, v in closed_city_dist.items()},
            "store_cal_year_closed": {str(k): int(v) for k, v in cal_year_closed_dist.items()},
            "store_fin_year_closed": {str(k): int(v) for k, v in fin_year_closed_dist.items()},
            "unique_state_count": unique_state_count,
            "unique_city_count": unique_city_count,
            "active_state_count": active_state_count,
            "active_city_count": active_city_count,
            "upcoming_state_count": upcoming_state_count,
            "upcoming_city_count": upcoming_city_count,
            "upcoming_new_city_count": upcoming_new_city_count,
        }
        _oracle_cache.update(result)
        _oracle_cache_ts = time.time()
        return result
    except Exception as exc:
        logger.warning("dashboard Oracle stats failed: %s", exc)
        if _oracle_cache:
            logger.info("Returning stale oracle cache (age %.0fs)", time.time() - _oracle_cache_ts)
            stale = dict(_oracle_cache)
            stale["oracle_ok"] = False
            return stale
        return {
            "oracle_ok": False,
            "oracle_cache_ms": None,
            "total_items": 0,
            "total_stores": 0,
            "upcoming_stores": 0,
            "opening_2026": 0,
            "opening_60d": 0,
            "last_opened_name": "",
            "last_opened_date": "",
            "total_all_stores": 0,
            "active_nso": 0,
            "nso_from_date": None,
            "store_status_distribution": {},
            "divisions": 0,
            "departments": 0,
            "articles": 0,
            "attributes": [],
            "items_by_attribute1": {},
            "store_grade_distribution": {},
            "upcoming_grade_distribution": {},
            "zone_grade_distribution": {},
            "store_zone_distribution": {},
            "store_zone_upcoming": {},
            "store_state_distribution": {},
            "store_state_upcoming": {},
            "store_tag_distribution": {},
            "store_tag_upcoming": {},
            "store_cal_year_dist": {},
            "store_fin_year_dist": {},
            "store_cal_year_upcoming": {},
            "store_fin_year_upcoming": {},
            "store_city_distribution": {},
            "store_city_upcoming": {},
            "state_city_distribution": {},
            "closed_stores": 0,
            "closed_grade_distribution": {},
            "closed_zone_distribution": {},
            "closed_tag_distribution": {},
            "closed_state_distribution": {},
            "closed_city_distribution": {},
            "store_cal_year_closed": {},
            "store_fin_year_closed": {},
            "unique_state_count": 0,
            "unique_city_count": 0,
            "active_state_count": 0,
            "active_city_count": 0,
            "upcoming_state_count": 0,
            "upcoming_city_count": 0,
            "upcoming_new_city_count": 0,
        }


def _last_run_stats() -> dict:
    """Pull the most recent completed in-memory run summary + division breakdown."""
    runs = run_store.list_runs()
    last_complete = next((r for r in runs if r.status == "complete"), None)

    if not last_complete:
        return {"has_last_run": False}

    s = last_complete.summary
    req = last_complete.request

    # Division breakdown from result DataFrame
    division_breakdown: list[dict] = []
    df = run_store.get_results(last_complete.run_id)
    if df is not None and "division" in df.columns and "req" in df.columns:
        grp = (
            df.groupby("division")
            .agg(total_req=("req", "sum"), stores=("store_name", "nunique"), rows=("req", "count"))
            .reset_index()
            .sort_values("total_req", ascending=False)
        )
        division_breakdown = grp.to_dict(orient="records")

    return {
        "has_last_run": True,
        "run_id": last_complete.run_id,
        "label": last_complete.label,
        "factor_set_name": last_complete.factor_set_name,
        "completed_at": last_complete.completed_at,
        "duration_s": last_complete.duration_s,
        "attribute1": req.attribute1 if req else None,
        "division": req.division if req else None,
        "department": req.department if req else None,
        "total_rows": s.total_rows if s else 0,
        "total_req": s.total_req if s else 0,
        "total_pbs": s.total_pbs if s else 0,
        "stores": s.stores if s else 0,
        "departments": s.departments if s else 0,
        "fill_rate_achieved": s.fill_rate_achieved if s else 0,
        "zero_req_rows": s.zero_req_rows if s else 0,
        "capped_rows": s.capped_rows if s else 0,
        "result_rows": last_complete.result_rows,
        "division_breakdown": division_breakdown,
    }


def _history_stats() -> dict:
    """Aggregate stats across persisted run history."""
    try:
        all_complete, total_complete = list_history(status="complete", limit=200, offset=0)
        all_error, total_error = list_history(status="error", limit=1, offset=0)

        durations = [r["duration_s"] for r in all_complete if r.get("duration_s")]
        avg_duration = round(sum(durations) / len(durations), 1) if durations else None
        avg_req = (
            round(sum(r["total_req"] for r in all_complete) / len(all_complete), 0)
            if all_complete else None
        )

        recent, _ = list_history(limit=5, offset=0)

        return {
            "total_complete": total_complete,
            "total_error": total_error,
            "avg_duration_s": avg_duration,
            "avg_total_req": avg_req,
            "recent_runs": [
                {
                    "run_id": r["run_id"],
                    "label": r["label"],
                    "status": r["status"],
                    "started_at": r["started_at"],
                    "duration_s": r["duration_s"],
                    "total_req": r["total_req"],
                    "attribute1": r["attribute1"],
                    "exception_errors": r["exception_errors"],
                    "exception_warnings": r["exception_warnings"],
                }
                for r in recent
            ],
        }
    except Exception as exc:
        logger.warning("dashboard history stats failed: %s", exc)
        return {"total_complete": 0, "total_error": 0, "avg_duration_s": None, "avg_total_req": None, "recent_runs": []}


def _factor_stats() -> dict:
    """Active factor set summary."""
    try:
        sets = _factor_repo.list_sets()
        active = next((s for s in sets if s.is_active), None)
        return {
            "total_factor_sets": len(sets),
            "active_factor_set_id": active.id if active else None,
            "active_factor_set_name": active.name if active else None,
            "active_fill_rate": active.config.fill_rate_target if active and active.config else None,
            "active_safety_days": active.config.safety_days if active and active.config else None,
        }
    except Exception as exc:
        logger.warning("dashboard factor stats failed: %s", exc)
        return {"total_factor_sets": 0, "active_factor_set_id": None, "active_factor_set_name": None}


@router.get("/summary", response_model=APIResponse)
async def dashboard_summary():
    """
    Aggregate dashboard KPIs from all data sources in parallel.
    Oracle stats are cached for 5 minutes — first load is slow, subsequent loads are instant.
    """
    import asyncio
    t0 = time.perf_counter()

    loop = asyncio.get_event_loop()
    oracle, last_run, history, factors = await asyncio.gather(
        loop.run_in_executor(None, _safe_oracle_stats),
        loop.run_in_executor(None, _last_run_stats),
        loop.run_in_executor(None, _history_stats),
        loop.run_in_executor(None, _factor_stats),
    )

    elapsed_ms = round((time.perf_counter() - t0) * 1000, 1)

    return APIResponse.ok(data={
        "oracle": oracle,
        "last_run": last_run,
        "history": history,
        "factors": factors,
        "summary_ms": elapsed_ms,
    })



@router.post("/cache/clear", response_model=APIResponse)
async def clear_dashboard_cache():
    """Force-expire the oracle stats cache so next load re-fetches from Oracle."""
    global _oracle_cache_ts
    _oracle_cache_ts = 0.0
    return APIResponse.ok(message="Oracle stats cache cleared — next summary call will re-fetch.")


# ── Allocation summary cache ───────────────────────────────────────────────────
_alloc_cache: dict = {}
_alloc_cache_ts: float = 0.0
_ALLOC_TTL = 600  # 10 minutes


@router.get("/allocation-summary", response_model=APIResponse)
async def allocation_summary():
    """
    Division-level pivot of T_ALLOCATION_FOR_ALL_DIVISION parquet.
    Returns rows sorted by alloc_regn_q desc plus a totals row.
    Cached for 10 minutes.
    """
    global _alloc_cache, _alloc_cache_ts
    age = time.time() - _alloc_cache_ts
    if _alloc_cache and age < _ALLOC_TTL:
        return APIResponse.ok(data=_alloc_cache)

    try:
        from app.core.parquet_cache import has_output, read_cache

        if not has_output("MISRETAIL", "T_ALLOCATION_FOR_ALL_DIVISION"):
            return APIResponse.ok(data={"available": False, "rows": []})

        df = read_cache("MISRETAIL", "T_ALLOCATION_FOR_ALL_DIVISION")
        if df is None or df.empty:
            return APIResponse.ok(data={"available": False, "rows": []})

        if "division" not in df.columns:
            return APIResponse.ok(data={"available": False, "rows": []})

        def safe_col(col):
            return col if col in df.columns else None

        # Split STORE vs DC rows
        has_loc = "location" in df.columns
        store_df = df[df["location"] == "STORE"] if has_loc else df
        dc_df    = df[df["location"] == "DC"]    if has_loc else df.iloc[:0]

        # Store-level numeric cols
        STORE_NUM = ["total_stk_q", "lm_sl_q", "mtd_sl_q", "proj_q", "in_transit_q"]
        store_agg = {c: "sum" for c in STORE_NUM if safe_col(c)}
        pivot = store_df.groupby("division", as_index=False).agg(store_agg)

        # DC stock + alloc qty from DC rows
        if not dc_df.empty:
            dc_agg_cols = {c: "sum" for c in ["total_stk_q", "alloc_regn_q"] if c in dc_df.columns}
            dc_pivot = dc_df.groupby("division", as_index=False).agg(dc_agg_cols)
            dc_pivot = dc_pivot.rename(columns={"total_stk_q": "dc_stk_q"})
            pivot = pivot.merge(dc_pivot, on="division", how="left")
        else:
            pivot["dc_stk_q"] = 0
            pivot["alloc_regn_q"] = 0

        # Stores = only STORE location unique store_codes
        if safe_col("store_code"):
            store_grp = store_df.groupby("division")["store_code"].nunique().reset_index(name="stores")
            pivot = pivot.merge(store_grp, on="division", how="left")

        if safe_col("barcode"):
            art_grp = df.groupby("division")["barcode"].nunique().reset_index(name="articles")
            pivot = pivot.merge(art_grp, on="division", how="left")

        # Rename numeric cols
        rename_map = {
            "total_stk_q": "stk_qty", "alloc_regn_q": "alloc_qty",
            "lm_sl_q": "lm_sale_q", "mtd_sl_q": "mtd_sale_q",
            "proj_q": "proj_qty",
        }
        pivot = pivot.rename(columns={k: v for k, v in rename_map.items() if k in pivot.columns})

        # Sort by alloc_qty desc
        if "alloc_qty" in pivot.columns:
            pivot = pivot.sort_values("alloc_qty", ascending=False)

        # Totals row
        total_row = {"division": "__TOTAL__"}
        for col in pivot.columns:
            if col == "division":
                continue
            total_row[col] = int(pivot[col].sum()) if pivot[col].dtype.kind in "iuf" else None

        rows = [{k: (int(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else v)
                 for k, v in r.items()}
                for r in pivot.fillna(0).to_dict(orient="records")]

        result = {
            "available": True,
            "total_rows": int(len(df)),
            "rows": rows,
            "totals": total_row,
        }
        _alloc_cache = result
        _alloc_cache_ts = time.time()
        return APIResponse.ok(data=result)

    except Exception as exc:
        logger.warning("allocation summary failed: %s", exc)
        return APIResponse.fail(f"allocation-summary error: {exc}")


def _alloc_parquet():
    """Return the allocation DataFrame or None."""
    from app.core.parquet_cache import has_output, read_cache
    if not has_output("MISRETAIL", "T_ALLOCATION_FOR_ALL_DIVISION"):
        return None
    return read_cache("MISRETAIL", "T_ALLOCATION_FOR_ALL_DIVISION")


from fastapi import Query as FQuery

_DETAIL_COLS = [
    "store_code", "store_name", "division", "section", "department",
    "article_name", "barcode", "mrp", "last_in_rate",
    "cat1", "cat2", "cat3", "cat4", "cat5", "cat6",
    "desc1", "desc2", "desc3", "desc4", "desc5", "desc6",
    "total_stk_q", "stk_q", "adj_stk_q", "alloc_regn_q",
    "pack_pend_q", "adj_pack_pend_q", "to_q", "adj_to_q",
    "in_transit_q", "adj_in_transit_q", "ppo_q",
    "lm_sl_q", "mtd_sl_q",
    "proj_mnth_1_q", "proj_mnth_1a_q", "proj_mnth_2_q", "proj_mnth_2a_q",
    "proj_mnth_3_q", "proj_mnth_3a_q", "proj_q",
]


@router.get("/allocation-barcodes", response_model=APIResponse)
async def allocation_barcodes(q: str = FQuery("", description="Partial barcode/icode search")):
    """Return up to 60 barcodes matching the query string."""
    try:
        df = _alloc_parquet()
        if df is None or "barcode" not in df.columns:
            return APIResponse.ok(data={"barcodes": []})
        barcodes = df["barcode"].dropna().astype(str).unique()
        if q:
            q_lower = q.lower()
            barcodes = [b for b in barcodes if q_lower in b.lower()]
        else:
            barcodes = list(barcodes)
        barcodes = sorted(barcodes)[:60]
        return APIResponse.ok(data={"barcodes": barcodes})
    except Exception as exc:
        logger.warning("allocation-barcodes failed: %s", exc)
        return APIResponse.ok(data={"barcodes": []})


@router.get("/allocation-detail", response_model=APIResponse)
async def allocation_detail(
    icodes: str = FQuery("", description="Comma-separated barcodes; empty = all"),
    page: int = FQuery(0, ge=0),
    limit: int = FQuery(500, ge=1, le=2000),
):
    """Return paginated rows from T_ALLOCATION_FOR_ALL_DIVISION with all columns."""
    try:
        df = _alloc_parquet()
        if df is None or df.empty:
            return APIResponse.ok(data={"available": False, "rows": [], "total": 0, "page": 0})

        # Filter by selected barcodes
        if icodes.strip():
            selected = [b.strip() for b in icodes.split(",") if b.strip()]
            if "barcode" in df.columns:
                df = df[df["barcode"].astype(str).isin(selected)]

        total = int(len(df))
        # Select only available columns
        avail = [c for c in _DETAIL_COLS if c in df.columns]
        page_df = df[avail].iloc[page * limit: (page + 1) * limit]

        # Serialize: round floats to int where appropriate
        rows = []
        for rec in page_df.fillna("").to_dict(orient="records"):
            clean = {}
            for k, v in rec.items():
                if isinstance(v, float):
                    clean[k] = int(v) if v == int(v) else round(v, 2)
                else:
                    clean[k] = v
            rows.append(clean)

        return APIResponse.ok(data={
            "available": True,
            "total": total,
            "page": page,
            "limit": limit,
            "total_pages": max(1, -(-total // limit)),
            "rows": rows,
            "columns": avail,
        })
    except Exception as exc:
        logger.warning("allocation-detail failed: %s", exc)
        return APIResponse.fail(f"allocation-detail error: {exc}")


def _pivot_and_serialize(df, group_cols: list[str]) -> dict:
    """Generic pivot helper — groups df by group_cols and sums numeric cols.
    Separates STORE vs DC rows so stock counts and store counts are accurate.
    DC sites appear as their own rows (dc_stk_q > 0, stk_qty = 0).
    """
    import pandas as pd

    has_loc = "location" in df.columns
    store_df = df[df["location"] == "STORE"] if has_loc else df
    dc_df    = df[df["location"] == "DC"]    if has_loc else df.iloc[:0]

    STORE_COLS = ["total_stk_q", "lm_sl_q", "mtd_sl_q", "proj_q", "in_transit_q"]
    DC_COLS    = ["total_stk_q", "alloc_regn_q"]

    # Store pivot
    store_agg = {c: "sum" for c in STORE_COLS if c in store_df.columns}
    store_pivot = store_df.groupby(group_cols, as_index=False).agg(store_agg)
    store_pivot = store_pivot.rename(columns={"total_stk_q": "stk_qty"})
    store_pivot["dc_stk_q"] = 0

    # Store count + articles for store rows
    if "store_code" in store_df.columns:
        sc = store_df.groupby(group_cols)["store_code"].nunique().reset_index(name="stores")
        store_pivot = store_pivot.merge(sc, on=group_cols, how="left")
    if "barcode" in store_df.columns:
        ac = store_df.groupby(group_cols)["barcode"].nunique().reset_index(name="articles")
        store_pivot = store_pivot.merge(ac, on=group_cols, how="left")

    # DC pivot — each DC site becomes its own row
    if not dc_df.empty:
        dc_agg = {c: "sum" for c in DC_COLS if c in dc_df.columns}
        dc_pivot = dc_df.groupby(group_cols, as_index=False).agg(dc_agg)
        dc_pivot = dc_pivot.rename(columns={"total_stk_q": "dc_stk_q"})
        dc_pivot["stk_qty"] = 0
        dc_pivot["stores"] = 0
        if "barcode" in dc_df.columns:
            dc_art = dc_df.groupby(group_cols)["barcode"].nunique().reset_index(name="articles")
            dc_pivot = dc_pivot.merge(dc_art, on=group_cols, how="left")
        store_pivot["loc"] = "STORE"
        dc_pivot["loc"] = "DC"
        pivot = pd.concat([store_pivot, dc_pivot], ignore_index=True)
    else:
        pivot = store_pivot
        if "alloc_regn_q" not in pivot.columns:
            pivot["alloc_regn_q"] = 0
        pivot["loc"] = "STORE"

    rename = {
        "alloc_regn_q": "alloc_qty",
        "lm_sl_q": "lm_sale_q", "mtd_sl_q": "mtd_sale_q",
        "proj_q": "proj_qty",
    }
    pivot = pivot.rename(columns={k: v for k, v in rename.items() if k in pivot.columns})

    if "alloc_qty" in pivot.columns:
        pivot = pivot.sort_values("alloc_qty", ascending=False)

    total_row: dict = {"__label__": "TOTAL"}
    for col in pivot.columns:
        if col in group_cols:
            continue
        total_row[col] = int(pivot[col].sum()) if pivot[col].dtype.kind in "iuf" else None

    def _to_int(v):
        if isinstance(v, float) and v == int(v):
            return int(v)
        return v

    rows = [{k: _to_int(v) for k, v in r.items()} for r in pivot.fillna(0).to_dict(orient="records")]
    return {"available": True, "total_rows": int(len(df)), "rows": rows, "totals": total_row}


# Store-wise cache
_store_cache: dict = {}
_store_cache_ts: float = -1.0  # force refresh after loc field added

@router.get("/allocation-store", response_model=APIResponse)
async def allocation_store():
    """Store-wise pivot of T_ALLOCATION_FOR_ALL_DIVISION."""
    global _store_cache, _store_cache_ts
    age = time.time() - _store_cache_ts
    if _store_cache and age < _ALLOC_TTL:
        return APIResponse.ok(data=_store_cache)
    try:
        df = _alloc_parquet()
        if df is None or df.empty:
            return APIResponse.ok(data={"available": False, "rows": []})
        group_cols = [c for c in ["store_code", "store_name"] if c in df.columns]
        if not group_cols:
            return APIResponse.ok(data={"available": False, "rows": []})
        result = _pivot_and_serialize(df, group_cols)
        _store_cache.update(result)
        _store_cache_ts = time.time()
        return APIResponse.ok(data=result)
    except Exception as exc:
        logger.warning("allocation store summary failed: %s", exc)
        return APIResponse.fail(f"allocation-store error: {exc}")


# MC (div+section+dept) cache
_mc_cache: dict = {}
_mc_cache_ts: float = 0.0

@router.get("/allocation-mc", response_model=APIResponse)
async def allocation_mc():
    """Division + Section + Department pivot of T_ALLOCATION_FOR_ALL_DIVISION."""
    global _mc_cache, _mc_cache_ts
    age = time.time() - _mc_cache_ts
    if _mc_cache and age < _ALLOC_TTL:
        return APIResponse.ok(data=_mc_cache)
    try:
        df = _alloc_parquet()
        if df is None or df.empty:
            return APIResponse.ok(data={"available": False, "rows": []})
        group_cols = [c for c in ["division", "section", "department"] if c in df.columns]
        if not group_cols:
            return APIResponse.ok(data={"available": False, "rows": []})
        result = _pivot_and_serialize(df, group_cols)
        _mc_cache.update(result)
        _mc_cache_ts = time.time()
        return APIResponse.ok(data=result)
    except Exception as exc:
        logger.warning("allocation mc summary failed: %s", exc)
        return APIResponse.fail(f"allocation-mc error: {exc}")


# ── State name normalisation (old / unofficial → official) ───────────────────
_STATE_NORM: dict[str, str] = {
    "ORISSA":           "ODISHA",
    "OR":               "ODISHA",
    "OD":               "ODISHA",
    "JH":               "JHARKHAND",
    "UTTARANCHAL":      "UTTARAKHAND",
    "UK":               "UTTARAKHAND",
    "PONDICHERRY":      "PUDUCHERRY",
    # J&K variants
    "KASHMIR":          "JAMMU AND KASHMIR",
    "JAMMU":            "JAMMU AND KASHMIR",
    "J&K":              "JAMMU AND KASHMIR",
    "JAMMU & KASHMIR":  "JAMMU AND KASHMIR",
    # Short codes
    "CH":               "CHHATTISGARH",
    "CG":               "CHHATTISGARH",
    "AR":               "ARUNACHAL PRADESH",
    # Delhi
    "NEW DELHI":        "DELHI",
    # City incorrectly listed as state
    "GURGAON":          "HARYANA",
}


def _norm_state_dict(d: dict) -> dict:
    """Merge old state names into their official equivalents, always uppercase."""
    out: dict = {}
    for k, v in d.items():
        raw = str(k).strip().upper()
        key = _STATE_NORM.get(raw, raw)
        out[key] = out.get(key, 0) + v
    return out


# ── Store drill-down — stores by split value ──────────────────────────────────
_SPLIT_COL_MAP = {
    "zone":  "zone",
    "state": "state_name",
    "city":  "city",
    "grade": "store_grade",
    "tag":   "store_tag",
    "fy":    "_fy",   # derived — handled separately
    "cy":    "_cy",   # derived — handled separately
}


@router.get("/stores-by", response_model=APIResponse)
async def stores_by_split(split: str, value: str):
    """Return store list for a given split dimension and value.
    split: zone | state | grade | tag
    value: e.g. NORTH, Bihar, A+, LARGE
    Uses in-memory store cache — instant, no Oracle round-trip.
    """
    try:
        import pandas as pd
        from app.repositories.store_repository import StoreRepository

        # state_city combo: value = "BIHAR|PATNA"
        if split.lower() == "state_city":
            parts = value.split("|", 1)
            if len(parts) != 2:
                return APIResponse.fail("state_city value must be 'STATE|CITY' e.g. 'BIHAR|PATNA'")
            state_val, city_val = parts[0].strip(), parts[1].strip()
            repo = StoreRepository()
            store_df = repo.get_all_stores(active_only=False)
            import pandas as pd
            try:
                from app.core.parquet_cache import has_output, read_cache as _rc
                if has_output("MISRETAIL", "T_STORE_OPENING_DATE"):
                    sod = _rc("MISRETAIL", "T_STORE_OPENING_DATE")
                    city_col = next((c for c in ("city", "store_city", "city_name") if sod is not None and c in sod.columns), None)
                    if sod is not None and "state" in sod.columns and city_col:
                        mask = (sod["state"].fillna("").str.strip().str.upper() == state_val.upper()) & \
                               (sod[city_col].fillna("").str.strip().str.upper() == city_val.upper()) & \
                               sod["store_status"].str.upper().isin(["ACTIVE", "UPCOMING_STORE"])
                        sod_f = sod[mask].copy()
                        store_lookup = store_df.drop_duplicates(subset=["store_name"]).set_index("store_name").to_dict(orient="index") if "store_name" in store_df.columns else {}
                        stores = []
                        for r in sod_f.to_dict("records"):
                            code = str(r.get("store_name", "—")).strip()
                            sm = store_lookup.get(code, {})
                            name = str(sm.get("store_name_f", sm.get("location", ""))) if sm else str(r.get("initial_name", r.get("location", "")))
                            raw_status = str(r.get("store_status", "")).strip().upper()
                            if raw_status not in ("ACTIVE", "UPCOMING_STORE"):
                                continue
                            area_v = r.get("area")
                            try: area_f = None if area_v is None or pd.isna(area_v) else float(area_v)
                            except: area_f = None
                            stores.append({"code": code, "name": name, "status": raw_status,
                                           "grade": str(sm.get("store_grade", r.get("store_grade", ""))),
                                           "zone": str(r.get("zone", "")), "state": str(r.get("state", state_val)), "area": area_f})
                        stores.sort(key=lambda x: (0 if x["status"] == "ACTIVE" else 1 if x["status"] == "UPCOMING_STORE" else 2, x["code"]))
                        return APIResponse.ok(data={"stores": stores, "count": len(stores), "split": split, "value": value})
            except Exception as _sce:
                logger.warning("state_city parquet lookup failed: %s", _sce)
            # fallback: store master
            city_col_df = next((c for c in ("city", "store_city", "city_name") if c in store_df.columns), None)
            state_col_df = next((c for c in ("state_name", "state") if c in store_df.columns), None)
            if not city_col_df or not state_col_df:
                return APIResponse.ok(data={"stores": [], "count": 0, "note": "city/state column missing in store master"})
            mask2 = (store_df[state_col_df].fillna("").str.strip().str.upper() == state_val.upper()) & \
                    (store_df[city_col_df].fillna("").str.strip().str.upper() == city_val.upper())
            stores = []
            for r in store_df[mask2].to_dict("records"):
                area_v = r.get("area")
                try: area_f = None if area_v is None or pd.isna(area_v) else float(area_v)
                except: area_f = None
                stores.append({"code": str(r.get("store_name", "—")), "name": str(r.get("store_name_f", r.get("location", ""))),
                               "status": str(r.get("store_status", "")).strip().upper(),
                               "grade": str(r.get("store_grade", "")), "zone": str(r.get("zone", "")),
                               "state": str(r.get(state_col_df, "")), "area": area_f})
            stores.sort(key=lambda x: x["code"])
            return APIResponse.ok(data={"stores": stores, "count": len(stores), "split": split, "value": value})

        # zone_grade combo: value = "NORTH|A+"
        if split.lower() == "zone_grade":
            parts = value.split("|", 1)
            if len(parts) != 2:
                return APIResponse.fail("zone_grade value must be 'ZONE|GRADE' e.g. 'NORTH|A+'")
            zone_val, grade_val = parts[0].strip(), parts[1].strip()
            repo = StoreRepository()
            store_df = repo.get_all_stores(active_only=False)
            import pandas as pd
            if "zone" not in store_df.columns or "store_grade" not in store_df.columns:
                return APIResponse.ok(data={"stores": [], "count": 0, "note": "zone or store_grade column missing"})
            mask = (store_df["zone"].fillna("").str.strip().str.upper() == zone_val.upper()) & \
                   (store_df["store_grade"].fillna("").str.strip().str.upper() == grade_val.upper()) & \
                   (store_df["store_status"].fillna("").str.strip().str.upper().isin(["ACTIVE", "UPCOMING_STORE"]))
            filtered = store_df[mask].copy()
            stores = []
            for r in filtered.to_dict("records"):
                area_v = r.get("area")
                try:
                    area_f = None if area_v is None or pd.isna(area_v) else float(area_v)
                except Exception:
                    area_f = None
                stores.append({
                    "code":   str(r.get("store_name", "—")),
                    "name":   str(r.get("store_name_f", r.get("location", ""))),
                    "status": str(r.get("store_status", "")).strip().upper(),
                    "grade":  str(r.get("store_grade", "")),
                    "zone":   str(r.get("zone", "")),
                    "state":  str(r.get("state_name", "")),
                    "area":   area_f,
                })
            stores.sort(key=lambda x: x["code"])
            return APIResponse.ok(data={"stores": stores, "count": len(stores), "split": split, "value": value})

        col = _SPLIT_COL_MAP.get(split.lower())
        if not col:
            return APIResponse.fail(f"Unknown split: {split}. Use zone | state | city | grade | tag | zone_grade")

        repo = StoreRepository()
        store_df = repo.get_all_stores(active_only=False)

        # Build a lookup: store_name (code) → store master row as plain dict (vectorized)
        # drop_duplicates to avoid "DataFrame index must be unique for orient='index'" error
        store_lookup: dict = (
            store_df.drop_duplicates(subset=["store_name"])
                    .set_index("store_name")
                    .to_dict(orient="index")
            if "store_name" in store_df.columns else {}
        )

        # For state split: distribution keys are parquet short codes (UP, MP, CH…)
        # but store master uses full names (UTTAR PRADESH, MADHYA PRADESH…).
        # Map the clicked key to all equivalent store master state_name values.
        _PARQUET_TO_MASTER: dict[str, list[str]] = {
            "UP":         ["UTTAR PRADESH"],
            "MP":         ["MADHYA PRADESH"],
            "CH":         ["CHHATTISGARH"],
            "JH":         ["JHARKHAND"],
            "JHARKHAND":  ["JHARKHAND"],
            "AR":         ["ARUNACHAL PRADESH"],
            "KASHMIR":    ["JAMMU AND KASHMIR"],
            "JAMMU":      ["JAMMU AND KASHMIR"],
            "J&K":        ["JAMMU AND KASHMIR"],
            "GURGAON":    ["HARYANA"],
            "HARYANA":    ["HARYANA"],
            "NEW DELHI":  ["DELHI"],
            "ORISSA":     ["ODISHA"],
            "ODISHA":     ["ODISHA"],
        }
        if split.lower() == "state":
            val_up = value.strip().upper()
            # All alternate names this value might appear as in parquet
            _REV_NORM = {v: k for k, v in _STATE_NORM.items()}
            _targets = {val_up, _REV_NORM.get(val_up, val_up)}  # e.g. ODISHA → also match ORISSA

            stores = []
            seen_codes: set = set()
            try:
                from app.core.parquet_cache import has_output, read_cache as _rc
                if has_output("MISRETAIL", "T_STORE_OPENING_DATE"):
                    sod = _rc("MISRETAIL", "T_STORE_OPENING_DATE")
                    if sod is not None and "state" in sod.columns:
                        mask = sod["state"].fillna("—").str.strip().str.upper().isin(_targets) & \
                               sod["store_status"].str.upper().isin(["ACTIVE", "UPCOMING_STORE"])
                        sod_f = sod[mask].copy()
                        for r in sod_f.to_dict("records"):
                            code = str(r.get("store_name", "—")).strip()
                            seen_codes.add(code)
                            sm = store_lookup.get(code, {})
                            name = str(sm.get("store_name_f", sm.get("location", ""))) \
                                   if sm else str(r.get("initial_name", r.get("location", "")))
                            raw_status = str(r.get("store_status", "")).strip().upper()
                            status = raw_status
                            area_v = r.get("area")
                            try:
                                area_f = None if area_v is None or pd.isna(area_v) else float(area_v)
                            except Exception:
                                area_f = None
                            grade = str(sm.get("store_grade", r.get("store_grade", ""))) if sm else str(r.get("store_grade", ""))
                            stores.append({
                                "code": code, "name": name, "status": status,
                                "grade": grade, "zone": str(r.get("zone", "")),
                                "state": str(r.get("state", value)), "area": area_f,
                            })
            except Exception as exc:
                logger.warning("stores-by state parquet failed, falling back: %s", exc)

            # Fallback: store master (active only) if parquet gave nothing
            if not stores:
                master_names = _PARQUET_TO_MASTER.get(val_up, [val_up])
                mask2 = store_df["state_name"].fillna("").str.upper().isin([n.upper() for n in master_names])
                for r in store_df[mask2].to_dict("records"):
                    area_v = r.get("area")
                    try:
                        area_f = None if area_v is None or pd.isna(area_v) else float(area_v)
                    except Exception:
                        area_f = None
                    stores.append({
                        "code": str(r.get("store_name", "—")),
                        "name": str(r.get("store_name_f", r.get("location", ""))),
                        "status": str(r.get("store_status", "")).strip().upper(),
                        "grade": str(r.get("store_grade", "")),
                        "zone": str(r.get("zone", "")),
                        "state": str(r.get("state_name", "")),
                        "area": area_f,
                    })

            STATUS_ORDER = {"ACTIVE": 0, "UPCOMING_STORE": 1}
            stores.sort(key=lambda x: (STATUS_ORDER.get(x["status"], 2), x["code"]))
            return APIResponse.ok(data={"stores": stores, "count": len(stores), "split": split, "value": value})

        # FY / CY split — filter by opening_date year
        if split.lower() in ("fy", "cy"):
            def _fy_label(dt) -> str:
                return f"FY{str(dt.year + 1)[-2:]}" if dt.month >= 4 else f"FY{str(dt.year)[-2:]}"

            stores = []
            if "opening_date" in store_df.columns:
                od = pd.to_datetime(store_df["opening_date"], errors="coerce")
                valid = store_df[od.notna()].copy()
                valid["_fy"] = od[od.notna()].apply(_fy_label)
                valid["_cy"] = od[od.notna()].dt.year.astype(str)
                col_key = "_fy" if split.lower() == "fy" else "_cy"
                filtered_yr = valid[valid[col_key].str.upper() == value.strip().upper()]
                for r in filtered_yr.to_dict("records"):
                    area_v = r.get("area")
                    try:
                        area_f = None if area_v is None or pd.isna(area_v) else float(area_v)
                    except Exception:
                        area_f = None
                    stores.append({
                        "code":   str(r.get("store_name", "—")),
                        "name":   str(r.get("store_name_f", r.get("location", ""))),
                        "status": str(r.get("store_status", "ACTIVE")).strip().upper(),
                        "grade":  str(r.get("store_grade", "")),
                        "zone":   str(r.get("zone", "")),
                        "state":  str(r.get("state_name", "")),
                        "area":   area_f,
                        "opening_date": str(r.get("opening_date", ""))[:10],
                    })
            # Also merge upcoming from parquet (store_tag has FY info)
            try:
                from app.core.parquet_cache import has_output, read_cache as _rc
                if has_output("MISRETAIL", "T_STORE_OPENING_DATE"):
                    sod = _rc("MISRETAIL", "T_STORE_OPENING_DATE")
                    if sod is not None and "store_status" in sod.columns and "store_tag" in sod.columns:
                        import re as _re
                        up = sod[sod["store_status"].str.upper() == "UPCOMING_STORE"].copy()
                        existing_codes = {s["code"] for s in stores}
                        def _tag_fy(tag: str) -> str:
                            m = _re.search(r"FY(\d{2,4})", str(tag), _re.IGNORECASE)
                            return f"FY{m.group(1)[-2:]}" if m else "FY27"
                        def _tag_cy(tag: str) -> str:
                            m = _re.search(r"FY(\d{2,4})", str(tag), _re.IGNORECASE)
                            return str(2000 + int(m.group(1)[-2:]) - 1) if m else "2026"
                        up["_match"] = up["store_tag"].fillna("").apply(
                            _tag_fy if split.lower() == "fy" else _tag_cy
                        )
                        for r in up[up["_match"].str.upper() == value.strip().upper()].to_dict("records"):
                            code = str(r.get("store_name", "—")).strip()
                            if code in existing_codes:
                                continue
                            existing_codes.add(code)
                            sm = store_lookup.get(code, {})
                            area_v = r.get("area")
                            try:
                                area_f = None if area_v is None or pd.isna(area_v) else float(area_v)
                            except Exception:
                                area_f = None
                            stores.append({
                                "code":   code,
                                "name":   str(sm.get("store_name_f", r.get("initial_name", ""))),
                                "status": "UPCOMING",
                                "grade":  str(sm.get("store_grade", r.get("store_grade", ""))),
                                "zone":   str(sm.get("zone", r.get("zone", ""))),
                                "state":  str(r.get("state", "")),
                                "area":   area_f,
                                "opening_date": str(r.get("store_tag", "")),
                            })
            except Exception as exc:
                logger.warning("fy/cy upcoming merge failed: %s", exc)

            STATUS_ORDER = {"ACTIVE": 0, "UPCOMING_STORE": 1}
            stores.sort(key=lambda x: (STATUS_ORDER.get(x["status"], 2), x.get("opening_date", ""), x["code"]))
            return APIResponse.ok(data={"stores": stores, "count": len(stores), "split": split, "value": value})

        # Default: filter directly from store master
        if col not in store_df.columns:
            return APIResponse.ok(data={"stores": [], "count": 0,
                                        "note": f"Column {col} not available"})

        mask = (store_df[col].fillna("—").str.strip().str.upper() == value.strip().upper()) & \
               (store_df["store_status"].fillna("").str.strip().str.upper().isin(["ACTIVE", "UPCOMING_STORE"]))
        filtered = store_df[mask].copy()

        stores = []
        seen_codes: set = set()
        for r in filtered.to_dict("records"):
            area_v = r.get("area")
            code = str(r.get("store_name", "—"))
            seen_codes.add(code)
            try:
                area_f = None if area_v is None or pd.isna(area_v) else float(area_v)
            except Exception:
                area_f = None
            stores.append({
                "code":   code,
                "name":   str(r.get("store_name_f", r.get("location", ""))),
                "status": str(r.get("store_status", "")).strip().upper(),
                "grade":  str(r.get("store_grade", "")),
                "zone":   str(r.get("zone", "")),
                "state":  str(r.get("state_name", "")),
                "area":   area_f,
            })

        # store_master parquet already contains UPCOMING_STORE stores (via T_STORE_OPENING_DATE LEFT JOIN)
        # No secondary merge needed — avoids duplicates from mismatched store code keys

        # Sort: ACTIVE first, UPCOMING_STORE next; then alpha by code
        STATUS_ORDER = {"ACTIVE": 0, "UPCOMING_STORE": 1}
        stores.sort(key=lambda x: (STATUS_ORDER.get(x["status"], 2), x["code"]))
        return APIResponse.ok(data={
            "stores": stores,
            "count": len(stores),
            "split": split,
            "value": value,
        })

    except Exception as exc:
        logger.warning("stores-by failed: %s", exc)
        return APIResponse.fail(str(exc))


@router.get("/store-map-data", response_model=APIResponse)
async def store_map_data():
    """Return store locations with lat/lon, zone, cluster for map rendering."""
    try:
        import re as _re
        from app.core.parquet_cache import has_output, read_cache as _rc
        from app.repositories.store_repository import StoreRepository

        sod = _rc("MISRETAIL", "T_STORE_OPENING_DATE") if has_output("MISRETAIL", "T_STORE_OPENING_DATE") else None
        if sod is None:
            return APIResponse.ok(data={"stores": []})

        sod = sod.copy()
        sod.columns = [c.lower() for c in sod.columns]

        def _parse(s) -> float | None:
            if pd.isna(s): return None
            m = _re.search(r"([\d.]+)", str(s))
            v = float(m.group(1)) if m else 0.0
            return v if v > 1 else None

        # In data: "latitude" col contains ° E (longitude), "longitude" col contains ° N (latitude)
        sod["_lon"] = sod["latitude"].apply(_parse)
        sod["_lat"] = sod["longitude"].apply(_parse)

        # Join zone from store_master (sod has no zone col)
        sm = StoreRepository().get_all_stores(active_only=False)
        sm2 = sm[["store_name", "zone", "store_name_f"]].copy()
        sm2["store_name"] = sm2["store_name"].astype(str)
        sod["site_code"] = sod["site_code"].astype(str)
        merged = sod.merge(sm2, left_on="site_code", right_on="store_name", how="left")

        city_col = next((c for c in ("city_name", "city", "store_city") if c in merged.columns), None)

        stores = []
        for r in merged.to_dict("records"):
            lat = r.get("_lat")
            lon = r.get("_lon")
            if not lat or not lon: continue
            if not (8 <= lat <= 37 and 68 <= lon <= 98): continue
            status = str(r.get("store_status", "")).strip().upper()
            stores.append({
                "code":    str(r.get("site_code", "")),
                "name":    str(r.get("store_name_f") or r.get("store_name") or r.get("initial_name") or ""),
                "lat":     round(lat, 6),
                "lon":     round(lon, 6),
                "zone":    str(r.get("zone") or "").strip() or "-",
                "cluster": str(r.get("cluster_type") or "").strip() or "-",
                "status":  status,
                "grade":   str(r.get("store_grade") or ""),
                "state":   str(r.get("state") or ""),
                "city":    str(r.get(city_col) or "") if city_col else "",
            })
        return APIResponse.ok(data={"stores": stores, "count": len(stores)})
    except Exception as exc:
        logger.warning("store-map-data failed: %s", exc)
        return APIResponse.fail(str(exc))


# ── Store temperatures — Open-Meteo batch (1-hour cache) ─────────────────────
_temp_cache: dict = {}
_temp_cache_ts: float = 0.0
_TEMP_TTL = 3600  # 1 hour


@router.get("/store-temperatures", response_model=APIResponse)
async def store_temperatures():
    """Fetch current temperature for all stores with valid lat/lon via Open-Meteo.
    Results cached for 1 hour. Returns {site_code: temperature_celsius}."""
    global _temp_cache, _temp_cache_ts
    if _temp_cache and (time.time() - _temp_cache_ts) < _TEMP_TTL:
        return APIResponse.ok(data=_temp_cache)

    try:
        import re as _re
        import urllib.request
        import json as _json
        from app.core.parquet_cache import has_output, read_cache as _rc

        sod = _rc("MISRETAIL", "T_STORE_OPENING_DATE") if has_output("MISRETAIL", "T_STORE_OPENING_DATE") else None
        if sod is None:
            return APIResponse.ok(data={})

        sod = sod.copy()
        sod.columns = [c.lower() for c in sod.columns]

        def _parse(s) -> float | None:
            if pd.isna(s): return None
            m = _re.search(r"([\d.]+)", str(s))
            v = float(m.group(1)) if m else 0.0
            return v if v > 1 else None

        # Note: column names are swapped in source data
        sod["_lon"] = sod["latitude"].apply(_parse)
        sod["_lat"] = sod["longitude"].apply(_parse)

        valid = sod[
            sod["_lat"].notna() & sod["_lon"].notna() &
            (sod["_lat"].between(8, 37)) & (sod["_lon"].between(68, 98))
        ][["site_code", "_lat", "_lon"]].copy()

        if valid.empty:
            return APIResponse.ok(data={})

        codes  = valid["site_code"].astype(str).tolist()
        lats   = valid["_lat"].round(4).tolist()
        lons   = valid["_lon"].round(4).tolist()

        lat_str = ",".join(str(x) for x in lats)
        lon_str = ",".join(str(x) for x in lons)
        url = (
            f"https://api.open-meteo.com/v1/forecast"
            f"?latitude={lat_str}&longitude={lon_str}"
            f"&current=temperature_2m"
            f"&daily=temperature_2m_max,temperature_2m_min"
            f"&forecast_days=1&timezone=Asia%2FKolkata"
        )

        req = urllib.request.Request(url, headers={"User-Agent": "CityKartAlloc/1.0"})
        with urllib.request.urlopen(req, timeout=15) as resp:
            payload = _json.loads(resp.read())

        # payload is a list when multiple locations; single dict when one location
        if isinstance(payload, dict):
            payload = [payload]

        result: dict = {}
        for code, item in zip(codes, payload):
            try:
                cur  = round(float(item["current"]["temperature_2m"]), 1)
                tmax = round(float(item["daily"]["temperature_2m_max"][0]), 1)
                tmin = round(float(item["daily"]["temperature_2m_min"][0]), 1)
                result[str(code)] = {"cur": cur, "max": tmax, "min": tmin}
            except Exception:
                pass

        _temp_cache = result
        _temp_cache_ts = time.time()
        return APIResponse.ok(data=result)

    except Exception as exc:
        logger.warning("store-temperatures failed: %s", exc)
        # Return stale cache if available
        if _temp_cache:
            return APIResponse.ok(data=_temp_cache)
        return APIResponse.ok(data={})


# ── Store monthly temps — Open-Meteo archive (24-hour cache) ─────────────────
_monthly_cache: dict = {}   # stores at most one entry: {"key": str, "data": ..., "ts": float}
_MONTHLY_TTL = 86400  # 24 hours


@router.get("/store-monthly-temps", response_model=APIResponse)
async def store_monthly_temps(years: int = 3, predict: int = 0):
    """Fetch last N years of monthly min/max temp per store via Open-Meteo archive.
    Returns {site_code: {YYYY-MM: {min, max}}}. Cached 24 hours."""
    global _monthly_cache
    cache_key = f"{years}_{predict}"
    if (_monthly_cache.get("key") == cache_key
            and (time.time() - _monthly_cache.get("ts", 0)) < _MONTHLY_TTL):
        return APIResponse.ok(data=_monthly_cache["data"])

    try:
        import re as _re2
        import urllib.request
        import json as _json

        def _parse_coord(s):
            if pd.isna(s): return None
            m = _re2.search(r"([\d.]+)", str(s))
            v = float(m.group(1)) if m else 0.0
            return v if v > 1 else None

        from app.core.parquet_cache import has_output, read_cache as _rc
        if not has_output("MISRETAIL", "T_STORE_OPENING_DATE"):
            return APIResponse.ok(data={})
        df = _rc("MISRETAIL", "T_STORE_OPENING_DATE")
        df["_lat"] = df["longitude"].apply(_parse_coord)   # col named "longitude" holds ° N (lat)
        df["_lon"] = df["latitude"].apply(_parse_coord)    # col named "latitude" holds ° E (lon)
        valid = df.dropna(subset=["_lat", "_lon", "site_code"]).copy()
        valid = valid[valid["_lat"].between(8, 37) & valid["_lon"].between(68, 98)]

        codes = valid["site_code"].astype(str).tolist()
        lats  = valid["_lat"].round(4).tolist()
        lons  = valid["_lon"].round(4).tolist()

        from datetime import date, timedelta
        # Archive API has ~5 day lag; use end of last complete month to be safe
        today = date.today()
        first_of_month = today.replace(day=1)
        end   = first_of_month - timedelta(days=1)   # last day of previous month
        start = date(end.year - years, end.month, 1)

        BATCH = 20
        result: dict = {}
        import time as _time

        for b in range(0, len(codes), BATCH):
            if b > 0:
                _time.sleep(10)  # Open-Meteo free tier: keep under 6 req/min
            bc  = codes[b:b+BATCH]
            bla = lats[b:b+BATCH]
            blo = lons[b:b+BATCH]
            url = (
                f"https://archive-api.open-meteo.com/v1/archive"
                f"?latitude={','.join(str(x) for x in bla)}"
                f"&longitude={','.join(str(x) for x in blo)}"
                f"&start_date={start}&end_date={end}"
                f"&daily=temperature_2m_max,temperature_2m_min"
                f"&timezone=Asia%2FKolkata"
            )
            req = urllib.request.Request(url, headers={"User-Agent": "CityKartAlloc/1.0"})
            for _attempt in range(3):
                try:
                    with urllib.request.urlopen(req, timeout=60) as resp:
                        payload = _json.loads(resp.read())
                    break
                except Exception as _e:
                    if _attempt < 2:
                        logger.warning("batch %d attempt %d failed: %s — retrying in 60s", b // BATCH, _attempt, _e)
                        _time.sleep(60)
                    else:
                        raise
            if isinstance(payload, dict):
                payload = [payload]

            for code, item in zip(bc, payload):
                daily = item.get("daily", {})
                dates  = daily.get("time", [])
                tmaxs  = daily.get("temperature_2m_max", [])
                tmins  = daily.get("temperature_2m_min", [])
                monthly: dict = {}
                for d_str, tmax, tmin in zip(dates, tmaxs, tmins):
                    ym = d_str[:7]  # YYYY-MM
                    if tmax is None or tmin is None:
                        continue
                    if ym not in monthly:
                        monthly[ym] = {"max_vals": [], "min_vals": []}
                    monthly[ym]["max_vals"].append(float(tmax))
                    monthly[ym]["min_vals"].append(float(tmin))
                result[str(code)] = {
                    ym: {"max": round(max(v["max_vals"]), 1), "min": round(min(v["min_vals"]), 1)}
                    for ym, v in monthly.items()
                }

        if predict:
            from datetime import date as _date
            today = _date.today()
            for store_code, monthly in result.items():
                for i in range(0, 12):  # i=0 = current month (not yet complete in archive)
                    future_m = (today.month - 1 + i) % 12 + 1
                    future_y = today.year + (today.month - 1 + i) // 12
                    future_ym = f"{future_y}-{future_m:02d}"
                    if future_ym in monthly:
                        continue
                    hist_vals = [
                        (v["max"], v["min"])
                        for ym, v in monthly.items()
                        if int(ym[5:7]) == future_m and not v.get("predicted")
                    ]
                    if hist_vals:
                        avg_max = round(sum(x[0] for x in hist_vals) / len(hist_vals), 1)
                        avg_min = round(sum(x[1] for x in hist_vals) / len(hist_vals), 1)
                        monthly[future_ym] = {"max": avg_max, "min": avg_min, "predicted": True}

        _monthly_cache = {"key": cache_key, "data": result, "ts": time.time()}
        return APIResponse.ok(data=result)

    except Exception as exc:
        import traceback
        logger.error("store-monthly-temps failed: %s\n%s", exc, traceback.format_exc())
        if _monthly_cache.get("key") == cache_key:
            return APIResponse.ok(data=_monthly_cache["data"])
        return APIResponse.fail(f"store-monthly-temps error: {exc}")


@router.get("/store-master-csv")
def store_master_csv():
    """Download full store master as CSV."""
    import io
    from fastapi.responses import StreamingResponse
    from app.repositories.store_repository import StoreRepository

    repo = StoreRepository()
    df = repo.get_all_stores(active_only=False)

    # Friendly column order / names
    col_map = {
        "store_name":   "Store Code",
        "store_name_f": "Store Name",
        "zone":         "Zone",
        "state_name":   "State",
        "city":         "City",
        "district":     "District",
        "cluster_type": "Cluster",
        "store_grade":  "Grade",
        "store_tag":    "Tag",
        "store_status": "Status",
        "opening_date": "Opening Date",
    }
    out_cols = [c for c in col_map if c in df.columns]
    out = df[out_cols].rename(columns=col_map)

    buf = io.StringIO()
    out.to_csv(buf, index=False)
    buf.seek(0)

    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=store_master.csv"},
    )
