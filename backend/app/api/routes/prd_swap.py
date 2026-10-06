"""
PRD Swap — Package Ready to Dispatch swap engine.
Fetches pending challans from CK_A2166.V_PRD_SWAP and recommends
KEEP / REDIRECT / UNASSIGNED decisions based on store requirements.

View columns: CHALLAN_NO, DES_SITEALIAS, DEPARTMENT, DISPLAY_TYPE,
              CHALLAN_QTY, CHALLAN_AMOUNT, OUT_LOCATION, CHALLAN_DATE,
              CHALLAN_STATUS, CHALLAN_BARCODE, AGAINST_SO
"""
import io
import logging
from pathlib import Path
from typing import List, Dict
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.db.connection import get_connection
from app.models.response_models import APIResponse

_DATA_DIR = Path(__file__).parent.parent.parent.parent / "data" / "output"
MC_REQ_FILES = [
    _DATA_DIR / "CK_A2166__V_MC_REQ_APPS_2.parquet",
    _DATA_DIR / "CK_A2166__V_MC_REQ_GM.parquet",
]
MC_LISTING_FILE = _DATA_DIR / "MISRETAIL__T_STORE_MC_LISTING.parquet"

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/prd-swap", tags=["PRD Swap"])

PRD_VIEW = "CK_A2166.V_PRD_SWAP"
STORE_VALUE_CAP = 3_750_000  # Rs 37.5 Lakh (same as CL.py)


# ── Request models ────────────────────────────────────────────────────────────

class FetchDataRequest(BaseModel):
    stores: List[str]


class Requirement(BaseModel):
    store_name: str
    department: str
    req_qty: float
    match_pct: float
    priority: int = 1


class SwapParams(BaseModel):
    value_cap: float = 2_000_000       # Rs per store
    default_match_pct: float = 50.0    # % of req_qty allowed per dept
    top_n_depts: int = 7               # top N depts by qty from each challan
    min_util_pct: float = 0.0          # minimum util% to accept a match
    max_stores: int = 15               # only top-N priority stores considered


class RunSwapRequest(BaseModel):
    stores: List[str]
    requirements: List[Requirement]
    params: SwapParams = SwapParams()


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/mc-req")
async def get_mc_req():
    """Load requirements from both V_MC_REQ_APPS_2 and V_MC_REQ_GM parquet files."""
    try:
        import pandas as pd
        frames = []
        loaded = []
        for f in MC_REQ_FILES:
            if f.exists():
                df = pd.read_parquet(f, columns=["store_name", "department", "req"])
                df = df[df["req"] > 0].copy()
                frames.append(df)
                loaded.append(f.stem)
        if not frames:
            return APIResponse.fail("MC_REQ files not found — refresh from Database Explorer first")
        combined = pd.concat(frames, ignore_index=True)
        grp = combined.groupby(["store_name", "department"], as_index=False)["req"].sum()
        reqs = [
            {"store_name": r["store_name"], "department": r["department"],
             "req_qty": float(r["req"]), "match_pct": 50.0, "priority": 1}
            for _, r in grp.iterrows()
        ]
        return APIResponse.ok(data={
            "requirements": reqs,
            "stores": int(grp["store_name"].nunique()),
            "rows": len(reqs),
            "sources": loaded,
        })
    except Exception as e:
        logger.exception("prd-swap/mc-req failed")
        return APIResponse.fail(f"MC_REQ load error: {e}")


@router.get("/stores")
async def get_prd_stores():
    """Destination stores with challan counts, sorted high-to-low."""
    try:
        with get_connection() as conn:
            cur = conn.cursor()
            cur.execute(
                f"SELECT DES_SITEALIAS, COUNT(DISTINCT CHALLAN_NO) AS CNT "
                f"FROM {PRD_VIEW} "
                f"WHERE DES_SITEALIAS IS NOT NULL "
                f"GROUP BY DES_SITEALIAS "
                f"ORDER BY CNT DESC"
            )
            stores = [{"store": r[0], "count": int(r[1])} for r in cur.fetchall()]
        return APIResponse.ok(data=stores)
    except Exception as e:
        logger.exception("prd-swap/stores failed")
        return APIResponse.fail(f"Oracle error: {e}")


@router.get("/mc-listing-csv")
async def download_mc_listing_csv():
    """Download MC listing as CSV (store_name, department, mc_listing)."""
    if not MC_LISTING_FILE.exists():
        return APIResponse.fail("MC Listing file not found — refresh from Database Explorer first")
    try:
        import pandas as pd
        df = pd.read_parquet(MC_LISTING_FILE, columns=["store_name", "department", "mc_listing"])
        df = df.sort_values(["store_name", "department"])
        buf = io.StringIO()
        df.to_csv(buf, index=False)
        buf.seek(0)
        return StreamingResponse(
            io.BytesIO(buf.getvalue().encode()),
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=MC_LISTING.csv"},
        )
    except Exception as e:
        logger.exception("mc-listing-csv failed")
        return APIResponse.fail(f"Error: {e}")


@router.post("/fetch")
async def fetch_prd_data(req: FetchDataRequest):
    """Fetch PRD rows for selected destination stores."""
    if not req.stores:
        return APIResponse.fail("No stores selected")
    try:
        placeholders = ", ".join([f":s{i}" for i in range(len(req.stores))])
        params = {f"s{i}": s for i, s in enumerate(req.stores)}
        sql = (
            f"SELECT CHALLAN_NO, OUT_LOCATION, DES_SITEALIAS, DEPARTMENT, "
            f"       DISPLAY_TYPE, CHALLAN_QTY, CHALLAN_AMOUNT "
            f"FROM {PRD_VIEW} "
            f"WHERE DES_SITEALIAS IN ({placeholders}) "
            f"ORDER BY CHALLAN_NO, DEPARTMENT"
        )
        with get_connection() as conn:
            cur = conn.cursor()
            cur.execute(sql, params)
            cols = [d[0] for d in cur.description]
            rows = [dict(zip(cols, r)) for r in cur.fetchall()]

        # Make Oracle types JSON-safe
        for r in rows:
            for k, v in r.items():
                if hasattr(v, 'isoformat'):
                    r[k] = v.isoformat()
                elif v is not None:
                    r[k] = str(v) if not isinstance(v, (int, float, bool)) else v

        challans = len({r["CHALLAN_NO"] for r in rows})
        return APIResponse.ok(data={"rows": rows, "total_rows": len(rows), "challans": challans})
    except Exception as e:
        logger.exception("prd-swap/fetch failed")
        return APIResponse.fail(f"Oracle error: {e}")


@router.post("/run")
async def run_prd_swap(req: RunSwapRequest):
    """
    Run swap algorithm: match PRD challans against requirements.
    Returns list of {challan_no, from_store, current_dest, recommended_dest,
                     action, depts_matched, util_pct, reason}.
    """
    if not req.stores:
        return APIResponse.fail("No stores selected")
    if not req.requirements:
        return APIResponse.fail("No requirements provided")

    try:
        # 1. Fetch PRD data
        placeholders = ", ".join([f":s{i}" for i in range(len(req.stores))])
        params = {f"s{i}": s for i, s in enumerate(req.stores)}
        sql = (
            f"SELECT CHALLAN_NO, OUT_LOCATION, DES_SITEALIAS, DEPARTMENT, "
            f"       CHALLAN_QTY, CHALLAN_AMOUNT "
            f"FROM {PRD_VIEW} "
            f"WHERE DES_SITEALIAS IN ({placeholders}) "
            f"ORDER BY CHALLAN_NO, DEPARTMENT"
        )
        with get_connection() as conn:
            cur = conn.cursor()
            cur.execute(sql, params)
            raw = cur.fetchall()

        # 2. Build packages grouped by CHALLAN_NO (OUT_LOCATION = source warehouse)
        pkg_map: Dict[str, dict] = {}
        for row in raw:
            challan_no, src, dest, dept, qty, amount = row
            key = str(challan_no)
            if key not in pkg_map:
                pkg_map[key] = {
                    "pkg_id": key,
                    "from_store": str(src) if src else "-",
                    "current_dest": str(dest),
                    "all_depts": {},
                    "total_qty": 0.0,
                    "total_value": 0.0,
                }
            d = str(dept).strip()
            q = float(qty) if qty is not None else 0.0
            v = float(amount) if amount is not None else 0.0
            pkg_map[key]["all_depts"][d] = pkg_map[key]["all_depts"].get(d, 0) + q
            pkg_map[key]["total_qty"] += q
            pkg_map[key]["total_value"] += v

        p = req.params
        pkgs = []
        for pkg in pkg_map.values():
            top_n = sorted(pkg["all_depts"].items(), key=lambda x: x[1], reverse=True)[:p.top_n_depts]
            pkgs.append({**pkg, "top7": top_n, "top7_total": sum(q for _, q in top_n)})

        # 3. Load MC listing filter (store+dept where mc_listing=Y)
        listing_ok: set = set()   # empty = no filter (file missing)
        listing_loaded = False
        if MC_LISTING_FILE.exists():
            import pandas as pd
            ldf = pd.read_parquet(MC_LISTING_FILE, columns=["store_name", "department", "mc_listing"])
            ldf_y = ldf[ldf["mc_listing"].str.upper() == "Y"]
            listing_ok = set(zip(ldf_y["store_name"].str.strip(), ldf_y["department"].str.strip()))
            listing_loaded = True
            logger.info("MC listing loaded: %d Y pairs", len(listing_ok))
        else:
            logger.warning("MC_LISTING file not found — listing filter skipped")

        # 4. Build balance_req from requirements
        balance_req: Dict[str, Dict[str, dict]] = {}
        for r in req.requirements:
            s = str(r.store_name).strip()
            d = str(r.department).strip()
            rq = float(r.req_qty)
            mp = float(r.match_pct) if r.match_pct else p.default_match_pct
            sp = int(r.priority)
            balance_req.setdefault(s, {})
            balance_req[s][d] = {
                "original": rq, "balance": rq, "match_pct": mp,
                "swapped": 0.0, "store_priority": sp,
                "allowed_limit": rq * (mp / 100.0),
            }

        # 4. Ordered stores by priority — limit to top max_stores
        ordered_stores = sorted(
            balance_req.keys(),
            key=lambda s: next(iter(balance_req[s].values()))["store_priority"]
                          if balance_req[s] else 99
        )[:p.max_stores]

        # 5. Run matching
        results = []
        unassigned = []
        prd_value_used: Dict[str, float] = {}

        for pkg in pkgs:
            valid = []
            for sid in ordered_stores:
                if sid not in balance_req:
                    continue
                sd = balance_req[sid]
                if sum(d["balance"] for d in sd.values()) <= 0:
                    continue
                # Value cap
                if prd_value_used.get(sid, 0) + pkg["total_value"] > p.value_cap:
                    continue
                # Match top-7
                tm = 0.0; det = {}
                for dept, pq in pkg["top7"]:
                    if dept not in sd:
                        continue
                    # MC listing filter: skip if listing=N for this store+dept
                    if listing_loaded and (sid, dept) not in listing_ok:
                        continue
                    bal = sd[dept]["balance"]
                    if bal <= 0:
                        continue
                    al = sd[dept]["allowed_limit"]
                    eff = min(pq, al)
                    if eff <= 0:
                        continue
                    matched = min(eff, bal)
                    if matched <= 0:
                        continue
                    tm += matched
                    det[dept] = round(matched, 2)

                if not det or pkg["top7_total"] == 0:
                    continue
                up = (tm / pkg["top7_total"]) * 100
                if up < p.min_util_pct:
                    continue
                d0 = list(det.keys())[0]
                sp = sd[d0]["store_priority"] if d0 in sd else 99
                valid.append((len(det), up, sid, sp, det))

            if valid:
                valid.sort(key=lambda x: (x[0], x[1]), reverse=True)
                b = valid[0]
                best_sid, best_det, best_up = b[2], b[4], round(b[1], 2)
                for dept in best_det:
                    balance_req[best_sid][dept]["balance"] -= best_det[dept]
                    balance_req[best_sid][dept]["swapped"] += best_det[dept]
                prd_value_used[best_sid] = prd_value_used.get(best_sid, 0) + pkg["total_value"]
                action = "KEEP" if best_sid == pkg["current_dest"] else "REDIRECT"
                # mc_listing status for each matched dept (all Y since filter passed)
                listing_col = "; ".join(
                    f"{d}={'Y' if not listing_loaded or (best_sid, d) in listing_ok else 'N'}"
                    for d in best_det.keys()
                )
                results.append({
                    "challan_no": pkg["pkg_id"],
                    "from_store": pkg["from_store"],
                    "current_dest": pkg["current_dest"],
                    "recommended_dest": best_sid,
                    "action": action,
                    "depts_matched": ", ".join(best_det.keys()),
                    "mc_listing": listing_col,
                    "util_pct": best_up,
                    "store_priority": b[3],
                    "total_qty": round(pkg["total_qty"], 2),
                    "total_value": round(pkg["total_value"], 2),
                    "reason": f"{len(best_det)} dept(s) matched at {best_up}% utilization",
                })
            else:
                top7_str = ", ".join(f"{d}({int(q)})" for d, q in pkg["top7"])
                # Diagnose why unassigned: listing blocked or no req match
                listing_blocked = listing_loaded and all(
                    (sid, dept) not in listing_ok
                    for sid in ordered_stores
                    for dept, _ in pkg["top7"]
                    if sid in balance_req
                )
                reason_str = (
                    "Listing blocked — all top depts N for available stores"
                    if listing_blocked
                    else "No requirement store matched top-7 depts"
                )
                unassigned.append({
                    "challan_no": pkg["pkg_id"],
                    "from_store": pkg["from_store"],
                    "current_dest": pkg["current_dest"],
                    "top7_depts": top7_str,
                    "total_qty": round(pkg["total_qty"], 2),
                    "total_value": round(pkg["total_value"], 2),
                    "reason": reason_str,
                })

        kept = sum(1 for r in results if r["action"] == "KEEP")
        redirected = sum(1 for r in results if r["action"] == "REDIRECT")
        return APIResponse.ok(data={
            "results": results,
            "unassigned": unassigned,
            "summary": {
                "keep": kept,
                "redirect": redirected,
                "unassigned": len(unassigned),
                "total_challans": len(pkgs),
                "listing_filter": listing_loaded,
                "listing_pairs": len(listing_ok) if listing_loaded else 0,
            },
        })
    except Exception as e:
        logger.exception("prd-swap/run failed")
        return APIResponse.fail(f"Swap error: {e}")
