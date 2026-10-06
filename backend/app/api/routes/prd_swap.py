"""
PRD Swap — Package Ready to Dispatch swap engine.
Fetches pending challans from CK_A2166.V_PRD_SWAP and recommends
KEEP / REDIRECT / UNASSIGNED decisions based on store requirements.

View columns: CHALLAN_NO, DES_SITEALIAS, DEPARTMENT, DISPLAY_TYPE,
              CHALLAN_QTY, CHALLAN_AMOUNT, OUT_LOCATION, CHALLAN_DATE,
              CHALLAN_STATUS, CHALLAN_BARCODE, AGAINST_SO
"""
import logging
from typing import List, Dict
from fastapi import APIRouter
from pydantic import BaseModel

from app.db.connection import get_connection
from app.models.response_models import APIResponse

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


class RunSwapRequest(BaseModel):
    stores: List[str]
    requirements: List[Requirement]


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/stores")
async def get_prd_stores():
    """Distinct destination stores (DES_SITEALIAS) in V_PRD_SWAP."""
    try:
        with get_connection() as conn:
            cur = conn.cursor()
            cur.execute(
                f"SELECT DES_SITEALIAS FROM ("
                f"  SELECT DISTINCT DES_SITEALIAS FROM {PRD_VIEW}"
                f"  WHERE DES_SITEALIAS IS NOT NULL"
                f") ORDER BY DES_SITEALIAS"
            )
            stores = [r[0] for r in cur.fetchall()]
        return APIResponse.ok(data=stores)
    except Exception as e:
        logger.exception("prd-swap/stores failed")
        return APIResponse.fail(f"Oracle error: {e}")


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
                    "total_value": 0.0,
                }
            d = str(dept).strip()
            q = float(qty) if qty is not None else 0.0
            v = float(amount) if amount is not None else 0.0
            pkg_map[key]["all_depts"][d] = pkg_map[key]["all_depts"].get(d, 0) + q
            pkg_map[key]["total_value"] += v

        pkgs = []
        for pkg in pkg_map.values():
            t7 = sorted(pkg["all_depts"].items(), key=lambda x: x[1], reverse=True)[:7]
            pkgs.append({**pkg, "top7": t7, "top7_total": sum(q for _, q in t7)})

        # 3. Build balance_req from requirements
        balance_req: Dict[str, Dict[str, dict]] = {}
        for r in req.requirements:
            s = str(r.store_name).strip()
            d = str(r.department).strip()
            rq = float(r.req_qty)
            mp = float(r.match_pct)
            sp = int(r.priority)
            balance_req.setdefault(s, {})
            balance_req[s][d] = {
                "original": rq, "balance": rq, "match_pct": mp,
                "swapped": 0.0, "store_priority": sp,
                "allowed_limit": rq * (mp / 100.0),
            }

        # 4. Ordered stores by priority
        ordered_stores = sorted(
            balance_req.keys(),
            key=lambda s: next(iter(balance_req[s].values()))["store_priority"]
                          if balance_req[s] else 99
        )

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
                if prd_value_used.get(sid, 0) + pkg["total_value"] > STORE_VALUE_CAP:
                    continue
                # Match top-7
                tm = 0.0; det = {}
                for dept, pq in pkg["top7"]:
                    if dept not in sd:
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
                if up <= 0:
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
                results.append({
                    "challan_no": pkg["pkg_id"],
                    "from_store": pkg["from_store"],
                    "current_dest": pkg["current_dest"],
                    "recommended_dest": best_sid,
                    "action": action,
                    "depts_matched": ", ".join(best_det.keys()),
                    "util_pct": best_up,
                    "store_priority": b[3],
                    "reason": f"{len(best_det)} dept(s) matched at {best_up}% utilization",
                })
            else:
                top7_str = ", ".join(f"{d}({int(q)})" for d, q in pkg["top7"])
                unassigned.append({
                    "challan_no": pkg["pkg_id"],
                    "from_store": pkg["from_store"],
                    "current_dest": pkg["current_dest"],
                    "top7_depts": top7_str,
                    "reason": "No requirement store matched top-7 depts.",
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
            },
        })
    except Exception as e:
        logger.exception("prd-swap/run failed")
        return APIResponse.fail(f"Swap error: {e}")
