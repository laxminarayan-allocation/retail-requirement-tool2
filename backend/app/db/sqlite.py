"""
SQLite connection for factor storage.

Factor sets are user-configured inputs — they live in a local SQLite file
(backend/data/factors.db) rather than Oracle, which is read-only for us.
"""
import sqlite3
import logging
from contextlib import contextmanager
from pathlib import Path
from typing import Generator

logger = logging.getLogger(__name__)

DB_PATH = Path(__file__).parent.parent.parent / "data" / "factors.db"

_SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id              TEXT PRIMARY KEY,
    email           TEXT NOT NULL UNIQUE,
    full_name       TEXT NOT NULL,
    password_hash   TEXT NOT NULL,
    role            TEXT NOT NULL DEFAULT 'pending',
    is_active       INTEGER NOT NULL DEFAULT 1,
    created_at      TEXT NOT NULL,
    last_login_at   TEXT,
    last_seen_at    TEXT,
    force_logout    INTEGER NOT NULL DEFAULT 0,
    -- Profile fields collected at signup
    display_name    TEXT,
    designation     TEXT,
    department      TEXT,
    dob             TEXT,   -- date string dd-mm-yyyy
    contact_no      TEXT,
    whatsapp_no     TEXT
);

CREATE TABLE IF NOT EXISTS email_otps (
    id          TEXT PRIMARY KEY,
    email       TEXT NOT NULL,
    otp_hash    TEXT NOT NULL,
    expires_at  TEXT NOT NULL,
    used        INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS role_requests (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL,
    user_email      TEXT NOT NULL,
    user_name       TEXT NOT NULL,
    requested_role  TEXT NOT NULL,
    reason          TEXT,
    status          TEXT NOT NULL DEFAULT 'pending',
    reviewed_by     TEXT,
    reviewed_at     TEXT,
    created_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_logs (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL,
    user_email  TEXT NOT NULL,
    action      TEXT NOT NULL,
    details     TEXT,
    ip_address  TEXT,
    created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS run_history (
    run_id              TEXT PRIMARY KEY,
    label               TEXT,
    status              TEXT NOT NULL,
    factor_set_id       TEXT,
    factor_set_name     TEXT,
    attribute1          TEXT,
    season              TEXT,
    division            TEXT,
    department          TEXT,
    include_transit     INTEGER DEFAULT 1,
    include_pack_pending INTEGER DEFAULT 1,
    include_transfer_out INTEGER DEFAULT 1,
    started_at          TEXT,
    completed_at        TEXT,
    duration_s          REAL,
    total_rows          INTEGER DEFAULT 0,
    stores              INTEGER DEFAULT 0,
    departments_count   INTEGER DEFAULT 0,
    total_req           REAL DEFAULT 0,
    total_pbs           REAL DEFAULT 0,
    fill_rate_achieved  REAL DEFAULT 0,
    zero_req_rows       INTEGER DEFAULT 0,
    capped_rows         INTEGER DEFAULT 0,
    exception_errors    INTEGER DEFAULT 0,
    exception_warnings  INTEGER DEFAULT 0,
    exception_infos     INTEGER DEFAULT 0,
    error_msg           TEXT,
    result_rows         INTEGER DEFAULT 0,
    steps_json          TEXT
);

CREATE TABLE IF NOT EXISTS notifications (
    id              TEXT PRIMARY KEY,
    to_email        TEXT NOT NULL,
    from_email      TEXT NOT NULL,
    from_name       TEXT NOT NULL,
    subject         TEXT NOT NULL,
    message         TEXT NOT NULL,
    chat_log_id     TEXT,
    is_read         INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS assistant_logs (
    id          TEXT PRIMARY KEY,
    user_email  TEXT NOT NULL,
    user_name   TEXT NOT NULL,
    user_role   TEXT NOT NULL,
    question    TEXT NOT NULL,
    answer      TEXT NOT NULL,
    created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS factor_sets (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    attribute1  TEXT,
    season      TEXT,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    is_active   INTEGER NOT NULL DEFAULT 0,
    notes       TEXT
);

CREATE TABLE IF NOT EXISTS factor_configs (
    factor_set_id       TEXT PRIMARY KEY REFERENCES factor_sets(id) ON DELETE CASCADE,
    safety_days         INTEGER NOT NULL DEFAULT 14,
    fill_rate_target    REAL    NOT NULL DEFAULT 0.85,
    min_alloc_qty       INTEGER NOT NULL DEFAULT 1,
    max_alloc_factor    REAL    NOT NULL DEFAULT 2.0,
    use_grade_pbs       INTEGER NOT NULL DEFAULT 1,
    updated_at          TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS grade_factors (
    factor_set_id       TEXT NOT NULL REFERENCES factor_sets(id) ON DELETE CASCADE,
    grade               TEXT NOT NULL,
    pbs_multiplier      REAL NOT NULL DEFAULT 1.0,
    safety_days_override INTEGER,
    PRIMARY KEY (factor_set_id, grade)
);

CREATE TABLE IF NOT EXISTS division_factors (
    factor_set_id       TEXT NOT NULL REFERENCES factor_sets(id) ON DELETE CASCADE,
    division            TEXT NOT NULL,
    excluded            INTEGER NOT NULL DEFAULT 0,
    safety_days_override INTEGER,
    PRIMARY KEY (factor_set_id, division)
);

-- ── Custom master tables (user-added from DB Explorer) ───────────────────────

CREATE TABLE IF NOT EXISTS custom_master_tables (
    id           TEXT PRIMARY KEY,
    schema_owner TEXT NOT NULL,
    object_name  TEXT NOT NULL,
    label        TEXT NOT NULL,
    added_by     TEXT NOT NULL,
    added_at     TEXT NOT NULL,
    UNIQUE(schema_owner, object_name)
);

-- ── File access frequency tracking ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS file_access_log (
    id           TEXT PRIMARY KEY,
    file_key     TEXT NOT NULL,    -- e.g. "CK_A2166__V_MC_SALES"
    accessed_at  TEXT NOT NULL,
    user_email   TEXT
);
CREATE INDEX IF NOT EXISTS idx_fal_key ON file_access_log(file_key);

-- ── SOP / Procedures / Data Structure ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sop_documents (
    id          TEXT PRIMARY KEY,
    category    TEXT NOT NULL,   -- SOP | DATA_PROC | PROCEDURE | ROADMAP | LOGIC | ALGORITHM
    title       TEXT NOT NULL,
    description TEXT DEFAULT '',
    content     TEXT DEFAULT '',  -- Markdown body
    version     TEXT DEFAULT '1.0',
    status      TEXT DEFAULT 'draft',  -- draft | active | archived
    tags        TEXT DEFAULT '',  -- comma-separated
    created_by  TEXT NOT NULL,
    updated_by  TEXT,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sop_steps (
    id          TEXT PRIMARY KEY,
    doc_id      TEXT NOT NULL REFERENCES sop_documents(id) ON DELETE CASCADE,
    step_no     INTEGER NOT NULL,
    title       TEXT NOT NULL,
    detail      TEXT DEFAULT '',
    responsible TEXT DEFAULT '',
    created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS data_tables (
    id              TEXT PRIMARY KEY,
    table_type      TEXT NOT NULL,   -- MAIN | SUB
    table_name      TEXT NOT NULL,
    schema_owner    TEXT DEFAULT '',
    description     TEXT DEFAULT '',
    purpose         TEXT DEFAULT '',
    parent_id       TEXT,            -- SUB tables reference a MAIN table id
    columns_json    TEXT DEFAULT '[]',   -- [{col, type, desc, is_pk, is_fk}]
    relations_json  TEXT DEFAULT '[]',   -- [{table, key, rel_type}]
    created_by      TEXT NOT NULL,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);
"""


def _migrate(conn: sqlite3.Connection) -> None:
    """Apply additive migrations that CREATE TABLE IF NOT EXISTS cannot handle."""
    from app.core.config import settings

    existing_cols = {r[1] for r in conn.execute("PRAGMA table_info(users)").fetchall()}
    if "role" not in existing_cols:
        conn.execute("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'pending'")
        logger.info("Migration: added role column to users table")
    if "last_seen_at" not in existing_cols:
        conn.execute("ALTER TABLE users ADD COLUMN last_seen_at TEXT")
        logger.info("Migration: added last_seen_at column to users table")
    if "force_logout" not in existing_cols:
        conn.execute("ALTER TABLE users ADD COLUMN force_logout INTEGER NOT NULL DEFAULT 0")
        logger.info("Migration: added force_logout column to users table")
    for col, defn in [
        ("display_name",          "TEXT"),
        ("designation",           "TEXT"),
        ("department",            "TEXT"),
        ("dob",                   "TEXT"),
        ("contact_no",            "TEXT"),
        ("whatsapp_no",           "TEXT"),
        ("temp_admin_expires_at", "TEXT"),
    ]:
        if col not in existing_cols:
            conn.execute(f"ALTER TABLE users ADD COLUMN {col} {defn}")
            logger.info("Migration: added %s column to users table", col)

    # role_requests — add from_role and temp_days if missing
    rr_cols = {r[1] for r in conn.execute("PRAGMA table_info(role_requests)").fetchall()}
    for col, defn in [("from_role", "TEXT"), ("temp_days", "INTEGER")]:
        if col not in rr_cols:
            conn.execute(f"ALTER TABLE role_requests ADD COLUMN {col} {defn}")
            logger.info("Migration: added %s column to role_requests table", col)

    # custom_master_tables — created by schema if not exists; nothing to migrate

    # Always ensure the configured admin email has the admin role
    conn.execute(
        "UPDATE users SET role = 'admin' WHERE email = ? AND role != 'admin'",
        (settings.admin_email.lower(),),
    )
    conn.commit()


def init_db() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(DB_PATH) as conn:
        conn.executescript(_SCHEMA)
        _migrate(conn)
    logger.info("SQLite factor DB ready at %s", DB_PATH)


@contextmanager
def get_sqlite() -> Generator[sqlite3.Connection, None, None]:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
