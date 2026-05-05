import httpx
from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from config import OLLAMA_BASE_URL, NGROK_HEADERS

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
        async with httpx.AsyncClient(timeout=3) as client:
            resp = await client.get(f"{OLLAMA_BASE_URL}/api/tags", headers=NGROK_HEADERS)
            resp.raise_for_status()
    except Exception:
        checks["ollama"] = "error"
        checks["status"] = "degraded"
    return checks
