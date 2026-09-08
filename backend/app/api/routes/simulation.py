"""
Simulation routes — Allocation Simulation V7 (React port).

GET  /api/simulation/data   → compact RAW JSON for the simulation engine
GET  /api/simulation/meta   → parquet file timestamps (freshness check)
"""
import json
import logging
import threading
import time
from pathlib import Path
from typing import Any

import pandas as pd
from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse

from app.models.response_models import APIResponse

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/simulation", tags=["Simulation"])

OUTPUT_DIR = Path(__file__).parent.parent.parent.parent / "data" / "output"

_CACHE: dict[str, Any] = {}
_CACHE_LOCK = threading.Lock()


def _pq(owner: str, obj: str) -> Path:
    return OUTPUT_DIR / f"{owner.upper()}__{obj.upper()}.parquet"


def _mtime(p: Path) -> float:
    return p.stat().st_mtime if p.exists() else 0.0


def _build_payload() -> dict:
    """Read parquet files, join, and build compact simulation payload."""
    p_art = _pq("CK_A2166", "V_ART_REQ_APPS")
    p_mc2 = _pq("CK_A2166", "V_MC_REQ_APPS_2")
    p_nso = _pq("CK_A2166", "STORE_MASTER_NSO")

    if not p_art.exists():
        raise FileNotFoundError("V_ART_REQ_APPS.parquet not found — please download it first")

    art = pd.read_parquet(p_art)
    art.columns = [c.lower() for c in art.columns]

    # ── Enrich from V_MC_REQ_APPS_2 using map (avoids merge memory explosion) ──
    extra_mc2 = ["min_wk_str", "max_wk_str", "mdq", "v3_surge", "excess",
                 "proj_1_surge", "proj_2_surge", "proj_3_surge",
                 "proj_4_surge", "proj_5_surge"]
    if p_mc2.exists():
        mc2 = pd.read_parquet(p_mc2)
        mc2.columns = [c.lower() for c in mc2.columns]
        jk = ["location", "attribute1", "division", "section", "department"]
        mc2_avail = [c for c in extra_mc2 if c in mc2.columns]
        # Build lookup dict: tuple(jk values) → {col: val}
        mc2_lu: dict = {}
        for row in mc2[jk + mc2_avail].itertuples(index=False):
            key = (row.location, row.attribute1, row.division, row.section, row.department)
            if key not in mc2_lu:
                mc2_lu[key] = {c: getattr(row, c) for c in mc2_avail}
        # Vectorised map via composite key column
        art["_jk"] = list(zip(
            art["location"], art["attribute1"], art["division"],
            art["section"], art["department"]
        ))
        for col in mc2_avail:
            art[col] = art["_jk"].map(lambda k, c=col: mc2_lu.get(k, {}).get(c))
        art.drop(columns=["_jk"], inplace=True)
    for col in extra_mc2:
        if col not in art.columns:
            art[col] = None

    # ── Enrich from STORE_MASTER_NSO using map (join on store_name) ──────────
    # In V_ART_REQ_APPS: location='STORE'/'DC' (type), store_name=actual code ('AZM')
    # In STORE_MASTER_NSO: store_name=store code, state/city/store_f_name=extras
    nso_extra = ["state", "city_name", "store_f_name", "festival_grouping", "holi_group"]
    if p_nso.exists():
        nso = pd.read_parquet(p_nso)
        nso.columns = [c.lower() for c in nso.columns]
        nso_avail = [c for c in nso_extra if c in nso.columns]
        nso_lu: dict = {}
        for row in nso[["store_name"] + nso_avail].drop_duplicates("store_name").itertuples(index=False):
            nso_lu[str(row.store_name)] = {c: getattr(row, c) for c in nso_avail}
        sn_str = art["store_name"].astype(str)
        for col in nso_avail:
            art[col] = sn_str.map(lambda k, c=col: nso_lu.get(k, {}).get(c))
    for col in nso_extra:
        if col not in art.columns:
            art[col] = None

    # ── Column index map (C) — what index each column sits at in row array ──
    ordered_cols = [
        "store_name",      # 0  ST   store code (AZM, NAH, etc.)
        "store_f_name",    # 1  SN   store full name from NSO
        "store_tag",       # 2  STC
        "store_grade",     # 3  GR
        "zone",            # 4  ZN
        "state",           # 5  LST
        "city_name",       # 6  CITY
        "attribute1",      # 7  AT
        "division",        # 8  DI
        "section",         # 9  SE
        "department",      # 10 DE
        "display_type",    # 11 DT
        "mc_listing",      # 12 MCL
        "store_status",    # 13 SA
        "opening_date",    # 14 OD
        "proj_1",          # 15 P1
        "proj_2",          # 16 P2
        "proj_3",          # 17 P3
        "proj_4",          # 18 P4
        "proj_5",          # 19 P5
        "pbs",             # 20 PBS
        "pbs_fill",        # 21 PBS_FILL
        "pbs_achv",        # 22 PBS_ACHV
        "fnl_pbs",         # 23 FNL_PBS
        "lm_sl_q",         # 24 LM_SL
        "sl_7d_q",         # 25 SL_7D
        "stk_q",           # 26 STK   fresh stock
        "intr_q",          # 27 INTR  transit
        "prd_q",           # 28 PRD   pack pending
        "to_q",            # 29 TO    transfer out
        "adj_stk_q",       # 30 ADJ_STK
        "adj_intr_q",      # 31 ADJ_INTR
        "adj_ttl_stk_q",   # 32 TTL_STK adjusted total
        "tgt_q",           # 33 TGT_Q
        "tgt_v",           # 34 TGT_V
        "sl_q",            # 35 SL_Q  season-to-date sales
        "sl_v",            # 36 SL_V
        "achv_per",        # 37 ACHV
        "use_ach",         # 38 USE_ACH
        "mc_str",          # 39 MC_STR
        "req",             # 40 REQ   original computed req
        "fill_rate",       # 41 FILL
        "fill_rate_rank",  # 42 FR_RANK
        "min_wk_str",      # 43 MIN_WK
        "max_wk_str",      # 44 MAX_WK
        "mdq",             # 45 MDQ
        "v3_surge",        # 46 SURGE
        "excess",          # 47 EXCESS
        "proj_1_surge",    # 48 P1_SURGE
        "proj_2_surge",    # 49 P2_SURGE
        "proj_3_surge",    # 50 P3_SURGE
        "proj_4_surge",    # 51 P4_SURGE
        "proj_5_surge",    # 52 P5_SURGE
    ]

    # Ensure all cols exist (fill missing with None)
    for c in ordered_cols:
        if c not in art.columns:
            art[c] = None

    C = {name: idx for idx, name in enumerate(ordered_cols)}

    # ── Build lookup arrays (string → index, for dropdowns / filters) ───────
    def _lu(series: pd.Series) -> list[str]:
        return sorted(series.dropna().unique().tolist())

    lu = {
        "stores":   _lu(art["store_name"].astype(str)),
        "stcs":     _lu(art["store_tag"].astype(str)),
        "grades":   _lu(art["store_grade"].astype(str)),
        "zones":    _lu(art["zone"].astype(str)),
        "attrs":    _lu(art["attribute1"].astype(str)),
        "divs":     _lu(art["division"].astype(str)),
        "secs":     _lu(art["section"].astype(str)),
        "depts":    _lu(art["department"].astype(str)),
        "dts":      _lu(art["display_type"].astype(str)),
        "states":   _lu(art["state"].astype(str)) if "state" in art.columns else [],
    }

    # ── Store code → full name map ────────────────────────────────────────────
    sm: dict[str, str] = {}
    if "store_f_name" in art.columns:
        sm_df = art[["store_name", "store_f_name"]].drop_duplicates("store_name")
        sm = dict(zip(sm_df["store_name"].astype(str), sm_df["store_f_name"].fillna("").astype(str)))

    # ── Compact row arrays ────────────────────────────────────────────────────
    sub = art[ordered_cols].copy()

    # Normalise types: floats → round(2), NaN → None
    numeric_cols = sub.select_dtypes(include=["number"]).columns.tolist()
    for nc in numeric_cols:
        sub[nc] = sub[nc].where(sub[nc].notna(), other=None)
        # round floats to 2dp to reduce payload size
        if sub[nc].dtype == float:
            sub[nc] = sub[nc].round(2)

    # opening_date → string
    if "opening_date" in sub.columns:
        sub["opening_date"] = sub["opening_date"].astype(str).where(
            sub["opening_date"].notna(), other=None
        )

    rows = sub.values.tolist()
    # replace float nan with None
    def _clean(v: Any) -> Any:
        if v != v:   # NaN check
            return None
        return v

    D = [[_clean(v) for v in row] for row in rows]

    return {
        "C":    C,
        "LU":   lu,
        "SM":   sm,
        "D":    D,
        "meta": {
            "total_rows": len(D),
            "generated":  time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "art_rows":   len(art),
        },
    }


def _get_cached_payload() -> dict:
    """Return cached payload, rebuilding if parquet files have changed."""
    p_art = _pq("CK_A2166", "V_ART_REQ_APPS")
    p_mc2 = _pq("CK_A2166", "V_MC_REQ_APPS_2")
    p_nso = _pq("CK_A2166", "STORE_MASTER_NSO")

    mtimes = (_mtime(p_art), _mtime(p_mc2), _mtime(p_nso))

    with _CACHE_LOCK:
        if _CACHE.get("mtimes") == mtimes and "payload" in _CACHE:
            return _CACHE["payload"]

    logger.info("simulation: building payload (parquet changed or first load)…")
    payload = _build_payload()

    with _CACHE_LOCK:
        _CACHE["mtimes"] = mtimes
        _CACHE["payload"] = payload

    logger.info("simulation: payload ready — %d rows", len(payload["D"]))
    return payload


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/data")
async def get_simulation_data(
    div: str | None = Query(None, description="Filter by division"),
    attr: str | None = Query(None, description="Filter by attribute1"),
    sec: str | None = Query(None, description="Filter by section"),
):
    """
    Return compact simulation payload.
    Optional query params filter rows to reduce payload size.
    """
    try:
        payload = _get_cached_payload()

        # Optional server-side row filter
        if div or attr or sec:
            C = payload["C"]
            rows = payload["D"]
            if div:
                di = C["division"]
                rows = [r for r in rows if r[di] == div]
            if attr:
                ai = C["attribute1"]
                rows = [r for r in rows if r[ai] == attr]
            if sec:
                si = C["section"]
                rows = [r for r in rows if r[si] == sec]

            filtered = {**payload, "D": rows, "meta": {**payload["meta"], "total_rows": len(rows)}}
            return JSONResponse({"success": True, "data": filtered, "message": "ok", "errors": []})

        return JSONResponse({"success": True, "data": payload, "message": "ok", "errors": []})

    except FileNotFoundError as exc:
        return JSONResponse(
            status_code=404,
            content={"success": False, "data": None, "message": str(exc), "errors": []},
        )
    except Exception as exc:
        logger.exception("simulation/data error")
        return JSONResponse(
            status_code=500,
            content={"success": False, "data": None, "message": str(exc), "errors": []},
        )


@router.get("/meta")
async def get_simulation_meta():
    """Return file timestamps and cached status."""
    p_art = _pq("CK_A2166", "V_ART_REQ_APPS")
    p_mc2 = _pq("CK_A2166", "V_MC_REQ_APPS_2")
    p_nso = _pq("CK_A2166", "STORE_MASTER_NSO")

    import time as _time

    def _info(p: Path) -> dict:
        if not p.exists():
            return {"exists": False}
        mt = p.stat().st_mtime
        return {
            "exists": True,
            "mtime":  _time.strftime("%Y-%m-%dT%H:%M:%SZ", _time.gmtime(mt)),
            "size_mb": round(p.stat().st_size / 1024 / 1024, 2),
        }

    with _CACHE_LOCK:
        cached_rows = _CACHE.get("payload", {}).get("meta", {}).get("total_rows", 0)
        is_cached = "payload" in _CACHE

    return JSONResponse({
        "success": True,
        "data": {
            "files": {
                "V_ART_REQ_APPS":  _info(p_art),
                "V_MC_REQ_APPS_2": _info(p_mc2),
                "STORE_MASTER_NSO": _info(p_nso),
            },
            "cache": {"loaded": is_cached, "total_rows": cached_rows},
        },
        "message": "ok",
        "errors": [],
    })
