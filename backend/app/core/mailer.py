"""
Email utility — sends OTP codes via SMTP.
Uses only stdlib smtplib; no extra packages required.
Falls back to console logging when SMTP is not configured (dev mode).
"""
import logging
import smtplib
import ssl
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from app.core.config import settings

logger = logging.getLogger(__name__)


def send_otp_email(to_email: str, otp: str, full_name: str) -> bool:
    """Send a 6-digit OTP to the given address. Returns True on success."""
    subject = "Your CityKart SS27 verification code"
    html = f"""
    <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#f8fafc;border-radius:8px;">
      <div style="font-size:13px;font-weight:700;color:#2563eb;letter-spacing:.1em;text-transform:uppercase;margin-bottom:8px;">
        CityKart · SS27 Replenishment Tool
      </div>
      <h2 style="font-size:22px;font-weight:800;color:#0f172a;margin:0 0 16px;letter-spacing:-.02em;">
        Your verification code
      </h2>
      <p style="font-size:14px;color:#475569;margin:0 0 24px;line-height:1.6;">
        Hi {full_name}, use the code below to complete your sign-up.
        It expires in <strong>{settings.otp_expire_minutes} minutes</strong>.
      </p>
      <div style="background:#0f172a;border-radius:8px;padding:24px;text-align:center;margin-bottom:24px;">
        <span style="font-size:36px;font-weight:800;color:#38bdf8;letter-spacing:.25em;font-family:monospace;">
          {otp}
        </span>
      </div>
      <p style="font-size:12px;color:#94a3b8;line-height:1.6;margin:0;">
        If you did not request this, you can ignore this email.
        Do not share this code with anyone.
      </p>
    </div>
    """
    text = f"Your CityKart SS27 verification code is: {otp}\nExpires in {settings.otp_expire_minutes} minutes."

    if not settings.is_smtp_configured:
        # Dev fallback — print to console so the team can still test
        logger.warning(
            "SMTP not configured. OTP for %s: %s  (console fallback — set SMTP_* in .env)",
            to_email, otp,
        )
        return True

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = f"CityKart SS27 <{settings.smtp_from_address}>"
    msg["To"] = to_email
    msg.attach(MIMEText(text, "plain"))
    msg.attach(MIMEText(html, "html"))

    try:
        if settings.smtp_ssl:
            ctx = ssl.create_default_context()
            with smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port, context=ctx) as server:
                server.login(settings.smtp_user, settings.smtp_password.get_secret_value())
                server.sendmail(settings.smtp_from_address, to_email, msg.as_string())
        else:
            with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10) as server:
                if settings.smtp_tls:
                    server.starttls(context=ssl.create_default_context())
                if settings.smtp_user:
                    server.login(settings.smtp_user, settings.smtp_password.get_secret_value())
                server.sendmail(settings.smtp_from_address, to_email, msg.as_string())

        logger.info("OTP email sent to %s", to_email)
        return True

    except Exception as exc:
        logger.error("Failed to send OTP email to %s: %s", to_email, exc)
        return False
