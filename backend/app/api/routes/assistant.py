"""
In-app AI assistant — streams responses from Claude to the frontend.
API key stays server-side; never exposed to React.
"""
import json
import logging
from datetime import date
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.core.config import settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/assistant", tags=["Assistant"])

SYSTEM_PROMPT = """You are the in-app help assistant for the CityKart SS27 Retail Requirement & Replenishment Tool (RRT).
You help planners, viewers, and admins understand and use the application. Be concise, friendly, and practical.

## Application Overview
The SS27 RRT calculates store-level replenishment quantities for CityKart retail stores (200+ stores) for the SS27 / AW26 Pre-Winter season. It connects to Oracle (read-only master data) and uses local SQLite for factors and run history.

## Pages and Features

### Dashboard
- Shows live KPIs: total stores, departments, last run fill rate, pending exceptions
- Cards for quick status at a glance
- "Last Run" summary with fill rate achieved vs target

### Database Explorer (Planner+)
- Browse Oracle master data tables: stores, divisions, departments, products, stock
- Filter, sort, and preview data
- Useful for verifying source data before running calculations

### Master Data (Viewer+)
- View curated master data: store list, division/department hierarchy
- Read-only — source is Oracle

### Calc Factors (Planner+)
- Create and manage Factor Sets — named configuration profiles
- Each Factor Set has:
  - **Safety Days**: buffer stock days (default 14)
  - **Fill Rate Target**: e.g. 85%
  - **Min Alloc Qty** / **Max Alloc Factor**: floor and cap on per-store allocation
  - **Grade PBS Multipliers**: adjust planned buy per store grade (A/B/C/D)
  - **Division Factors**: exclude divisions or override safety days per division
- Activate a Factor Set to use it in the next calculation run

### Calculation (Planner+)
- Select parameters: Attribute1, Season, Division, Department
- Toggle inclusions: Transit stock, Pack pending, Transfer-out
- Click "Run Calculation" — runs asynchronously
- View run status, progress steps, and any exceptions (errors/warnings/info)

### Results (Viewer+)
- Browse calculation output: store × SKU replenishment quantities
- Filter by store, grade, division, department
- Download as Excel

### History (Viewer+)
- List of all past calculation runs with status, duration, KPIs
- Click a run to see its parameters and results

### Settings (Planner+)
- View app configuration (read-only for non-admins)
- Oracle connection status

### Admin Panel (Admin only)
- Manage users: view all users, approve/reject role requests
- Role hierarchy: Admin > Planner > Viewer > Pending
- New users sign up and default to "Pending" — they must request a role, which admin approves here
- View user activity logs

## Roles
- **Pending**: can only see waiting screen, submit role request
- **Viewer**: Dashboard, Master Data, Results, History
- **Planner**: everything Viewer can see + Database Explorer, Factors, Calculation, Settings
- **Admin**: everything + Admin Panel, user management

## Common User Questions & Answers
- "Why can't I see the Calculation page?" → You need Planner role or higher. Submit a role request on your pending page.
- "How do I run a calculation?" → Go to Calculation, select Attribute1/Season/Division/Department, optionally toggle stock inclusions, then click Run Calculation.
- "What is fill rate?" → Percentage of stores that receive their full planned buy quantity. Target is configurable per factor set (default 85%).
- "What are safety days?" → Buffer stock expressed in days of expected sales. Prevents stockouts due to lead time.
- "My calculation is stuck" → Check the History page — if the run shows "running" for more than a few minutes, it may have failed; refresh the page.
- "How do I approve a user?" → Go to Admin Panel → Role Requests tab, find the pending request, and click Approve.

Always stay focused on how to use the application. For unrelated questions, politely redirect to the tool's features."""


def _build_live_context(caller_role: str, caller_email: str, caller_name: str) -> str:
    """Build a dynamic context block injected after the static system prompt."""
    lines: list[str] = [
        "",
        "## Live App Context (current data — use this to answer specific questions)",
        f"Today: {date.today().strftime('%d-%b-%Y')}",
        f"You are speaking with: {caller_name} ({caller_email}), role={caller_role}",
        "",
    ]

    # Users & roles
    try:
        from app.repositories.user_repository import list_users
        users, _ = list_users(limit=200)
        admins   = [u for u in users if u["role"] == "admin"]
        planners = [u for u in users if u["role"] == "planner"]
        viewers  = [u for u in users if u["role"] == "viewer"]
        pending  = [u for u in users if u["role"] == "pending"]

        lines.append("### Registered Users")
        lines.append(f"Total users: {len(users)}")

        def _fmt(lst): return ", ".join(f"{u['full_name']} ({u['email']})" for u in lst) or "none"
        lines.append(f"Admins ({len(admins)}): {_fmt(admins)}")
        lines.append(f"Planners ({len(planners)}): {_fmt(planners)}")
        lines.append(f"Viewers ({len(viewers)}): {_fmt(viewers)}")
        lines.append(f"Pending ({len(pending)}): {_fmt(pending)}")
        lines.append("")
    except Exception as exc:
        logger.warning("assistant context: users failed: %s", exc)

    # Active factor set
    try:
        from app.repositories.factor_repository import FactorRepository
        sets = FactorRepository().list_sets()
        active_fs = next((s for s in sets if s.is_active), None)
        lines.append("### Factor Sets")
        lines.append(f"Total factor sets: {len(sets)}")
        if active_fs:
            cfg = active_fs.config
            lines.append(
                f"Active factor set: '{active_fs.name}' — fill_rate={cfg.fill_rate_target if cfg else '?'}%, "
                f"safety_days={cfg.safety_days if cfg else '?'}"
            )
        else:
            lines.append("No active factor set configured.")
        lines.append("")
    except Exception as exc:
        logger.warning("assistant context: factors failed: %s", exc)

    # Recent run history
    try:
        from app.repositories.history_repository import list_history
        recent, total = list_history(limit=5, offset=0)
        lines.append("### Recent Calculation Runs")
        lines.append(f"Total historical runs: {total}")
        for r in recent:
            lines.append(
                f"- [{r['status'].upper()}] {r['label'] or r['run_id'][:8]}  "
                f"attr={r.get('attribute1','?')} div={r.get('division','ALL')}  "
                f"req={r.get('total_req',0):,}  fill_rate={r.get('fill_rate_achieved',0):.1%}  "
                f"started={str(r.get('started_at',''))[:16]}"
            )
        lines.append("")
    except Exception as exc:
        logger.warning("assistant context: history failed: %s", exc)

    # Oracle store/item summary (from cache — no extra DB round-trip)
    try:
        from app.repositories.store_repository import StoreRepository
        from app.repositories.item_repository import ItemRepository
        store_df = StoreRepository().get_all_stores(active_only=True)
        item_df  = ItemRepository()._load()
        lines.append("### Oracle Master Data (cached)")
        lines.append(f"Active stores: {len(store_df)}")
        lines.append(f"Total items: {len(item_df)}")
        lines.append("")
    except Exception as exc:
        logger.warning("assistant context: oracle cache failed: %s", exc)

    return "\n".join(lines)


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    messages: list[ChatMessage]


@router.get("/logs")
async def get_logs(limit: int = 100, offset: int = 0):
    """Admin: list all assistant conversation logs, newest first."""
    from app.models.response_models import APIResponse
    from app.db.sqlite import get_sqlite
    with get_sqlite() as conn:
        total = conn.execute("SELECT COUNT(*) FROM assistant_logs").fetchone()[0]
        rows = conn.execute(
            """SELECT id, user_email, user_name, user_role, question, answer, created_at
               FROM assistant_logs ORDER BY created_at DESC LIMIT ? OFFSET ?""",
            (limit, offset),
        ).fetchall()
    return APIResponse.ok(data={
        "logs": [dict(r) for r in rows],
        "total": total,
    })


@router.get("/status")
async def status():
    """Returns whether the assistant is ready (API key configured)."""
    from app.models.response_models import APIResponse
    configured = bool(settings.anthropic_api_key.get_secret_value())
    return APIResponse.ok(data={"configured": configured})


@router.post("/chat")
async def chat(body: ChatRequest, request: Request):
    api_key = settings.anthropic_api_key.get_secret_value()
    if not api_key:
        raise HTTPException(
            status_code=503,
            detail="Assistant is not configured. Ask your admin to set ANTHROPIC_API_KEY.",
        )

    try:
        import anthropic
    except ImportError:
        raise HTTPException(
            status_code=503,
            detail="anthropic package not installed. Run: pip install anthropic",
        )

    messages = [{"role": m.role, "content": m.content} for m in body.messages]
    if not messages:
        raise HTTPException(status_code=400, detail="messages list is empty")

    # Inject live app context so the assistant can answer real questions
    caller = getattr(request.state, "user", {})
    live_context = _build_live_context(
        caller_role=caller.get("role", "unknown"),
        caller_email=caller.get("email", "unknown"),
        caller_name=caller.get("name", "unknown"),
    )
    system_with_context = SYSTEM_PROMPT + live_context

    client = anthropic.Anthropic(api_key=api_key)

    user_question = messages[-1]["content"] if messages else ""

    def generate():
        full_answer = ""
        try:
            with client.messages.stream(
                model="claude-haiku-4-5",
                max_tokens=1024,
                system=system_with_context,
                messages=messages,
            ) as stream:
                for text in stream.text_stream:
                    full_answer += text
                    yield f"data: {json.dumps({'text': text})}\n\n"
            yield "data: [DONE]\n\n"
        except anthropic.APIError as exc:
            logger.error("Anthropic API error: %s", exc)
            full_answer = str(exc)
            yield f"data: {json.dumps({'error': str(exc)})}\n\n"
        except Exception as exc:
            logger.error("Assistant stream error: %s", exc)
            full_answer = "Assistant encountered an error"
            yield f"data: {json.dumps({'error': full_answer})}\n\n"
        finally:
            # Save to assistant_logs for admin review
            try:
                import uuid
                from datetime import datetime, timezone
                from app.db.sqlite import get_sqlite
                with get_sqlite() as conn:
                    conn.execute(
                        """INSERT INTO assistant_logs
                           (id, user_email, user_name, user_role, question, answer, created_at)
                           VALUES (?, ?, ?, ?, ?, ?, ?)""",
                        (
                            str(uuid.uuid4()),
                            caller.get("email", "unknown"),
                            caller.get("name", "unknown"),
                            caller.get("role", "unknown"),
                            user_question[:2000],
                            full_answer[:4000],
                            datetime.now(timezone.utc).isoformat(),
                        ),
                    )
            except Exception as log_exc:
                logger.warning("Failed to save assistant log: %s", log_exc)

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
