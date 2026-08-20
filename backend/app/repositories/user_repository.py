"""
User, role-request, and user-log CRUD against SQLite.
"""
import uuid
from datetime import datetime, timezone
from typing import Optional

from app.db.sqlite import get_sqlite

ROLE_LEVEL = {"pending": 0, "viewer": 1, "planner": 2, "temp_admin": 3, "admin": 4}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── Users ─────────────────────────────────────────────────────────────────────

def create_user(
    email: str, full_name: str, password_hash: str, role: str = "pending",
    display_name: str = None, designation: str = None, department: str = None,
    dob: str = None, contact_no: str = None, whatsapp_no: str = None,
) -> dict:
    user_id = str(uuid.uuid4())
    with get_sqlite() as conn:
        conn.execute(
            """INSERT INTO users
               (id, email, full_name, password_hash, role, is_active, created_at,
                display_name, designation, department, dob, contact_no, whatsapp_no)
               VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)""",
            (user_id, email.lower(), full_name, password_hash, role, _now(),
             display_name, designation, department, dob, contact_no, whatsapp_no),
        )
    return get_user_by_email(email)


def get_user_by_email(email: str) -> Optional[dict]:
    with get_sqlite() as conn:
        row = conn.execute(
            "SELECT * FROM users WHERE email = ?", (email.lower(),)
        ).fetchone()
    return dict(row) if row else None


def get_user_by_id(user_id: str) -> Optional[dict]:
    with get_sqlite() as conn:
        row = conn.execute(
            "SELECT * FROM users WHERE id = ?", (user_id,)
        ).fetchone()
    return dict(row) if row else None


def update_last_login(user_id: str) -> None:
    with get_sqlite() as conn:
        now = _now()
        conn.execute(
            "UPDATE users SET last_login_at=?, last_seen_at=?, force_logout=0 WHERE id=?",
            (now, now, user_id),
        )


def set_user_role(user_id: str, role: str, temp_expires_at: str = None) -> None:
    with get_sqlite() as conn:
        conn.execute(
            "UPDATE users SET role = ?, temp_admin_expires_at = ? WHERE id = ?",
            (role, temp_expires_at if role == "temp_admin" else None, user_id),
        )


def set_user_active(user_id: str, is_active: bool) -> None:
    with get_sqlite() as conn:
        conn.execute("UPDATE users SET is_active = ? WHERE id = ?", (int(is_active), user_id))


def list_users(limit: int = 100, offset: int = 0):
    with get_sqlite() as conn:
        total = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
        rows = conn.execute(
            "SELECT id, email, full_name, role, is_active, created_at, last_login_at, temp_admin_expires_at "
            "FROM users ORDER BY created_at DESC LIMIT ? OFFSET ?",
            (limit, offset),
        ).fetchall()
    return [dict(r) for r in rows], total


# ── Role requests ──────────────────────────────────────────────────────────────

def create_role_request(user_id: str, user_email: str, user_name: str,
                        requested_role: str, reason: str = None,
                        from_role: str = None, temp_days: int = None) -> dict:
    req_id = str(uuid.uuid4())
    with get_sqlite() as conn:
        # Cancel any existing pending request for this user
        conn.execute(
            "UPDATE role_requests SET status = 'cancelled' "
            "WHERE user_id = ? AND status = 'pending'",
            (user_id,),
        )
        conn.execute(
            """INSERT INTO role_requests
               (id, user_id, user_email, user_name, requested_role, reason,
                from_role, temp_days, status, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)""",
            (req_id, user_id, user_email.lower(), user_name, requested_role, reason,
             from_role, temp_days, _now()),
        )
    return get_role_request(req_id)


def get_role_request(req_id: str) -> Optional[dict]:
    with get_sqlite() as conn:
        row = conn.execute(
            "SELECT * FROM role_requests WHERE id = ?", (req_id,)
        ).fetchone()
    return dict(row) if row else None


def get_pending_request_for_user(user_id: str) -> Optional[dict]:
    with get_sqlite() as conn:
        row = conn.execute(
            "SELECT * FROM role_requests WHERE user_id = ? AND status = 'pending' "
            "ORDER BY created_at DESC LIMIT 1",
            (user_id,),
        ).fetchone()
    return dict(row) if row else None


def list_role_requests(status: str = None, limit: int = 100, offset: int = 0):
    clauses, params = [], []
    if status:
        clauses.append("status = ?")
        params.append(status)
    where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
    with get_sqlite() as conn:
        total = conn.execute(
            f"SELECT COUNT(*) FROM role_requests {where}", params
        ).fetchone()[0]
        rows = conn.execute(
            f"SELECT * FROM role_requests {where} ORDER BY created_at DESC LIMIT ? OFFSET ?",
            [*params, limit, offset],
        ).fetchall()
    return [dict(r) for r in rows], total


def review_role_request(req_id: str, action: str, reviewer_email: str,
                        temp_days: int = None) -> Optional[dict]:
    """action = 'approved' | 'denied'"""
    from datetime import datetime, timezone, timedelta
    req = get_role_request(req_id)
    if not req or req["status"] != "pending":
        return None
    temp_expires_at = None
    if action == "approved" and req["requested_role"] == "temp_admin":
        hours = temp_days or req.get("temp_days") or 24  # temp_days column stores hours
        temp_expires_at = (datetime.now(timezone.utc) + timedelta(hours=int(hours))).isoformat()
    with get_sqlite() as conn:
        conn.execute(
            "UPDATE role_requests SET status = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?",
            (action, reviewer_email, _now(), req_id),
        )
        if action == "approved":
            conn.execute(
                "UPDATE users SET role = ?, temp_admin_expires_at = ? WHERE id = ?",
                (req["requested_role"], temp_expires_at, req["user_id"]),
            )
    return get_role_request(req_id)


# ── User logs ──────────────────────────────────────────────────────────────────

def log_action(user_id: str, user_email: str, action: str,
               details: str = None, ip: str = None) -> None:
    with get_sqlite() as conn:
        conn.execute(
            """INSERT INTO user_logs (id, user_id, user_email, action, details, ip_address, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (str(uuid.uuid4()), user_id, user_email, action, details, ip, _now()),
        )


def list_logs(user_email: str = None, action: str = None, limit: int = 100, offset: int = 0):
    clauses, params = [], []
    if user_email:
        clauses.append("user_email = ?")
        params.append(user_email.lower())
    if action:
        clauses.append("action = ?")
        params.append(action)
    where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
    with get_sqlite() as conn:
        total = conn.execute(
            f"SELECT COUNT(*) FROM user_logs {where}", params
        ).fetchone()[0]
        rows = conn.execute(
            f"SELECT * FROM user_logs {where} ORDER BY created_at DESC LIMIT ? OFFSET ?",
            [*params, limit, offset],
        ).fetchall()
    return [dict(r) for r in rows], total
