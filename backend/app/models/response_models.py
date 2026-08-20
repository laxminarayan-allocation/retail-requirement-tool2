from pydantic import BaseModel
from typing import Any, List, Optional


class APIResponse(BaseModel):
    """Standard envelope for all API responses."""
    success: bool
    data: Optional[Any] = None
    message: Optional[str] = None
    errors: List[str] = []

    @classmethod
    def ok(cls, data: Any = None, message: str | None = None) -> "APIResponse":
        return cls(success=True, data=data, message=message)

    @classmethod
    def fail(cls, message: str, errors: List[str] | None = None, data: Any = None) -> "APIResponse":
        return cls(success=False, data=data, message=message, errors=errors or [])


class HealthResponse(BaseModel):
    status: str
    version: str
    environment: str


class DatabaseStatusResponse(BaseModel):
    model_config = {"populate_by_name": True}

    status: str
    database: str
    db_schema: Optional[str] = None
    oracle_version: Optional[str] = None
    response_time_ms: Optional[float] = None
    message: Optional[str] = None
