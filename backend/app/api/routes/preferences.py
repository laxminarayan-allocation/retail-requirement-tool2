"""
User preferences — global key/value store per user (saved in SQLite).
Used for column order, UI settings, etc.
"""
from datetime import datetime, timezone
from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel
from app.db.sqlite import get_sqlite as get_db

router = APIRouter(prefix="/preferences", tags=["Preferences"])


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class PrefBody(BaseModel):
    value: str  # JSON string from frontend


@router.get("/{pref_key}")
def get_pref(pref_key: str, request: Request):
    user = getattr(request.state, "user", None)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    user_id = user["sub"]
    with get_db() as db:
        row = db.execute(
            "SELECT pref_value FROM user_preferences WHERE user_id=? AND pref_key=?",
            (user_id, pref_key),
        ).fetchone()
    return {"value": row["pref_value"] if row else None}


@router.put("/{pref_key}")
def set_pref(pref_key: str, body: PrefBody, request: Request):
    user = getattr(request.state, "user", None)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    user_id = user["sub"]
    with get_db() as db:
        db.execute(
            """INSERT INTO user_preferences (user_id, pref_key, pref_value, updated_at)
               VALUES (?, ?, ?, ?)
               ON CONFLICT(user_id, pref_key) DO UPDATE SET
                   pref_value=excluded.pref_value, updated_at=excluded.updated_at""",
            (user_id, pref_key, body.value, _now()),
        )
    return {"ok": True}
