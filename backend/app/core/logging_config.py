"""
Logging configuration — Phase 14.

Development:  pipe-delimited plain-text to stdout
Production:   newline-delimited JSON to stdout (LOG_JSON=true or APP_ENV=production)

JSON log fields: timestamp, level, logger, message, [exception]
"""
import json
import logging
import sys
from datetime import datetime, timezone


class _JsonFormatter(logging.Formatter):
    """Emit one JSON object per log record."""

    def format(self, record: logging.LogRecord) -> str:
        obj: dict = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        if record.exc_info:
            obj["exception"] = self.formatException(record.exc_info)
        if hasattr(record, "request_id"):
            obj["request_id"] = record.request_id
        return json.dumps(obj, ensure_ascii=False)


class _TextFormatter(logging.Formatter):
    pass


def configure_logging() -> None:
    from app.core.config import settings

    level = getattr(logging, settings.log_level.upper(), logging.INFO)
    use_json = settings.log_json or settings.is_production

    if use_json:
        formatter = _JsonFormatter()
    else:
        formatter = _TextFormatter(
            fmt="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
            datefmt="%Y-%m-%d %H:%M:%S",
        )

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(formatter)

    root = logging.getLogger()
    root.setLevel(level)
    root.handlers.clear()
    root.addHandler(handler)

    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
