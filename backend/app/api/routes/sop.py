"""
SOP / Procedures / Data Structure routes.
Admin-only: create, update, delete.
Viewer+: read.
"""
import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel

from app.db.sqlite import get_sqlite
from app.models.response_models import APIResponse

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/sop", tags=["SOP"])


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _admin(request: Request):
    caller = getattr(request.state, "user", {})
    if caller.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only.")
    return caller


# ── Pydantic models ────────────────────────────────────────────────────────────

class DocIn(BaseModel):
    category: str
    title: str
    description: str = ""
    content: str = ""
    version: str = "1.0"
    status: str = "draft"
    tags: str = ""


class StepIn(BaseModel):
    step_no: int
    title: str
    detail: str = ""
    responsible: str = ""


class TableIn(BaseModel):
    table_name: str
    table_type: str             # MAIN | SUB
    schema_owner: str = ""
    description: str = ""
    purpose: str = ""
    parent_id: Optional[str] = None
    columns_json: str = "[]"
    relations_json: str = "[]"


# ── Documents ─────────────────────────────────────────────────────────────────

@router.get("/documents", response_model=APIResponse)
async def list_documents(category: Optional[str] = Query(None)):
    with get_sqlite() as db:
        if category:
            rows = db.execute(
                "SELECT * FROM sop_documents WHERE category=? ORDER BY updated_at DESC",
                (category,),
            ).fetchall()
        else:
            rows = db.execute(
                "SELECT * FROM sop_documents ORDER BY category, updated_at DESC"
            ).fetchall()
        docs = [dict(r) for r in rows]
    return APIResponse.ok(data={"documents": docs, "count": len(docs)})


@router.get("/documents/{doc_id}", response_model=APIResponse)
async def get_document(doc_id: str):
    with get_sqlite() as db:
        row = db.execute("SELECT * FROM sop_documents WHERE id=?", (doc_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Document not found.")
        doc = dict(row)
        doc["steps"] = [
            dict(s) for s in db.execute(
                "SELECT * FROM sop_steps WHERE doc_id=? ORDER BY step_no", (doc_id,)
            ).fetchall()
        ]
    return APIResponse.ok(data=doc)


@router.post("/documents", response_model=APIResponse)
async def create_document(body: DocIn, request: Request):
    caller = _admin(request)
    doc_id = str(uuid.uuid4())
    now = _now()
    with get_sqlite() as db:
        db.execute(
            """INSERT INTO sop_documents
               (id,category,title,description,content,version,status,tags,
                created_by,updated_by,created_at,updated_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
            (doc_id, body.category, body.title, body.description, body.content,
             body.version, body.status, body.tags,
             caller.get("email", "admin"), caller.get("email", "admin"), now, now),
        )
    logger.info("SOP document created: %s (%s) by %s", body.title, body.category, caller.get("email"))
    return APIResponse.ok(data={"id": doc_id}, message="Document created.")


@router.put("/documents/{doc_id}", response_model=APIResponse)
async def update_document(doc_id: str, body: DocIn, request: Request):
    caller = _admin(request)
    now = _now()
    with get_sqlite() as db:
        if not db.execute("SELECT id FROM sop_documents WHERE id=?", (doc_id,)).fetchone():
            raise HTTPException(status_code=404, detail="Document not found.")
        db.execute(
            """UPDATE sop_documents SET
               category=?,title=?,description=?,content=?,version=?,status=?,tags=?,
               updated_by=?,updated_at=? WHERE id=?""",
            (body.category, body.title, body.description, body.content,
             body.version, body.status, body.tags,
             caller.get("email", "admin"), now, doc_id),
        )
    return APIResponse.ok(message="Document updated.")


@router.delete("/documents/{doc_id}", response_model=APIResponse)
async def delete_document(doc_id: str, request: Request):
    _admin(request)
    with get_sqlite() as db:
        db.execute("DELETE FROM sop_steps WHERE doc_id=?", (doc_id,))
        db.execute("DELETE FROM sop_documents WHERE id=?", (doc_id,))
    return APIResponse.ok(message="Document deleted.")


# ── Steps ─────────────────────────────────────────────────────────────────────

@router.post("/documents/{doc_id}/steps", response_model=APIResponse)
async def add_step(doc_id: str, body: StepIn, request: Request):
    _admin(request)
    step_id = str(uuid.uuid4())
    now = _now()
    with get_sqlite() as db:
        db.execute(
            "INSERT INTO sop_steps (id,doc_id,step_no,title,detail,responsible,created_at) VALUES (?,?,?,?,?,?,?)",
            (step_id, doc_id, body.step_no, body.title, body.detail, body.responsible, now),
        )
    return APIResponse.ok(data={"id": step_id}, message="Step added.")


@router.put("/steps/{step_id}", response_model=APIResponse)
async def update_step(step_id: str, body: StepIn, request: Request):
    _admin(request)
    with get_sqlite() as db:
        db.execute(
            "UPDATE sop_steps SET step_no=?,title=?,detail=?,responsible=? WHERE id=?",
            (body.step_no, body.title, body.detail, body.responsible, step_id),
        )
    return APIResponse.ok(message="Step updated.")


@router.delete("/steps/{step_id}", response_model=APIResponse)
async def delete_step(step_id: str, request: Request):
    _admin(request)
    with get_sqlite() as db:
        db.execute("DELETE FROM sop_steps WHERE id=?", (step_id,))
    return APIResponse.ok(message="Step deleted.")


# ── Data Tables ───────────────────────────────────────────────────────────────

@router.get("/data-tables", response_model=APIResponse)
async def list_data_tables():
    with get_sqlite() as db:
        rows = db.execute(
            "SELECT * FROM data_tables ORDER BY table_type DESC, table_name"
        ).fetchall()
        tables = [dict(r) for r in rows]
    return APIResponse.ok(data={"tables": tables, "count": len(tables)})


@router.post("/data-tables", response_model=APIResponse)
async def create_data_table(body: TableIn, request: Request):
    caller = _admin(request)
    table_id = str(uuid.uuid4())
    now = _now()
    with get_sqlite() as db:
        db.execute(
            """INSERT INTO data_tables
               (id,table_type,table_name,schema_owner,description,purpose,
                parent_id,columns_json,relations_json,created_by,created_at,updated_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
            (table_id, body.table_type.upper(), body.table_name.upper(),
             body.schema_owner.upper() if body.schema_owner else "",
             body.description, body.purpose, body.parent_id,
             body.columns_json, body.relations_json,
             caller.get("email", "admin"), now, now),
        )
    return APIResponse.ok(data={"id": table_id}, message="Data table added.")


@router.put("/data-tables/{table_id}", response_model=APIResponse)
async def update_data_table(table_id: str, body: TableIn, request: Request):
    _admin(request)
    now = _now()
    with get_sqlite() as db:
        db.execute(
            """UPDATE data_tables SET
               table_type=?,table_name=?,schema_owner=?,description=?,purpose=?,
               parent_id=?,columns_json=?,relations_json=?,updated_at=? WHERE id=?""",
            (body.table_type.upper(), body.table_name.upper(),
             body.schema_owner.upper() if body.schema_owner else "",
             body.description, body.purpose, body.parent_id,
             body.columns_json, body.relations_json, now, table_id),
        )
    return APIResponse.ok(message="Data table updated.")


@router.delete("/data-tables/{table_id}", response_model=APIResponse)
async def delete_data_table(table_id: str, request: Request):
    _admin(request)
    with get_sqlite() as db:
        db.execute("UPDATE data_tables SET parent_id=NULL WHERE parent_id=?", (table_id,))
        db.execute("DELETE FROM data_tables WHERE id=?", (table_id,))
    return APIResponse.ok(message="Data table deleted.")
