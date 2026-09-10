"""
System / performance endpoints — Phase 12.

GET  /api/system/status          — cache state, memory, Oracle pool, timing
POST /api/system/cache/invalidate — flush Oracle data caches
POST /api/system/cache/warmup    — trigger background cache preload
"""
import logging
import os
import signal
import subprocess
import sys
import threading
import time
from datetime import datetime, timezone

from fastapi import APIRouter

from app.models.response_models import APIResponse

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/system", tags=["System"])

# ── Cache state tracker ───────────────────────────────────────────────────────

_warmup_status: dict = {
    "running": False,
    "last_run": None,
    "last_duration_s": None,
    "items_loaded": 0,
    "stores_loaded": 0,
    "error": None,
}
_warmup_lock = threading.Lock()


def _memory_mb(obj) -> float | None:
    """Estimate DataFrame memory usage in MB."""
    try:
        import pandas as pd
        if isinstance(obj, pd.DataFrame):
            return round(obj.memory_usage(deep=True).sum() / 1_048_576, 2)
    except Exception:
        pass
    return None


def _oracle_pool_info() -> dict:
    try:
        from app.db.oracle import get_pool
        pool = get_pool()
        return {
            "min_size": pool.min,
            "max_size": pool.max,
            "open": pool.opened,
            "busy": pool.busy,
            "free": pool.opened - pool.busy,
        }
    except Exception as exc:
        return {"error": str(exc)}


def _item_cache_info() -> dict:
    try:
        from app.repositories.item_repository import _CACHE
        if _CACHE is None:
            return {"loaded": False, "rows": 0, "memory_mb": None}
        return {
            "loaded": True,
            "rows": len(_CACHE),
            "memory_mb": _memory_mb(_CACHE),
            "columns": list(_CACHE.columns),
        }
    except Exception as exc:
        return {"error": str(exc)}


def _store_cache_info() -> dict:
    try:
        from app.repositories.store_repository import _CACHE as STORE_CACHE
        if STORE_CACHE is None:
            return {"loaded": False, "rows": 0, "memory_mb": None}
        return {
            "loaded": True,
            "rows": len(STORE_CACHE),
            "memory_mb": _memory_mb(STORE_CACHE),
        }
    except Exception:
        return {"loaded": False, "rows": 0, "memory_mb": None}


def _run_store_info() -> dict:
    try:
        from app.engine import run_store, exception_store
        runs = run_store.list_runs()
        total_result_mb = 0.0
        for r in runs:
            df = run_store.get_results(r.run_id)
            if df is not None:
                total_result_mb += _memory_mb(df) or 0.0
        return {
            "runs_in_memory": len(runs),
            "result_dataframes_mb": round(total_result_mb, 2),
            "statuses": {s: sum(1 for r in runs if r.status == s)
                         for s in ("complete", "running", "error", "pending")},
        }
    except Exception as exc:
        return {"error": str(exc)}


@router.get("/status", response_model=APIResponse)
async def system_status():
    """Return cache heat, memory usage, Oracle pool state, and warmup history."""
    t0 = time.perf_counter()

    item_cache  = _item_cache_info()
    store_cache = _store_cache_info()
    pool_info   = _oracle_pool_info()
    run_info    = _run_store_info()

    elapsed_ms = round((time.perf_counter() - t0) * 1000, 1)

    return APIResponse.ok(data={
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "oracle_pool": pool_info,
        "item_cache": item_cache,
        "store_cache": store_cache,
        "run_store": run_info,
        "warmup": dict(_warmup_status),
        "status_query_ms": elapsed_ms,
        "recommendations": _recommendations(item_cache, store_cache, pool_info),
    })


def _recommendations(item: dict, store: dict, pool: dict) -> list[str]:
    recs = []
    if not item.get("loaded"):
        recs.append("Item cache is cold — first calculation will be slower. POST /api/system/cache/warmup to preload.")
    if not store.get("loaded"):
        recs.append("Store cache is cold — POST /api/system/cache/warmup to preload.")
    if isinstance(pool.get("busy"), int) and pool.get("busy", 0) >= pool.get("max_size", 10):
        recs.append("Oracle pool fully saturated — concurrent requests may queue. Increase ORACLE_POOL_MAX if needed.")
    if not recs:
        recs.append("All caches warm. System ready.")
    return recs


@router.post("/cache/invalidate", response_model=APIResponse)
async def invalidate_caches():
    """Flush all Oracle data caches so the next request re-fetches from Oracle."""
    cleared = []
    try:
        from app.repositories.item_repository import ItemRepository
        ItemRepository().invalidate_cache()
        cleared.append("item_master")
    except Exception as exc:
        logger.warning("item cache invalidate failed: %s", exc)

    try:
        from app.repositories.store_repository import StoreRepository
        StoreRepository().invalidate_cache()
        cleared.append("store_master")
    except Exception as exc:
        logger.warning("store cache invalidate failed: %s", exc)

    logger.info("Caches invalidated: %s", cleared)
    return APIResponse.ok(
        data={"cleared": cleared},
        message=f"Invalidated: {', '.join(cleared)}. Next request will re-fetch from Oracle.",
    )


def _do_warmup():
    """Run in a background thread — load item and store caches."""
    global _warmup_status
    with _warmup_lock:
        if _warmup_status["running"]:
            return
        _warmup_status["running"] = True
        _warmup_status["error"] = None

    t0 = time.perf_counter()
    items = 0
    stores = 0
    err = None
    try:
        from app.repositories.item_repository import ItemRepository
        from app.repositories.store_repository import StoreRepository
        item_df = ItemRepository()._load()
        items = len(item_df)
        store_df = StoreRepository().get_all_stores(active_only=True)
        stores = len(store_df)
        logger.info("Cache warmup: %d items, %d stores in %.1fs", items, stores, time.perf_counter() - t0)
    except Exception as exc:
        err = str(exc)
        logger.error("Cache warmup failed: %s", exc)
    try:
        from app.api.routes.req_dashboard import warm_req_pivots
        loaded = warm_req_pivots()
        logger.info("Req pivot warmup: %s in %.1fs", ", ".join(loaded) or "none", time.perf_counter() - t0)
    except Exception as exc:
        logger.warning("Req pivot warmup failed (non-fatal): %s", exc)
    finally:
        dur = round(time.perf_counter() - t0, 2)
        with _warmup_lock:
            _warmup_status.update({
                "running": False,
                "last_run": datetime.now(timezone.utc).isoformat(),
                "last_duration_s": dur,
                "items_loaded": items,
                "stores_loaded": stores,
                "error": err,
            })


@router.post("/cache/warmup", response_model=APIResponse)
async def warmup_caches():
    """Trigger a background cache preload of item master and store master from Oracle."""
    with _warmup_lock:
        if _warmup_status["running"]:
            return APIResponse.ok(message="Warmup already running.", data=dict(_warmup_status))

    t = threading.Thread(target=_do_warmup, daemon=True)
    t.start()
    return APIResponse.ok(
        message="Cache warmup started in background. Poll GET /api/system/status to check progress.",
        data={"started": True},
    )


# ── Server control endpoints ───────────────────────────────────────────────────

_FRONTEND_DIR = os.path.normpath(
    os.path.join(os.path.dirname(__file__), "..", "..", "..", "..", "frontend")
)

_REPO_ROOT = os.path.normpath(
    os.path.join(os.path.dirname(__file__), "..", "..", "..", "..")
)


@router.post("/restart-backend", response_model=APIResponse)
async def restart_backend():
    """Restart the uvicorn backend process (sends SIGTERM; watchdog restarts it)."""
    def _do_restart():
        time.sleep(0.5)  # let response reach client first
        os.kill(os.getpid(), signal.SIGTERM)
    threading.Thread(target=_do_restart, daemon=True).start()
    return APIResponse.ok(message="Backend restarting… reconnect in a few seconds.")


@router.post("/build-frontend", response_model=APIResponse)
async def build_frontend():
    """Run npm run build in the frontend directory (updates mobile dist/)."""
    if not os.path.isdir(_FRONTEND_DIR):
        return APIResponse.fail(message=f"Frontend dir not found: {_FRONTEND_DIR}")
    try:
        t0 = time.perf_counter()
        result = subprocess.run(
            ["npm", "run", "build"],
            cwd=_FRONTEND_DIR,
            capture_output=True, text=True, timeout=120,
            shell=True
        )
        elapsed = round(time.perf_counter() - t0, 1)
        if result.returncode == 0:
            return APIResponse.ok(message=f"Frontend build successful ({elapsed}s)", data={"elapsed_s": elapsed})
        else:
            return APIResponse.fail(message=f"Build failed: {result.stderr[-500:] if result.stderr else 'unknown error'}")
    except subprocess.TimeoutExpired:
        return APIResponse.fail(message="Build timed out (>120s)")
    except Exception as exc:
        logger.exception("build_frontend error")
        return APIResponse.fail(message=str(exc))


@router.post("/git/push", response_model=APIResponse)
async def git_push():
    """Stage all changes, commit with auto message, and push to remote."""
    from fastapi import Request as _Req
    try:
        # Check if there are any changes
        status = subprocess.run(
            ["git", "status", "--porcelain"],
            cwd=_REPO_ROOT, capture_output=True, text=True, timeout=15, shell=True
        )
        has_changes = bool(status.stdout.strip())

        if has_changes:
            # Stage all
            subprocess.run(["git", "add", "-A"], cwd=_REPO_ROOT, timeout=15, shell=True)
            # Commit
            from datetime import date
            msg = f"chore: auto-commit via Settings panel ({date.today()})"
            commit = subprocess.run(
                ["git", "commit", "-m", msg],
                cwd=_REPO_ROOT, capture_output=True, text=True, timeout=15, shell=True
            )
            if commit.returncode != 0 and "nothing to commit" not in commit.stdout:
                return APIResponse.fail(message=f"Commit failed: {commit.stderr[-300:]}")

        # Push
        push = subprocess.run(
            ["git", "push"],
            cwd=_REPO_ROOT, capture_output=True, text=True, timeout=60, shell=True
        )
        if push.returncode == 0:
            return APIResponse.ok(
                message="Push successful" + (" (with new commit)" if has_changes else " (already up-to-date)"),
                data={"pushed": True, "committed": has_changes}
            )
        else:
            return APIResponse.fail(message=f"Push failed: {push.stderr[-400:] or push.stdout[-400:]}")
    except subprocess.TimeoutExpired:
        return APIResponse.fail(message="Git operation timed out.")
    except Exception as exc:
        logger.exception("git_push error")
        return APIResponse.fail(message=str(exc))


@router.post("/git/pull", response_model=APIResponse)
async def git_pull():
    """Pull latest changes from remote (git pull)."""
    try:
        result = subprocess.run(
            ["git", "pull"],
            cwd=_REPO_ROOT, capture_output=True, text=True, timeout=60, shell=True
        )
        if result.returncode == 0:
            output = result.stdout.strip() or "Already up to date."
            return APIResponse.ok(message=f"Pull successful: {output[:200]}", data={"output": output})
        else:
            return APIResponse.fail(message=f"Pull failed: {result.stderr[-400:]}")
    except subprocess.TimeoutExpired:
        return APIResponse.fail(message="Git pull timed out.")
    except Exception as exc:
        logger.exception("git_pull error")
        return APIResponse.fail(message=str(exc))
