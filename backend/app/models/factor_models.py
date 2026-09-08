"""Pydantic models for the Factor Engine (Phase 5)."""
from __future__ import annotations
from typing import List, Optional
from pydantic import BaseModel, Field


# ── Grade factor ──────────────────────────────────────────────────────────────

class GradeFactor(BaseModel):
    grade: str
    pbs_multiplier: float = Field(1.0, ge=0.0, le=5.0)
    safety_days_override: Optional[int] = Field(None, ge=0, le=365)


class GradeFactorUpdate(BaseModel):
    pbs_multiplier: float = Field(ge=0.0, le=5.0)
    safety_days_override: Optional[int] = Field(None, ge=0, le=365)


# ── Division factor ───────────────────────────────────────────────────────────

class DivisionFactor(BaseModel):
    division: str
    excluded: bool = False
    safety_days_override: Optional[int] = Field(None, ge=0, le=365)


class DivisionFactorUpdate(BaseModel):
    excluded: bool = False
    safety_days_override: Optional[int] = Field(None, ge=0, le=365)


# ── MC Variables (from V_MC_REQ_APPS_2) ──────────────────────────────────────

class MCVars(BaseModel):
    model_config = {"extra": "allow"}
    # Achievement logic
    pbs_fill_threshold: float = 0.85
    achv_min_high_fill: float = 0.70
    achv_min_low_fill: float = 1.00
    achv_cap_a_grade: float = 1.25
    achv_cap_standard: float = 1.50
    nso_months: int = 2
    nso_days_old: int = 60
    # Fresh stock degrow weights
    degrow_thresh_severe: float = -0.50
    degrow_thresh_mid: float = -0.30
    aw25_weight_severe: float = 0.00
    aw25_weight_mid: float = 0.50
    aw25_weight_mild: float = 1.00
    ss25_weight_severe: float = 0.00
    ss25_weight_mid: float = 0.30
    ss25_weight_mild: float = 0.50
    ss25_weight_above: float = 1.00
    older_weight: float = 0.00
    # PBS period
    pbs_period_days: int = 30
    # Fill rate buckets
    fill_bucket_low: float = 0.50
    fill_bucket_mid_low: float = 0.70
    fill_bucket_mid: float = 0.80
    fill_bucket_high: float = 1.00


# ── BC Variables (from V_BARCODE_REQ_APPS_WMS_V2) ────────────────────────────

class BCVars(BaseModel):
    model_config = {"extra": "allow"}
    # Store grade override
    east_zone_districts: str = 'BIHAR-PUJA,EAST,NORTH EAST'
    east_zone_grade: str = 'A'
    include_upcoming_stores: bool = True
    # MAX_GRID multipliers
    ready_max_grid: int = 4
    a_grade_summer_mult: float = 3.0
    a_grade_regular_mult: float = 2.0
    b_plus_adder_not_winter: int = 3
    b_plus_adder_winter: int = 3
    other_adder_not_winter: int = 2
    # PBS caps by SKU type
    pbs_cap_sized_items: int = 12
    pbs_cap_innerwear: int = 72
    pbs_cap_bottoms: int = 12
    pbs_cap_default: int = 48
    pbs_cap_ready_multiplier: int = 4
    # Sales projection
    sl_window_days: int = 7
    sl_projection_days: int = 30


# ── MRP Variables (from V_MRP_REQ_APPS) ──────────────────────────────────────

class MRPVars(BaseModel):
    model_config = {"extra": "allow"}
    sl_window_days: int = 7
    sl_projection_days: int = 30
    pbs_period_days: int = 30
    min_store_cnt: int = 1
    pbs_fill_threshold: float = 0.85
    fill_bucket_low: float = 0.50
    fill_bucket_mid_low: float = 0.70
    fill_bucket_mid: float = 0.80
    fill_bucket_high: float = 1.00


# ── Art Variables (from V_ART_REQ_APPS) ──────────────────────────────────────

class ArtVars(BaseModel):
    model_config = {"extra": "allow"}
    sl_window_days: int = 7
    sl_projection_days: int = 30
    pbs_period_days: int = 30
    min_store_cnt: int = 1
    pbs_fill_threshold: float = 0.85
    fill_bucket_low: float = 0.50
    fill_bucket_mid_low: float = 0.70
    fill_bucket_mid: float = 0.80
    fill_bucket_high: float = 1.00


# ── Sparky Variables (from V_SPARKY_PBS_REQ) ─────────────────────────────────

class SparkVars(BaseModel):
    model_config = {"extra": "allow"}
    sl_window_days: int = 7
    sl_projection_days: int = 30
    max_slq_cap: int = 0
    pbs_multiplier: float = 1.0
    min_store_cnt: int = 1
    pbs_fill_threshold: float = 0.85


# ── Option Variables (from V_OPTION_REQ_APPS) ────────────────────────────────

class OptionVars(BaseModel):
    model_config = {"extra": "allow"}
    sl_window_days: int = 7
    sl_projection_days: int = 30
    pbs_period_days: int = 30
    option_pbs_multiplier: float = 1.0
    min_store_cnt: int = 1
    pbs_fill_threshold: float = 0.85


# ── List Variables (from V_LIST_PBS_REQ) ─────────────────────────────────────

class ListVars(BaseModel):
    model_config = {"extra": "allow"}
    list_cover_days: int = 30
    sl_window_days: int = 7
    sl_projection_days: int = 30
    adj_stock_days: int = 7
    min_list_req: int = 0
    min_store_cnt: int = 1


# ── Size Variables (from V_SZ_REQ_APPS) ──────────────────────────────────────

class SizeVars(BaseModel):
    model_config = {"extra": "allow"}
    sl_window_days: int = 7
    sl_projection_days: int = 30
    pbs_period_days: int = 30
    size_ratio_cap: float = 2.0
    min_size_pbs: int = 1
    pbs_fill_threshold: float = 0.85


# ── Factor config (global params) ─────────────────────────────────────────────

class FactorConfig(BaseModel):
    safety_days: int = Field(14, ge=0, le=365)
    fill_rate_target: float = Field(0.85, ge=0.0, le=1.0)
    min_alloc_qty: int = Field(1, ge=0, le=999)
    max_alloc_factor: float = Field(2.0, ge=0.5, le=10.0)
    use_grade_pbs: bool = True
    mc_vars: Optional[MCVars] = None
    bc_vars: Optional[BCVars] = None
    mrp_vars: Optional[MRPVars] = None
    art_vars: Optional[ArtVars] = None
    spark_vars: Optional[SparkVars] = None
    option_vars: Optional[OptionVars] = None
    list_vars: Optional[ListVars] = None
    size_vars: Optional[SizeVars] = None


# ── Factor set ────────────────────────────────────────────────────────────────

class FactorSetCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    attribute1: Optional[str] = None
    season: Optional[str] = None
    notes: Optional[str] = None
    config: FactorConfig = Field(default_factory=FactorConfig)
    grade_factors: List[GradeFactor] = []
    division_factors: List[DivisionFactor] = []


class FactorSetUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=120)
    attribute1: Optional[str] = None
    season: Optional[str] = None
    notes: Optional[str] = None
    is_active: Optional[bool] = None


class FactorSet(BaseModel):
    id: str
    name: str
    attribute1: Optional[str] = None
    season: Optional[str] = None
    created_at: str
    updated_at: str
    is_active: bool
    notes: Optional[str] = None
    config: Optional[FactorConfig] = None
    grade_factors: List[GradeFactor] = []
    division_factors: List[DivisionFactor] = []
