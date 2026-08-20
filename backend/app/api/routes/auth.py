"""
Auth routes: signup, signin, me, signout, role requests, admin user management.
Email domain restricted to ALLOWED_EMAIL_DOMAINS in config.
Admin email (ADMIN_EMAIL) automatically receives the admin role on signup.
"""
import logging
import random
import string
from fastapi import APIRouter, Request
from pydantic import BaseModel, EmailStr, field_validator
from typing import Optional

from app.core.config import settings
from app.core.security import hash_password, verify_password, create_token
from app.models.response_models import APIResponse
from app.repositories.user_repository import (
    create_user, get_user_by_email, get_user_by_id, update_last_login,
    set_user_role, set_user_active,
    create_role_request, get_pending_request_for_user, list_role_requests, review_role_request,
    log_action, list_logs, list_users, ROLE_LEVEL,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/auth", tags=["Auth"])


# ── Request models ─────────────────────────────────────────────────────────────

class SignupRequest(BaseModel):
    email: EmailStr
    full_name: str
    password: str
    # Optional profile fields collected at signup
    display_name: Optional[str] = None
    designation:  Optional[str] = None
    department:   Optional[str] = None
    dob:          Optional[str] = None   # dd-mm-yyyy
    contact_no:   Optional[str] = None
    whatsapp_no:  Optional[str] = None

    @field_validator("email")
    @classmethod
    def domain_allowed(cls, v: str) -> str:
        domain = v.split("@")[-1].lower()
        if domain not in settings.allowed_domains_list:
            allowed = ", ".join(f"@{d}" for d in settings.allowed_domains_list)
            raise ValueError(f"Only {allowed} email addresses are allowed.")
        return v.lower()

    @field_validator("full_name")
    @classmethod
    def name_not_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Full name is required.")
        return v.strip()

    @field_validator("password")
    @classmethod
    def password_length(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters.")
        return v


class SigninRequest(BaseModel):
    email: EmailStr
    password: str


class RoleRequestBody(BaseModel):
    requested_role: str
    reason: Optional[str] = None
    temp_days: Optional[int] = None  # only for temp_admin requests

    @field_validator("requested_role")
    @classmethod
    def valid_role(cls, v: str) -> str:
        if v not in ("viewer", "planner", "temp_admin"):
            raise ValueError("Requested role must be 'viewer', 'planner', or 'temp_admin'.")
        return v


class ReviewBody(BaseModel):
    action: str  # "approved" | "denied"
    temp_days: Optional[int] = None  # admin can override duration for temp_admin

    @field_validator("action")
    @classmethod
    def valid_action(cls, v: str) -> str:
        if v not in ("approved", "denied"):
            raise ValueError("Action must be 'approved' or 'denied'.")
        return v


class SetRoleBody(BaseModel):
    role: str
    temp_days: Optional[int] = None  # required when role == "temp_admin"

    @field_validator("role")
    @classmethod
    def valid_role(cls, v: str) -> str:
        if v not in ROLE_LEVEL:
            raise ValueError(f"Role must be one of: {', '.join(ROLE_LEVEL)}")
        return v


# ── Helpers ───────────────────────────────────────────────────────────────────

def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("X-Forwarded-For")
    return forwarded.split(",")[0].strip() if forwarded else (request.client.host if request.client else "unknown")


def _safe_user(user: dict) -> dict:
    return {k: v for k, v in user.items() if k != "password_hash"}


def _is_admin(request: Request) -> bool:
    user = getattr(request.state, "user", None)
    return bool(user and user.get("role") in ("admin", "temp_admin"))


# ── Routes ────────────────────────────────────────────────────────────────────

@router.post("/signup", response_model=APIResponse)
async def signup(body: SignupRequest, request: Request):
    if get_user_by_email(body.email):
        return APIResponse.fail(
            message="This email is already registered. Use 'Forgot Password' on the Sign In tab to reset your password.",
            data={"duplicate_email": True},
        )

    # Admin email gets admin role automatically; everyone else starts as pending
    role = "admin" if body.email.lower() == settings.admin_email.lower() else "pending"
    user = create_user(
        email=body.email,
        full_name=body.full_name,
        password_hash=hash_password(body.password),
        role=role,
        display_name=body.display_name,
        designation=body.designation,
        department=body.department,
        dob=body.dob,
        contact_no=body.contact_no,
        whatsapp_no=body.whatsapp_no,
    )
    token = create_token(user["id"], user["email"], user["full_name"], user["role"])
    log_action(user["id"], user["email"], "signup", details=f"role={role}", ip=_client_ip(request))
    logger.info("New user signup: %s role=%s", user["email"], role)

    return APIResponse.ok(
        data={"token": token, "user": _safe_user(user)},
        message="Account created successfully.",
    )


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


@router.post("/forgot-password", response_model=APIResponse)
async def forgot_password(body: ForgotPasswordRequest, request: Request):
    """Generate a temporary password and return it (shown on screen).
    When SMTP is configured this will email it instead."""
    user = get_user_by_email(body.email)
    if not user:
        # Don't reveal whether email exists — generic message
        return APIResponse.ok(
            message="If that email is registered, a temporary password has been generated.",
            data={"sent": False, "temp_password": None},
        )

    # Generate temp password: 3 words style e.g. Sky#482Rain
    chars = string.ascii_letters + string.digits
    temp_pw = (
        random.choice(string.ascii_uppercase)
        + ''.join(random.choices(string.ascii_lowercase, k=4))
        + '#'
        + ''.join(random.choices(string.digits, k=3))
        + random.choice(string.ascii_uppercase)
        + ''.join(random.choices(string.ascii_lowercase, k=3))
    )

    # Update password in DB
    from app.db.sqlite import get_sqlite
    with get_sqlite() as conn:
        conn.execute(
            "UPDATE users SET password_hash = ? WHERE id = ?",
            (hash_password(temp_pw), user["id"]),
        )

    log_action(user["id"], user["email"], "forgot_password", ip=_client_ip(request))
    logger.info("Temp password generated for %s", user["email"])

    # Try SMTP if configured — silently skip if not
    smtp_sent = False
    try:
        from app.core.config import settings
        if getattr(settings, "smtp_host", None) and getattr(settings, "smtp_user", None):
            import smtplib
            from email.mime.text import MIMEText
            msg = MIMEText(
                f"Hello {user['full_name']},\n\n"
                f"Your temporary password for the SS27 Retail Requirement Tool is:\n\n"
                f"    {temp_pw}\n\n"
                f"Please sign in and change your password immediately.\n\n"
                f"— CityKart IT"
            )
            msg["Subject"] = "SS27 Tool — Temporary Password"
            msg["From"] = settings.smtp_user
            msg["To"] = user["email"]
            with smtplib.SMTP(settings.smtp_host, getattr(settings, "smtp_port", 587)) as s:
                s.starttls()
                s.login(settings.smtp_user, settings.smtp_password.get_secret_value())
                s.send_message(msg)
            smtp_sent = True
    except Exception as exc:
        logger.warning("SMTP not configured or failed — showing temp password on screen: %s", exc)

    return APIResponse.ok(
        message="Temporary password generated." if not smtp_sent else f"Temporary password sent to {body.email}.",
        data={"sent": smtp_sent, "temp_password": None if smtp_sent else temp_pw},
    )


@router.post("/signin", response_model=APIResponse)
async def signin(body: SigninRequest, request: Request):
    user = get_user_by_email(body.email)
    if not user or not verify_password(body.password, user["password_hash"]):
        return APIResponse.fail(message="Invalid email or password.")
    if not user["is_active"]:
        return APIResponse.fail(message="This account has been deactivated. Contact your admin.")

    update_last_login(user["id"])
    token = create_token(user["id"], user["email"], user["full_name"], user["role"])
    log_action(user["id"], user["email"], "signin", ip=_client_ip(request))
    logger.info("User signin: %s role=%s", user["email"], user["role"])

    return APIResponse.ok(
        data={"token": token, "user": _safe_user(user)},
        message="Signed in successfully.",
    )


@router.get("/me", response_model=APIResponse)
async def me(request: Request):
    """Returns current user from DB (fresh role). Issues a new token if role changed."""
    from datetime import datetime, timezone
    token_payload = getattr(request.state, "user", None)
    if not token_payload:
        return APIResponse.fail(message="Not authenticated.")

    user = get_user_by_id(token_payload["sub"])
    if not user:
        return APIResponse.fail(message="User not found.")

    # Auto-expire temp_admin when duration is up
    if user["role"] == "temp_admin" and user.get("temp_admin_expires_at"):
        try:
            expires = datetime.fromisoformat(user["temp_admin_expires_at"])
            if datetime.now(timezone.utc) >= expires:
                set_user_role(user["id"], "planner")
                user = get_user_by_id(user["id"])
                log_action(user["id"], user["email"], "temp_admin_expired",
                           details="auto-downgraded to planner")
        except Exception:
            pass

    new_token = None
    if user["role"] != token_payload.get("role"):
        # Role was updated by admin or expired — issue a fresh token so frontend picks it up
        new_token = create_token(user["id"], user["email"], user["full_name"], user["role"])

    # Return pending request for any user (not just pending role)
    pending_request = get_pending_request_for_user(user["id"])

    return APIResponse.ok(data={
        "user": _safe_user(user),
        "new_token": new_token,
        "pending_request": pending_request,
    })


@router.post("/signout", response_model=APIResponse)
async def signout(request: Request):
    user = getattr(request.state, "user", None)
    if user:
        log_action(user["sub"], user["email"], "signout", ip=_client_ip(request))
    return APIResponse.ok(message="Signed out.")


# ── Role requests (any authenticated user) ────────────────────────────────────

@router.post("/request-role", response_model=APIResponse)
async def request_role(body: RoleRequestBody, request: Request):
    token_user = getattr(request.state, "user", None)
    if not token_user:
        return APIResponse.fail(message="Not authenticated.")

    user = get_user_by_id(token_user["sub"])
    if not user:
        return APIResponse.fail(message="User not found.")

    current_role = user["role"]
    requested = body.requested_role

    # Valid upgrade paths
    valid_upgrades: dict = {
        "pending": ("viewer", "planner"),
        "viewer":  ("planner",),
        "planner": ("temp_admin",),
    }
    allowed = valid_upgrades.get(current_role, ())
    if requested not in allowed:
        return APIResponse.fail(
            message=f"Cannot request '{requested}' from '{current_role}' role. "
                    f"Allowed: {', '.join(allowed) or 'none'}."
        )

    temp_days = body.temp_days if requested == "temp_admin" else None
    if requested == "temp_admin" and not temp_days:
        temp_days = 24  # default 1 day (stored as hours)

    req = create_role_request(
        user_id=user["id"],
        user_email=user["email"],
        user_name=user["full_name"],
        requested_role=requested,
        reason=body.reason,
        from_role=current_role,
        temp_days=temp_days,
    )
    log_action(user["id"], user["email"], "role_requested",
               details=f"from={current_role} requested={requested} temp_days={temp_days}",
               ip=_client_ip(request))
    logger.info("Role request: %s %s → %s", user["email"], current_role, requested)
    return APIResponse.ok(data={"request": req}, message="Role request submitted.")


# ── Admin: role request review ─────────────────────────────────────────────────

@router.get("/role-requests", response_model=APIResponse)
async def admin_list_role_requests(
    request: Request, status: str = None, limit: int = 100, offset: int = 0
):
    if not _is_admin(request):
        return APIResponse.fail(message="Admin access required.")
    rows, total = list_role_requests(status=status, limit=limit, offset=offset)
    return APIResponse.ok(data={"requests": rows, "total": total})


@router.patch("/role-requests/{req_id}", response_model=APIResponse)
async def admin_review_role_request(req_id: str, body: ReviewBody, request: Request):
    if not _is_admin(request):
        return APIResponse.fail(message="Admin access required.")

    admin = getattr(request.state, "user", {})
    updated = review_role_request(req_id, body.action, admin.get("email", "admin"),
                                  temp_days=body.temp_days)
    if not updated:
        return APIResponse.fail(message="Request not found or already reviewed.")

    log_action(
        admin.get("sub", ""), admin.get("email", ""),
        f"role_request_{body.action}",
        details=f"req_id={req_id} user={updated['user_email']} role={updated['requested_role']}",
        ip=_client_ip(request),
    )
    logger.info("Role request %s: %s → %s by %s",
                body.action, updated["user_email"], updated["requested_role"], admin.get("email"))
    return APIResponse.ok(data={"request": updated},
                          message=f"Request {body.action}.")


# ── Admin: user management ────────────────────────────────────────────────────

@router.get("/users", response_model=APIResponse)
async def admin_list_users(request: Request, limit: int = 100, offset: int = 0):
    if not _is_admin(request):
        return APIResponse.fail(message="Admin access required.")
    rows, total = list_users(limit=limit, offset=offset)
    return APIResponse.ok(data={"users": rows, "total": total})


@router.patch("/users/{user_id}/role", response_model=APIResponse)
async def admin_set_role(user_id: str, body: SetRoleBody, request: Request):
    if not _is_admin(request):
        return APIResponse.fail(message="Admin access required.")
    user = get_user_by_id(user_id)
    if not user:
        return APIResponse.fail(message="User not found.")
    if user["email"] == settings.admin_email.lower() and body.role != "admin":
        return APIResponse.fail(message="Cannot downgrade the primary admin account.")
    temp_expires_at = None
    if body.role == "temp_admin":
        from datetime import datetime, timezone, timedelta
        hours = body.temp_days or 24  # temp_days field stores hours
        temp_expires_at = (datetime.now(timezone.utc) + timedelta(hours=hours)).isoformat()
    set_user_role(user_id, body.role, temp_expires_at=temp_expires_at)
    admin = getattr(request.state, "user", {})
    log_action(admin.get("sub", ""), admin.get("email", ""), "role_set_direct",
               details=f"target={user['email']} role={body.role}", ip=_client_ip(request))
    return APIResponse.ok(message=f"Role updated to '{body.role}'.")


@router.patch("/users/{user_id}/active", response_model=APIResponse)
async def admin_set_active(user_id: str, request: Request, is_active: bool = True):
    if not _is_admin(request):
        return APIResponse.fail(message="Admin access required.")
    user = get_user_by_id(user_id)
    if not user:
        return APIResponse.fail(message="User not found.")
    if user["email"] == settings.admin_email.lower():
        return APIResponse.fail(message="Cannot deactivate the primary admin account.")
    set_user_active(user_id, is_active)
    return APIResponse.ok(message=f"User {'activated' if is_active else 'deactivated'}.")


@router.get("/my-logs", response_model=APIResponse)
async def my_logs(request: Request, limit: int = 50):
    """Returns the calling user's own recent activity."""
    token_user = getattr(request.state, "user", None)
    if not token_user:
        return APIResponse.fail(message="Not authenticated.")
    rows, total = list_logs(user_email=token_user["email"], limit=limit)
    return APIResponse.ok(data={"logs": rows, "total": total})


@router.get("/logs", response_model=APIResponse)
async def admin_get_logs(
    request: Request, user_email: str = None, action: str = None,
    limit: int = 100, offset: int = 0
):
    if not _is_admin(request):
        return APIResponse.fail(message="Admin access required.")
    rows, total = list_logs(user_email=user_email, action=action, limit=limit, offset=offset)
    return APIResponse.ok(data={"logs": rows, "total": total, "offset": offset, "limit": limit})
