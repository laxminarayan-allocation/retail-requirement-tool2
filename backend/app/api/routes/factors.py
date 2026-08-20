"""
Factor Engine routes — Phase 5.

Factor sets are stored in SQLite (not Oracle). They hold the business rules
that drive the replenishment calculation engine in Phase 6.
"""
import io
import logging
from typing import Optional

import openpyxl
from fastapi import APIRouter, HTTPException, UploadFile, File
from fastapi.responses import StreamingResponse

from app.models.factor_models import (
    DivisionFactorUpdate,
    FactorConfig,
    FactorSet,
    FactorSetCreate,
    FactorSetUpdate,
    GradeFactorUpdate,
)
from app.models.response_models import APIResponse
from app.repositories.factor_repository import FactorRepository

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/factors", tags=["Factors"])

_repo = FactorRepository()


def _require_set(set_id: str) -> FactorSet:
    fs = _repo.get_set(set_id)
    if not fs:
        raise HTTPException(status_code=404, detail=f"Factor set {set_id!r} not found")
    return fs


# ── CRUD ──────────────────────────────────────────────────────────────────────

@router.get("", response_model=APIResponse)
async def list_factor_sets():
    """List all factor sets (metadata only, no nested config)."""
    try:
        sets = _repo.list_sets()
        return APIResponse.ok(data={"factor_sets": [s.model_dump(exclude={"config", "grade_factors", "division_factors"}) for s in sets], "count": len(sets)})
    except Exception as exc:
        logger.error("list_factor_sets: %s", exc)
        return APIResponse.fail(message=str(exc))


@router.post("", response_model=APIResponse, status_code=201)
async def create_factor_set(payload: FactorSetCreate):
    """Create a new factor set with default or provided config."""
    try:
        fs = _repo.create_set(payload)
        return APIResponse.ok(data=fs.model_dump(), message=f"Factor set '{fs.name}' created")
    except Exception as exc:
        logger.error("create_factor_set: %s", exc)
        return APIResponse.fail(message=str(exc))


@router.get("/active", response_model=APIResponse)
async def get_active_factor_set():
    """Return the currently active factor set (used by the calc engine)."""
    try:
        fs = _repo.get_active_set()
        if not fs:
            return APIResponse.ok(data=None, message="No active factor set")
        return APIResponse.ok(data=fs.model_dump())
    except Exception as exc:
        return APIResponse.fail(message=str(exc))


@router.get("/{set_id}", response_model=APIResponse)
async def get_factor_set(set_id: str):
    """Return a single factor set with full config, grades, and divisions."""
    try:
        return APIResponse.ok(data=_require_set(set_id).model_dump())
    except HTTPException as e:
        return APIResponse.fail(message=e.detail)
    except Exception as exc:
        return APIResponse.fail(message=str(exc))


@router.patch("/{set_id}", response_model=APIResponse)
async def update_factor_set(set_id: str, payload: FactorSetUpdate):
    """Update name / season / notes / is_active on a factor set."""
    try:
        _require_set(set_id)
        fs = _repo.update_set(set_id, payload)
        return APIResponse.ok(data=fs.model_dump() if fs else None)
    except HTTPException as e:
        return APIResponse.fail(message=e.detail)
    except Exception as exc:
        return APIResponse.fail(message=str(exc))


@router.delete("/{set_id}", response_model=APIResponse)
async def delete_factor_set(set_id: str):
    """Delete a factor set. Cannot delete the active set."""
    try:
        fs = _require_set(set_id)
        if fs.is_active:
            return APIResponse.fail(message="Cannot delete the active factor set. Deactivate it first.")
        ok = _repo.delete_set(set_id)
        return APIResponse.ok(message="Deleted" if ok else "Not found")
    except HTTPException as e:
        return APIResponse.fail(message=e.detail)
    except Exception as exc:
        return APIResponse.fail(message=str(exc))


@router.post("/{set_id}/clone", response_model=APIResponse, status_code=201)
async def clone_factor_set(set_id: str, new_name: Optional[str] = None):
    """Clone a factor set under a new name."""
    try:
        source = _require_set(set_id)
        name = new_name or f"{source.name} (copy)"
        fs = _repo.clone_set(set_id, name)
        return APIResponse.ok(data=fs.model_dump() if fs else None, message=f"Cloned as '{name}'")
    except HTTPException as e:
        return APIResponse.fail(message=e.detail)
    except Exception as exc:
        return APIResponse.fail(message=str(exc))


# ── Config update ──────────────────────────────────────────────────────────────

@router.put("/{set_id}/config", response_model=APIResponse)
async def update_config(set_id: str, config: FactorConfig):
    """Replace the global factor config (safety_days, fill_rate, etc.)."""
    try:
        _require_set(set_id)
        fs = _repo.update_config(set_id, config)
        return APIResponse.ok(data=fs.model_dump() if fs else None)
    except HTTPException as e:
        return APIResponse.fail(message=e.detail)
    except Exception as exc:
        return APIResponse.fail(message=str(exc))


# ── Grade factors ──────────────────────────────────────────────────────────────

@router.put("/{set_id}/grades/{grade}", response_model=APIResponse)
async def upsert_grade_factor(set_id: str, grade: str, payload: GradeFactorUpdate):
    """Set pbs_multiplier and optional safety_days_override for a grade."""
    try:
        _require_set(set_id)
        fs = _repo.upsert_grade_factor(set_id, grade.upper(), payload)
        return APIResponse.ok(data=fs.model_dump() if fs else None)
    except HTTPException as e:
        return APIResponse.fail(message=e.detail)
    except Exception as exc:
        return APIResponse.fail(message=str(exc))


# ── Division factors ───────────────────────────────────────────────────────────

@router.put("/{set_id}/divisions/{division}", response_model=APIResponse)
async def upsert_division_factor(set_id: str, division: str, payload: DivisionFactorUpdate):
    """Set excluded flag and optional safety_days_override for a division."""
    try:
        _require_set(set_id)
        fs = _repo.upsert_division_factor(set_id, division, payload)
        return APIResponse.ok(data=fs.model_dump() if fs else None)
    except HTTPException as e:
        return APIResponse.fail(message=e.detail)
    except Exception as exc:
        return APIResponse.fail(message=str(exc))


# ── Excel import / export ──────────────────────────────────────────────────────

@router.get("/{set_id}/export", response_class=StreamingResponse)
async def export_factor_set(set_id: str):
    """Download the factor set as an Excel workbook."""
    fs = _require_set(set_id)

    wb = openpyxl.Workbook()

    # Sheet 1 — Info
    ws_info = wb.active
    ws_info.title = "Info"
    ws_info.append(["Field", "Value"])
    ws_info.append(["Name", fs.name])
    ws_info.append(["Attribute1", fs.attribute1 or ""])
    ws_info.append(["Season", fs.season or ""])
    ws_info.append(["Notes", fs.notes or ""])
    ws_info.append(["ID", fs.id])
    ws_info.append(["Created", fs.created_at])

    # Sheet 2 — Config
    ws_cfg = wb.create_sheet("Config")
    ws_cfg.append(["Parameter", "Value", "Description"])
    if fs.config:
        ws_cfg.append(["safety_days", fs.config.safety_days, "Days of safety stock buffer"])
        ws_cfg.append(["fill_rate_target", fs.config.fill_rate_target, "Target fill rate (0-1)"])
        ws_cfg.append(["min_alloc_qty", fs.config.min_alloc_qty, "Minimum allocation quantity"])
        ws_cfg.append(["max_alloc_factor", fs.config.max_alloc_factor, "Max = PBS × this factor"])
        ws_cfg.append(["use_grade_pbs", int(fs.config.use_grade_pbs), "1=use grade PBS multipliers, 0=skip"])

    # Sheet 3 — Grade Factors
    ws_grade = wb.create_sheet("Grade Factors")
    ws_grade.append(["grade", "pbs_multiplier", "safety_days_override"])
    for gf in fs.grade_factors:
        ws_grade.append([gf.grade, gf.pbs_multiplier, gf.safety_days_override])

    # Sheet 4 — Division Factors
    ws_div = wb.create_sheet("Division Factors")
    ws_div.append(["division", "excluded", "safety_days_override"])
    for df in fs.division_factors:
        ws_div.append([df.division, int(df.excluded), df.safety_days_override])

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)

    safe_name = "".join(c if c.isalnum() or c in "-_ " else "_" for c in fs.name)
    filename = f"factors_{safe_name}.xlsx"

    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/template/download", response_class=StreamingResponse)
async def download_template():
    """Download a blank factor set Excel template."""
    wb = openpyxl.Workbook()

    ws_info = wb.active
    ws_info.title = "Info"
    ws_info.append(["Field", "Value"])
    for row in [["Name", "My Factor Set"], ["Attribute1", "PREWINTER"], ["Season", "AW26"], ["Notes", ""]]:
        ws_info.append(row)

    ws_cfg = wb.create_sheet("Config")
    ws_cfg.append(["Parameter", "Value", "Description"])
    ws_cfg.append(["safety_days", 14, "Days of safety stock buffer"])
    ws_cfg.append(["fill_rate_target", 0.85, "Target fill rate (0-1)"])
    ws_cfg.append(["min_alloc_qty", 1, "Minimum allocation quantity"])
    ws_cfg.append(["max_alloc_factor", 2.0, "Max = PBS × this factor"])
    ws_cfg.append(["use_grade_pbs", 1, "1=use grade PBS multipliers, 0=skip"])

    ws_grade = wb.create_sheet("Grade Factors")
    ws_grade.append(["grade", "pbs_multiplier", "safety_days_override"])
    for grade, mult in [("A+", 1.2), ("A", 1.1), ("B+", 1.0), ("B", 0.9), ("C", 0.8), ("D", 0.7)]:
        ws_grade.append([grade, mult, None])

    ws_div = wb.create_sheet("Division Factors")
    ws_div.append(["division", "excluded", "safety_days_override"])
    for div in ["MENS", "LADIES", "KIDS"]:
        ws_div.append([div, 0, None])

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)

    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="factor_template.xlsx"'},
    )


@router.post("/import", response_model=APIResponse, status_code=201)
async def import_factor_set(file: UploadFile = File(...)):
    """
    Upload an Excel workbook (matching the template format) to create a new factor set.
    Sheets: Info, Config, Grade Factors, Division Factors.
    """
    if not file.filename or not file.filename.lower().endswith((".xlsx", ".xls")):
        return APIResponse.fail(message="Only .xlsx / .xls files are accepted")

    try:
        content = await file.read()
        wb = openpyxl.load_workbook(io.BytesIO(content), data_only=True)

        def sheet_to_dict(ws) -> dict:
            rows = list(ws.iter_rows(values_only=True))
            if len(rows) < 2:
                return {}
            return {str(r[0]).strip(): r[1] for r in rows[1:] if r[0] is not None}

        def sheet_to_list(ws) -> list[dict]:
            rows = list(ws.iter_rows(values_only=True))
            if not rows:
                return []
            headers = [str(h).strip() for h in rows[0] if h is not None]
            result = []
            for row in rows[1:]:
                if all(v is None for v in row):
                    continue
                result.append(dict(zip(headers, row)))
            return result

        # Info sheet
        info = {}
        if "Info" in wb.sheetnames:
            info = sheet_to_dict(wb["Info"])

        name = str(info.get("Name") or "Imported Factor Set")
        attribute1 = str(info.get("Attribute1") or "") or None
        season = str(info.get("Season") or "") or None
        notes = str(info.get("Notes") or "") or None

        # Config sheet
        config = FactorConfig()
        if "Config" in wb.sheetnames:
            cfg_map = sheet_to_dict(wb["Config"])
            try:
                config = FactorConfig(
                    safety_days=int(cfg_map.get("safety_days", 14)),
                    fill_rate_target=float(cfg_map.get("fill_rate_target", 0.85)),
                    min_alloc_qty=int(cfg_map.get("min_alloc_qty", 1)),
                    max_alloc_factor=float(cfg_map.get("max_alloc_factor", 2.0)),
                    use_grade_pbs=bool(int(cfg_map.get("use_grade_pbs", 1))),
                )
            except Exception as e:
                logger.warning("Config sheet parse error: %s — using defaults", e)

        # Grade Factors sheet
        grade_factors = []
        if "Grade Factors" in wb.sheetnames:
            for row in sheet_to_list(wb["Grade Factors"]):
                try:
                    grade_factors.append(GradeFactorUpdate(
                        pbs_multiplier=float(row.get("pbs_multiplier", 1.0)),
                        safety_days_override=int(row["safety_days_override"]) if row.get("safety_days_override") is not None else None,
                    ))
                    from app.models.factor_models import GradeFactor
                    grade_factors[-1] = GradeFactor(
                        grade=str(row.get("grade", "")).strip(),
                        pbs_multiplier=float(row.get("pbs_multiplier", 1.0)),
                        safety_days_override=int(row["safety_days_override"]) if row.get("safety_days_override") is not None else None,
                    )
                except Exception:
                    pass

        # Division Factors sheet
        division_factors = []
        if "Division Factors" in wb.sheetnames:
            from app.models.factor_models import DivisionFactor
            for row in sheet_to_list(wb["Division Factors"]):
                try:
                    division_factors.append(DivisionFactor(
                        division=str(row.get("division", "")).strip(),
                        excluded=bool(int(row.get("excluded", 0))),
                        safety_days_override=int(row["safety_days_override"]) if row.get("safety_days_override") is not None else None,
                    ))
                except Exception:
                    pass

        payload = FactorSetCreate(
            name=name,
            attribute1=attribute1,
            season=season,
            notes=notes,
            config=config,
            grade_factors=grade_factors,
            division_factors=division_factors,
        )
        fs = _repo.create_set(payload)
        return APIResponse.ok(data=fs.model_dump(), message=f"Imported '{fs.name}' with {len(fs.grade_factors)} grades, {len(fs.division_factors)} divisions")

    except Exception as exc:
        logger.error("import_factor_set: %s", exc)
        return APIResponse.fail(message=f"Import failed: {exc}")
