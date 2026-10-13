from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from config import (
    OLLAMA_BASE_URL, NGROK_HEADERS,
    CHAT_RATE_LIMIT, GUEST_CHAT_RATE_LIMIT, GUEST_CHAT_DAILY_LIMIT,
)
from ollama_http import client as ollama_client

router = APIRouter(tags=["health"])


@router.get("/api/v1/health")
async def health(db: AsyncSession = Depends(get_db)):
    checks = {"status": "ok", "db": "ok", "ollama": "ok"}
    try:
        await db.execute(text("SELECT 1"))
    except Exception:
        checks["db"] = "error"
        checks["status"] = "degraded"
    try:
        resp = await ollama_client().get(f"{OLLAMA_BASE_URL}/api/tags", headers=NGROK_HEADERS, timeout=3)
        resp.raise_for_status()
    except Exception:
        checks["ollama"] = "error"
        checks["status"] = "degraded"
    return checks


@router.get("/api/v1/limits")
async def limits():
    """The rate limits in force. All are env-configurable, so the client reads them
    from here rather than hardcoding numbers that go stale."""
    return {
        "chat": CHAT_RATE_LIMIT,
        "guest_chat": GUEST_CHAT_RATE_LIMIT,
        "guest_daily": GUEST_CHAT_DAILY_LIMIT,
    }
