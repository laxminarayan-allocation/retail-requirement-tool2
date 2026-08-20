"""
FactorRepository — CRUD for factor sets stored in SQLite.

Factor sets are versioned: each set has a unique id and created_at timestamp.
Only one set can be is_active=1 at a time; activating one deactivates the rest.
"""
import logging
import uuid
from datetime import datetime, timezone
from typing import List, Optional

from app.db.sqlite import get_sqlite
from app.models.factor_models import (
    DivisionFactor,
    DivisionFactorUpdate,
    FactorConfig,
    FactorSet,
    FactorSetCreate,
    FactorSetUpdate,
    GradeFactor,
    GradeFactorUpdate,
)

logger = logging.getLogger(__name__)

DEFAULT_GRADES = ["A+", "A", "B+", "B", "C", "D"]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _row_to_set(row, config_row=None, grade_rows=None, div_rows=None) -> FactorSet:
    config = None
    if config_row:
        config = FactorConfig(
            safety_days=config_row["safety_days"],
            fill_rate_target=config_row["fill_rate_target"],
            min_alloc_qty=config_row["min_alloc_qty"],
            max_alloc_factor=config_row["max_alloc_factor"],
            use_grade_pbs=bool(config_row["use_grade_pbs"]),
        )
    grades = [
        GradeFactor(
            grade=g["grade"],
            pbs_multiplier=g["pbs_multiplier"],
            safety_days_override=g["safety_days_override"],
        )
        for g in (grade_rows or [])
    ]
    divs = [
        DivisionFactor(
            division=d["division"],
            excluded=bool(d["excluded"]),
            safety_days_override=d["safety_days_override"],
        )
        for d in (div_rows or [])
    ]
    return FactorSet(
        id=row["id"],
        name=row["name"],
        attribute1=row["attribute1"],
        season=row["season"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        is_active=bool(row["is_active"]),
        notes=row["notes"],
        config=config,
        grade_factors=grades,
        division_factors=divs,
    )


class FactorRepository:

    def list_sets(self) -> List[FactorSet]:
        with get_sqlite() as conn:
            rows = conn.execute(
                "SELECT * FROM factor_sets ORDER BY created_at DESC"
            ).fetchall()
        return [_row_to_set(r) for r in rows]

    def get_set(self, set_id: str) -> Optional[FactorSet]:
        with get_sqlite() as conn:
            row = conn.execute(
                "SELECT * FROM factor_sets WHERE id = ?", (set_id,)
            ).fetchone()
            if not row:
                return None
            cfg = conn.execute(
                "SELECT * FROM factor_configs WHERE factor_set_id = ?", (set_id,)
            ).fetchone()
            grades = conn.execute(
                "SELECT * FROM grade_factors WHERE factor_set_id = ? ORDER BY grade",
                (set_id,),
            ).fetchall()
            divs = conn.execute(
                "SELECT * FROM division_factors WHERE factor_set_id = ? ORDER BY division",
                (set_id,),
            ).fetchall()
        return _row_to_set(row, cfg, grades, divs)

    def get_active_set(self) -> Optional[FactorSet]:
        with get_sqlite() as conn:
            row = conn.execute(
                "SELECT * FROM factor_sets WHERE is_active = 1 LIMIT 1"
            ).fetchone()
            if not row:
                return None
            set_id = row["id"]
            cfg = conn.execute(
                "SELECT * FROM factor_configs WHERE factor_set_id = ?", (set_id,)
            ).fetchone()
            grades = conn.execute(
                "SELECT * FROM grade_factors WHERE factor_set_id = ? ORDER BY grade",
                (set_id,),
            ).fetchall()
            divs = conn.execute(
                "SELECT * FROM division_factors WHERE factor_set_id = ? ORDER BY division",
                (set_id,),
            ).fetchall()
        return _row_to_set(row, cfg, grades, divs)

    def create_set(self, payload: FactorSetCreate) -> FactorSet:
        set_id = str(uuid.uuid4())
        now = _now()
        with get_sqlite() as conn:
            conn.execute(
                """INSERT INTO factor_sets (id, name, attribute1, season, created_at, updated_at, is_active, notes)
                   VALUES (?, ?, ?, ?, ?, ?, 0, ?)""",
                (set_id, payload.name, payload.attribute1, payload.season, now, now, payload.notes),
            )
            conn.execute(
                """INSERT INTO factor_configs
                   (factor_set_id, safety_days, fill_rate_target, min_alloc_qty, max_alloc_factor, use_grade_pbs, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (
                    set_id,
                    payload.config.safety_days,
                    payload.config.fill_rate_target,
                    payload.config.min_alloc_qty,
                    payload.config.max_alloc_factor,
                    int(payload.config.use_grade_pbs),
                    now,
                ),
            )
            # Seed default grade rows if none supplied
            grades = payload.grade_factors or [GradeFactor(grade=g) for g in DEFAULT_GRADES]
            for gf in grades:
                conn.execute(
                    """INSERT OR REPLACE INTO grade_factors
                       (factor_set_id, grade, pbs_multiplier, safety_days_override)
                       VALUES (?, ?, ?, ?)""",
                    (set_id, gf.grade, gf.pbs_multiplier, gf.safety_days_override),
                )
            for df in payload.division_factors:
                conn.execute(
                    """INSERT OR REPLACE INTO division_factors
                       (factor_set_id, division, excluded, safety_days_override)
                       VALUES (?, ?, ?, ?)""",
                    (set_id, df.division, int(df.excluded), df.safety_days_override),
                )
        result = self.get_set(set_id)
        assert result is not None
        return result

    def update_set(self, set_id: str, payload: FactorSetUpdate) -> Optional[FactorSet]:
        fields, vals = [], []
        if payload.name is not None:
            fields.append("name = ?"); vals.append(payload.name)
        if payload.attribute1 is not None:
            fields.append("attribute1 = ?"); vals.append(payload.attribute1)
        if payload.season is not None:
            fields.append("season = ?"); vals.append(payload.season)
        if payload.notes is not None:
            fields.append("notes = ?"); vals.append(payload.notes)
        if payload.is_active is not None:
            fields.append("is_active = ?"); vals.append(int(payload.is_active))
        if not fields:
            return self.get_set(set_id)
        now = _now()
        fields.append("updated_at = ?"); vals.append(now)
        vals.append(set_id)
        with get_sqlite() as conn:
            # If activating this set, deactivate all others first
            if payload.is_active:
                conn.execute("UPDATE factor_sets SET is_active = 0")
            conn.execute(f"UPDATE factor_sets SET {', '.join(fields)} WHERE id = ?", vals)
        return self.get_set(set_id)

    def update_config(self, set_id: str, config: FactorConfig) -> Optional[FactorSet]:
        now = _now()
        with get_sqlite() as conn:
            existing = conn.execute(
                "SELECT factor_set_id FROM factor_configs WHERE factor_set_id = ?", (set_id,)
            ).fetchone()
            if existing:
                conn.execute(
                    """UPDATE factor_configs
                       SET safety_days=?, fill_rate_target=?, min_alloc_qty=?,
                           max_alloc_factor=?, use_grade_pbs=?, updated_at=?
                       WHERE factor_set_id=?""",
                    (config.safety_days, config.fill_rate_target, config.min_alloc_qty,
                     config.max_alloc_factor, int(config.use_grade_pbs), now, set_id),
                )
            else:
                conn.execute(
                    """INSERT INTO factor_configs
                       (factor_set_id, safety_days, fill_rate_target, min_alloc_qty,
                        max_alloc_factor, use_grade_pbs, updated_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?)""",
                    (set_id, config.safety_days, config.fill_rate_target, config.min_alloc_qty,
                     config.max_alloc_factor, int(config.use_grade_pbs), now),
                )
            conn.execute("UPDATE factor_sets SET updated_at=? WHERE id=?", (now, set_id))
        return self.get_set(set_id)

    def upsert_grade_factor(self, set_id: str, grade: str, payload: GradeFactorUpdate) -> Optional[FactorSet]:
        now = _now()
        with get_sqlite() as conn:
            conn.execute(
                """INSERT OR REPLACE INTO grade_factors
                   (factor_set_id, grade, pbs_multiplier, safety_days_override)
                   VALUES (?, ?, ?, ?)""",
                (set_id, grade, payload.pbs_multiplier, payload.safety_days_override),
            )
            conn.execute("UPDATE factor_sets SET updated_at=? WHERE id=?", (now, set_id))
        return self.get_set(set_id)

    def upsert_division_factor(self, set_id: str, division: str, payload: DivisionFactorUpdate) -> Optional[FactorSet]:
        now = _now()
        with get_sqlite() as conn:
            conn.execute(
                """INSERT OR REPLACE INTO division_factors
                   (factor_set_id, division, excluded, safety_days_override)
                   VALUES (?, ?, ?, ?)""",
                (set_id, division, int(payload.excluded), payload.safety_days_override),
            )
            conn.execute("UPDATE factor_sets SET updated_at=? WHERE id=?", (now, set_id))
        return self.get_set(set_id)

    def delete_set(self, set_id: str) -> bool:
        with get_sqlite() as conn:
            cur = conn.execute("DELETE FROM factor_sets WHERE id = ?", (set_id,))
        return cur.rowcount > 0

    def clone_set(self, set_id: str, new_name: str) -> Optional[FactorSet]:
        source = self.get_set(set_id)
        if not source:
            return None
        payload = FactorSetCreate(
            name=new_name,
            attribute1=source.attribute1,
            season=source.season,
            notes=f"Cloned from: {source.name}",
            config=source.config or FactorConfig(),
            grade_factors=source.grade_factors,
            division_factors=source.division_factors,
        )
        return self.create_set(payload)
