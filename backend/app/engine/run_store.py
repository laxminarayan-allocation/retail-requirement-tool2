"""
In-memory store for calculation runs.

Keeps the last MAX_RUNS runs. Results (DataFrames) are stored separately
to keep the RunRecord lightweight for polling.
"""
import threading
from collections import OrderedDict
from typing import Optional

import pandas as pd

from app.models.calculation_models import RunRecord

MAX_RUNS = 20

_lock = threading.Lock()
_runs: OrderedDict[str, RunRecord] = OrderedDict()
_results: dict[str, pd.DataFrame] = {}


def save_run(record: RunRecord) -> None:
    with _lock:
        _runs[record.run_id] = record
        if len(_runs) > MAX_RUNS:
            oldest_id, _ = _runs.popitem(last=False)
            _results.pop(oldest_id, None)


def save_results(run_id: str, df: pd.DataFrame) -> None:
    with _lock:
        _results[run_id] = df


def get_run(run_id: str) -> Optional[RunRecord]:
    with _lock:
        return _runs.get(run_id)


def get_results(run_id: str) -> Optional[pd.DataFrame]:
    with _lock:
        return _results.get(run_id)


def list_runs() -> list[RunRecord]:
    with _lock:
        return list(reversed(list(_runs.values())))
