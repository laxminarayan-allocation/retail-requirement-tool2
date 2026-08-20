"""
Oracle data dictionary queries.

All queries use ALL_* views so results are limited to objects the
connected user can actually see — no DBA privileges required.

Bind variables are used throughout to prevent SQL injection.
"""
import logging
import time
from typing import Any

import oracledb

from app.db.connection import get_connection

import re

logger = logging.getLogger(__name__)


def _fetch_all_as_dicts(
    conn: oracledb.Connection,
    sql: str,
    params: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    """Execute a SELECT and return rows as a list of plain dicts."""
    t0 = time.perf_counter()
    with conn.cursor() as cur:
        cur.execute(sql, params or {})
        cols = [d[0].lower() for d in cur.description]
        rows = [dict(zip(cols, row)) for row in cur.fetchall()]
    elapsed = round((time.perf_counter() - t0) * 1000, 1)
    logger.debug("Query returned %d rows in %.1f ms", len(rows), elapsed)
    return rows


class MetadataRepository:
    """Read-only access to Oracle data dictionary (ALL_* views)."""

    def get_schemas(self) -> list[dict[str, Any]]:
        """
        Return distinct schema owners visible to the connected user,
        ordered by owner name.
        """
        sql = """
            SELECT DISTINCT owner
            FROM   all_objects
            WHERE  object_type IN ('TABLE', 'VIEW')
            ORDER BY owner
        """
        with get_connection() as conn:
            return _fetch_all_as_dicts(conn, sql)

    def get_tables(self, owner: str | None = None) -> list[dict[str, Any]]:
        """
        Return tables visible to the connected user.
        If owner is supplied, filter to that schema only.
        """
        if owner:
            sql = """
                SELECT t.owner,
                       t.table_name,
                       t.num_rows,
                       t.last_analyzed,
                       t.row_movement,
                       c.comments
                FROM   all_tables      t
                LEFT JOIN all_tab_comments c
                       ON c.owner      = t.owner
                      AND c.table_name = t.table_name
                      AND c.table_type = 'TABLE'
                WHERE  t.owner = UPPER(:owner)
                ORDER BY t.table_name
            """
            params: dict[str, Any] = {"owner": owner.upper()}
        else:
            sql = """
                SELECT t.owner,
                       t.table_name,
                       t.num_rows,
                       t.last_analyzed,
                       t.row_movement,
                       c.comments
                FROM   all_tables      t
                LEFT JOIN all_tab_comments c
                       ON c.owner      = t.owner
                      AND c.table_name = t.table_name
                      AND c.table_type = 'TABLE'
                ORDER BY t.owner, t.table_name
            """
            params = {}

        with get_connection() as conn:
            rows = _fetch_all_as_dicts(conn, sql, params)

        # Convert datetime objects to ISO strings for JSON serialisation
        for row in rows:
            if row.get("last_analyzed") is not None:
                row["last_analyzed"] = str(row["last_analyzed"])
        return rows

    def get_views(self, owner: str | None = None) -> list[dict[str, Any]]:
        """Return views visible to the connected user."""
        if owner:
            sql = """
                SELECT v.owner,
                       v.view_name,
                       c.comments
                FROM   all_views         v
                LEFT JOIN all_tab_comments c
                       ON c.owner      = v.owner
                      AND c.table_name = v.view_name
                      AND c.table_type = 'VIEW'
                WHERE  v.owner = UPPER(:owner)
                ORDER BY v.view_name
            """
            params: dict[str, Any] = {"owner": owner.upper()}
        else:
            sql = """
                SELECT v.owner,
                       v.view_name,
                       c.comments
                FROM   all_views         v
                LEFT JOIN all_tab_comments c
                       ON c.owner      = v.owner
                      AND c.table_name = v.view_name
                      AND c.table_type = 'VIEW'
                ORDER BY v.owner, v.view_name
            """
            params = {}

        with get_connection() as conn:
            return _fetch_all_as_dicts(conn, sql, params)

    def get_columns(
        self, owner: str, object_name: str
    ) -> list[dict[str, Any]]:
        """
        Return full column metadata for a table or view.
        Works for both — ALL_TAB_COLUMNS covers both object types.
        """
        sql = """
            SELECT c.column_id,
                   c.column_name,
                   c.data_type,
                   c.data_length,
                   c.data_precision,
                   c.data_scale,
                   c.nullable,
                   c.data_default,
                   cc.comments
            FROM   all_tab_columns  c
            LEFT JOIN all_col_comments cc
                   ON cc.owner       = c.owner
                  AND cc.table_name  = c.table_name
                  AND cc.column_name = c.column_name
            WHERE  c.owner       = UPPER(:owner)
              AND  c.table_name  = UPPER(:object_name)
            ORDER BY c.column_id
        """
        params: dict[str, Any] = {
            "owner": owner.upper(),
            "object_name": object_name.upper(),
        }
        with get_connection() as conn:
            rows = _fetch_all_as_dicts(conn, sql, params)

        for row in rows:
            if row.get("data_default") is not None:
                row["data_default"] = str(row["data_default"]).strip()
        return rows

    def get_object_row_count_estimate(self, owner: str, object_name: str) -> int | None:
        """
        Return num_rows from all_tables for a quick record count estimate.
        Returns None if the object is a view or statistics are stale.
        """
        sql = """
            SELECT num_rows
            FROM   all_tables
            WHERE  owner      = UPPER(:owner)
              AND  table_name = UPPER(:object_name)
        """
        params: dict[str, Any] = {
            "owner": owner.upper(),
            "object_name": object_name.upper(),
        }
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(sql, params)
                row = cur.fetchone()
                return row[0] if row else None

    def get_oracle_version(self) -> str:
        """Return the Oracle banner string."""
        sql = "SELECT banner FROM v$version WHERE ROWNUM = 1"
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(sql)
                row = cur.fetchone()
                return row[0] if row else "Unknown"

    def get_current_schema(self) -> str:
        """Return the schema the session is currently set to."""
        sql = "SELECT SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA') FROM dual"
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(sql)
                row = cur.fetchone()
                return row[0] if row else "Unknown"

    def search_objects(
        self,
        search_term: str,
        owner: str | None = None,
        object_type: str | None = None,
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        """
        Search object names using LIKE.
        search_term should not include wildcards — they are added automatically.
        """
        filters = ["object_name LIKE UPPER(:term)"]
        params: dict[str, Any] = {"term": f"%{search_term.upper()}%", "limit": limit}

        if owner:
            filters.append("owner = UPPER(:owner)")
            params["owner"] = owner.upper()
        if object_type:
            filters.append("object_type = UPPER(:obj_type)")
            params["obj_type"] = object_type.upper()

        where = " AND ".join(filters)
        sql = f"""
            SELECT owner, object_name, object_type, status, last_ddl_time
            FROM   all_objects
            WHERE  {where}
              AND  object_type IN ('TABLE', 'VIEW', 'MATERIALIZED VIEW')
            ORDER BY owner, object_type, object_name
            FETCH FIRST :limit ROWS ONLY
        """
        with get_connection() as conn:
            rows = _fetch_all_as_dicts(conn, sql, params)

        for row in rows:
            if row.get("last_ddl_time") is not None:
                row["last_ddl_time"] = str(row["last_ddl_time"])
        return rows

    def get_view_ddl(self, owner: str, view_name: str) -> str | None:
        """Return the full DDL text of a view from ALL_VIEWS."""
        sql = """
            SELECT text
            FROM   all_views
            WHERE  owner     = UPPER(:owner)
              AND  view_name = UPPER(:view_name)
        """
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(sql, {"owner": owner.upper(), "view_name": view_name.upper()})
                row = cur.fetchone()
                if not row:
                    return None
                # text may be a CLOB — read it fully
                val = row[0]
                return val.read() if hasattr(val, "read") else str(val)

    def get_view_dependencies(self, owner: str, view_name: str) -> list[dict]:
        """
        Return one level of ALL_DEPENDENCIES for a view —
        every object it directly references (tables, views, synonyms).
        """
        sql = """
            SELECT referenced_owner, referenced_name, referenced_type
            FROM   all_dependencies
            WHERE  owner = UPPER(:owner)
              AND  name  = UPPER(:view_name)
              AND  referenced_type IN ('TABLE', 'VIEW', 'SYNONYM', 'MATERIALIZED VIEW')
            ORDER BY referenced_type, referenced_name
        """
        with get_connection() as conn:
            return _fetch_all_as_dicts(conn, sql, {"owner": owner.upper(), "view_name": view_name.upper()})

    def get_deep_view_tree(
        self, owner: str, view_name: str, _seen: set | None = None, depth: int = 0, max_depth: int = 6
    ) -> dict:
        """
        Recursively resolve a view → its dependencies → their dependencies,
        down to base tables (or max_depth). Returns a nested dict:
          { name, owner, type, ddl, columns, children }
        """
        if _seen is None:
            _seen = set()
        key = f"{owner}.{view_name}".upper()
        if key in _seen or depth > max_depth:
            return {"name": view_name, "owner": owner, "type": "cycle_or_limit", "ddl": None, "columns": [], "children": []}
        _seen.add(key)

        # Determine whether this is a view or table
        obj_type = self._get_object_type(owner, view_name)
        ddl = None
        columns = []
        children = []

        if obj_type in ("VIEW", "MATERIALIZED VIEW"):
            ddl = self.get_view_ddl(owner, view_name)
            columns = self.get_columns(owner, view_name)
            deps = self.get_view_dependencies(owner, view_name)
            for dep in deps:
                child = self.get_deep_view_tree(
                    dep["referenced_owner"], dep["referenced_name"],
                    _seen, depth + 1, max_depth
                )
                child["ref_type"] = dep["referenced_type"]
                children.append(child)
        elif obj_type == "TABLE":
            columns = self.get_columns(owner, view_name)
        elif obj_type == "SYNONYM":
            # Resolve synonym to its base object
            base = self._resolve_synonym(owner, view_name)
            if base:
                return self.get_deep_view_tree(base["owner"], base["name"], _seen, depth, max_depth)

        return {
            "name": view_name,
            "owner": owner,
            "type": obj_type or "UNKNOWN",
            "ddl": ddl,
            "columns": [{"name": c["column_name"], "type": c["data_type"]} for c in columns],
            "children": children,
        }

    def _get_object_type(self, owner: str, name: str) -> str | None:
        sql = """
            SELECT object_type FROM all_objects
            WHERE owner = UPPER(:owner) AND object_name = UPPER(:name)
              AND object_type IN ('TABLE','VIEW','MATERIALIZED VIEW','SYNONYM')
              AND ROWNUM = 1
        """
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(sql, {"owner": owner.upper(), "name": name.upper()})
                row = cur.fetchone()
                return row[0] if row else None

    def _resolve_synonym(self, owner: str, name: str) -> dict | None:
        sql = """
            SELECT table_owner, table_name FROM all_synonyms
            WHERE (owner = UPPER(:owner) OR owner = 'PUBLIC')
              AND synonym_name = UPPER(:name)
              AND ROWNUM = 1
        """
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(sql, {"owner": owner.upper(), "name": name.upper()})
                row = cur.fetchone()
                return {"owner": row[0], "name": row[1]} if row else None

    def parse_view_formulas(self, ddl: str) -> list[dict]:
        """
        Parse the SELECT list of a view DDL and extract column aliases
        with their expressions. Returns list of {alias, expression}.
        Best-effort — handles common Oracle SQL patterns.
        """
        if not ddl:
            return []
        # Strip leading CREATE OR REPLACE VIEW ... AS
        ddl_clean = re.sub(r"(?i)create\s+(or\s+replace\s+)?view\s+\S+\s+as\s*", "", ddl, count=1).strip()
        # Take everything up to the first FROM
        from_match = re.search(r"(?i)\bFROM\b", ddl_clean)
        select_part = ddl_clean[:from_match.start()] if from_match else ddl_clean
        select_part = select_part.strip()
        if select_part.upper().startswith("SELECT"):
            select_part = select_part[6:].strip()

        # Split by top-level commas (not inside parens)
        items = []
        depth_p = 0
        current = ""
        for ch in select_part:
            if ch == "(":
                depth_p += 1
            elif ch == ")":
                depth_p -= 1
            if ch == "," and depth_p == 0:
                items.append(current.strip())
                current = ""
            else:
                current += ch
        if current.strip():
            items.append(current.strip())

        result = []
        for item in items:
            # Match: expr AS alias  or  expr alias  or  just alias
            m = re.match(r"^(.+?)\s+AS\s+(\w+)\s*$", item, re.IGNORECASE | re.DOTALL)
            if m:
                result.append({"alias": m.group(2).upper(), "expression": m.group(1).strip()})
            else:
                # No alias — last token is likely the column name
                parts = item.rsplit(None, 1)
                if len(parts) == 2:
                    result.append({"alias": parts[1].upper(), "expression": parts[0].strip()})
                else:
                    result.append({"alias": item.upper(), "expression": item})
        return result
