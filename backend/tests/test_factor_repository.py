"""
Integration tests for app.repositories.factor_repository using a temp SQLite DB.
"""
import pytest
from app.repositories.factor_repository import FactorRepository
from app.models.factor_models import (
    FactorConfig, FactorSetCreate, FactorSetUpdate,
    GradeFactor, GradeFactorUpdate, DivisionFactor, DivisionFactorUpdate,
)


def _payload(name: str = "Test Set") -> FactorSetCreate:
    return FactorSetCreate(
        name=name,
        attribute1="PREWINTER",
        season="AW26",
        config=FactorConfig(safety_days=14, fill_rate_target=0.85),
        grade_factors=[
            GradeFactor(grade="A+", pbs_multiplier=1.2),
            GradeFactor(grade="A",  pbs_multiplier=1.0),
            GradeFactor(grade="B",  pbs_multiplier=0.8),
        ],
        division_factors=[
            DivisionFactor(division="WOVEN", excluded=False),
        ],
    )


@pytest.fixture
def repo(sqlite_db):
    return FactorRepository()


# ── create_set ────────────────────────────────────────────────────────────────

def test_create_set_returns_full_object(repo):
    fs = repo.create_set(_payload())
    assert fs.id is not None
    assert fs.name == "Test Set"
    assert fs.config is not None
    assert fs.config.fill_rate_target == pytest.approx(0.85)
    assert len(fs.grade_factors) == 3
    assert len(fs.division_factors) == 1
    assert fs.is_active is False


def test_create_set_seeds_default_grades_when_none_given(repo):
    payload = FactorSetCreate(
        name="NoGrades",
        config=FactorConfig(),
        grade_factors=[],
        division_factors=[],
    )
    fs = repo.create_set(payload)
    assert len(fs.grade_factors) == 6  # DEFAULT_GRADES = ["A+","A","B+","B","C","D"]


# ── list_sets ─────────────────────────────────────────────────────────────────

def test_list_sets_empty(repo):
    assert repo.list_sets() == []


def test_list_sets_returns_all(repo):
    repo.create_set(_payload("Set 1"))
    repo.create_set(_payload("Set 2"))
    sets = repo.list_sets()
    assert len(sets) == 2


# ── get_set ───────────────────────────────────────────────────────────────────

def test_get_set_returns_full_detail(repo):
    created = repo.create_set(_payload())
    fetched = repo.get_set(created.id)
    assert fetched is not None
    assert fetched.id == created.id
    assert fetched.config is not None
    assert len(fetched.grade_factors) == 3


def test_get_set_missing_returns_none(repo):
    assert repo.get_set("no-such-id") is None


# ── update_set ────────────────────────────────────────────────────────────────

def test_update_set_name(repo):
    fs = repo.create_set(_payload("Old Name"))
    updated = repo.update_set(fs.id, FactorSetUpdate(name="New Name"))
    assert updated.name == "New Name"


def test_update_set_activate_deactivates_others(repo):
    fs1 = repo.create_set(_payload("Set 1"))
    fs2 = repo.create_set(_payload("Set 2"))
    repo.update_set(fs1.id, FactorSetUpdate(is_active=True))
    repo.update_set(fs2.id, FactorSetUpdate(is_active=True))
    # fs1 should now be inactive
    assert repo.get_set(fs1.id).is_active is False
    assert repo.get_set(fs2.id).is_active is True


def test_update_set_no_fields_returns_unchanged(repo):
    fs = repo.create_set(_payload())
    original_name = fs.name
    updated = repo.update_set(fs.id, FactorSetUpdate())
    assert updated.name == original_name


# ── get_active_set ────────────────────────────────────────────────────────────

def test_get_active_set_none_when_empty(repo):
    assert repo.get_active_set() is None


def test_get_active_set_after_activation(repo):
    fs = repo.create_set(_payload())
    repo.update_set(fs.id, FactorSetUpdate(is_active=True))
    active = repo.get_active_set()
    assert active is not None
    assert active.id == fs.id


# ── update_config ─────────────────────────────────────────────────────────────

def test_update_config_changes_fill_rate(repo):
    fs = repo.create_set(_payload())
    new_cfg = FactorConfig(fill_rate_target=0.95, safety_days=21)
    updated = repo.update_config(fs.id, new_cfg)
    assert updated.config.fill_rate_target == pytest.approx(0.95)
    assert updated.config.safety_days == 21


# ── upsert_grade_factor ───────────────────────────────────────────────────────

def test_upsert_grade_factor_update(repo):
    fs = repo.create_set(_payload())
    repo.upsert_grade_factor(fs.id, "A+", GradeFactorUpdate(pbs_multiplier=1.5))
    updated = repo.get_set(fs.id)
    ap = next(g for g in updated.grade_factors if g.grade == "A+")
    assert ap.pbs_multiplier == pytest.approx(1.5)


def test_upsert_grade_factor_insert_new_grade(repo):
    fs = repo.create_set(_payload())
    repo.upsert_grade_factor(fs.id, "S", GradeFactorUpdate(pbs_multiplier=2.0))
    updated = repo.get_set(fs.id)
    grades = {g.grade for g in updated.grade_factors}
    assert "S" in grades


# ── upsert_division_factor ────────────────────────────────────────────────────

def test_upsert_division_factor_exclude(repo):
    fs = repo.create_set(_payload())
    repo.upsert_division_factor(fs.id, "WOVEN", DivisionFactorUpdate(excluded=True))
    updated = repo.get_set(fs.id)
    woven = next(d for d in updated.division_factors if d.division == "WOVEN")
    assert woven.excluded is True


# ── delete_set ────────────────────────────────────────────────────────────────

def test_delete_set_removes_it(repo):
    fs = repo.create_set(_payload())
    deleted = repo.delete_set(fs.id)
    assert deleted is True
    assert repo.get_set(fs.id) is None


def test_delete_missing_set_returns_false(repo):
    assert repo.delete_set("ghost-id") is False


# ── clone_set ─────────────────────────────────────────────────────────────────

def test_clone_set_creates_new_with_same_config(repo):
    original = repo.create_set(_payload("Original"))
    clone = repo.clone_set(original.id, "Clone")
    assert clone is not None
    assert clone.id != original.id
    assert clone.name == "Clone"
    assert clone.config.fill_rate_target == pytest.approx(original.config.fill_rate_target)
    assert len(clone.grade_factors) == len(original.grade_factors)


def test_clone_missing_returns_none(repo):
    assert repo.clone_set("no-such-id", "Clone") is None
