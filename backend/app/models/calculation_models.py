"""Pydantic models for the Calculation Engine (Phase 6)."""
from __future__ import annotations
from enum import Enum
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class RunStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETE = "complete"
    ERROR = "error"


class RunRequest(BaseModel):
    factor_set_id: str
    attribute1: Optional[str] = None
    season: Optional[str] = None
    division: Optional[str] = None
    department: Optional[str] = None
    include_transit: bool = True
    include_pack_pending: bool = True
    include_transfer_out: bool = True
    label: Optional[str] = None


class StepLog(BaseModel):
    step: int
    name: str
    status: str          # ok | warn | error
    rows: Optional[int] = None
    message: Optional[str] = None


class RunSummary(BaseModel):
    total_rows: int = 0
    stores: int = 0
    departments: int = 0
    total_req: float = 0.0
    total_pbs: float = 0.0
    fill_rate_achieved: float = 0.0
    zero_req_rows: int = 0
    capped_rows: int = 0


class RunRecord(BaseModel):
    run_id: str
    status: RunStatus = RunStatus.PENDING
    label: Optional[str] = None
    request: Optional[RunRequest] = None
    factor_set_name: Optional[str] = None
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    duration_s: Optional[float] = None
    steps: List[StepLog] = []
    summary: Optional[RunSummary] = None
    error: Optional[str] = None
    result_rows: int = 0

    # Results are stored separately (not in this model — too large)
    class Config:
        use_enum_values = True
