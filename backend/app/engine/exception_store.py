"""In-memory store for validation exceptions, parallel to run_store."""
import threading
from typing import Optional
from app.engine.validator import ExceptionRecord

_lock = threading.Lock()
_exceptions: dict[str, list[ExceptionRecord]] = {}


def save_exceptions(run_id: str, records: list[ExceptionRecord]) -> None:
    with _lock:
        _exceptions[run_id] = records


def get_exceptions(run_id: str) -> Optional[list[ExceptionRecord]]:
    with _lock:
        return _exceptions.get(run_id)
