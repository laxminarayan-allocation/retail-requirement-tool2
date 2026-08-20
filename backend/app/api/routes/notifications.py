"""
In-app notifications — admin sends a message to a user after reviewing their AI chat.
"""
import uuid
import logging
from datetime import datetime, timezone
from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel

from app.models.response_models import APIResponse
from app.db.sqlite import get_sqlite

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/notifications", tags=["Notifications"])


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class SendNotificationBody(BaseModel):
    to_email: str
    subject: str
    message: str
    chat_log_id: str | None = None


@router.post("/send", response_model=APIResponse)
async def send_notification(body: SendNotificationBody, request: Request):
    """Admin: send a notification to a user."""
    caller = getattr(request.state, "user", {})
    with get_sqlite() as conn:
        # Verify recipient exists
        user = conn.execute(
            "SELECT email, full_name FROM users WHERE email = ?", (body.to_email.lower(),)
        ).fetchone()
        if not user:
            raise HTTPException(status_code=404, detail="User not found.")
        conn.execute(
            """INSERT INTO notifications
               (id, to_email, from_email, from_name, subject, message, chat_log_id, is_read, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)""",
            (
                str(uuid.uuid4()),
                body.to_email.lower(),
                caller.get("email", "admin"),
                caller.get("name", "Admin"),
                body.subject,
                body.message,
                body.chat_log_id,
                _now(),
            ),
        )
    return APIResponse.ok(message="Notification sent.")


@router.get("/mine", response_model=APIResponse)
async def my_notifications(request: Request):
    """Authenticated user: fetch own notifications, newest first."""
    caller = getattr(request.state, "user", {})
    email = caller.get("email", "")
    with get_sqlite() as conn:
        rows = conn.execute(
            """SELECT id, from_email, from_name, subject, message, chat_log_id, is_read, created_at
               FROM notifications WHERE to_email = ? ORDER BY created_at DESC LIMIT 50""",
            (email.lower(),),
        ).fetchall()
        unread = conn.execute(
            "SELECT COUNT(*) FROM notifications WHERE to_email = ? AND is_read = 0",
            (email.lower(),),
        ).fetchone()[0]
    return APIResponse.ok(data={
        "notifications": [dict(r) for r in rows],
        "unread": unread,
    })


@router.patch("/{notif_id}/read", response_model=APIResponse)
async def mark_read(notif_id: str, request: Request):
    """Mark a notification as read."""
    caller = getattr(request.state, "user", {})
    email = caller.get("email", "")
    with get_sqlite() as conn:
        conn.execute(
            "UPDATE notifications SET is_read = 1 WHERE id = ? AND to_email = ?",
            (notif_id, email.lower()),
        )
    return APIResponse.ok(message="Marked as read.")


@router.patch("/read-all", response_model=APIResponse)
async def mark_all_read(request: Request):
    """Mark all notifications as read for calling user."""
    caller = getattr(request.state, "user", {})
    email = caller.get("email", "")
    with get_sqlite() as conn:
        conn.execute(
            "UPDATE notifications SET is_read = 1 WHERE to_email = ?",
            (email.lower(),),
        )
    return APIResponse.ok(message="All marked as read.")
