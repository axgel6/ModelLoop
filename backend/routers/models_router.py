import httpx
import logging
from fastapi import APIRouter, HTTPException
from config import OLLAMA_BASE_URL, DEFAULT_MODEL, NGROK_HEADERS

logger = logging.getLogger(__name__)
router = APIRouter(tags=["models"])

_cached_models: list[str] = []


@router.get("/api/v1/models")
async def get_models():
    global _cached_models
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(f"{OLLAMA_BASE_URL}/api/tags", headers=NGROK_HEADERS)
            resp.raise_for_status()
            data = resp.json()

        fetched = [m.get("name") for m in data.get("models", []) if m.get("name")]
        _cached_models = fetched

        if DEFAULT_MODEL in _cached_models:
            _cached_models.remove(DEFAULT_MODEL)
            _cached_models.insert(0, DEFAULT_MODEL)

        return {"models": _cached_models}

    except Exception as e:
        logger.error('ollama_fetch_failed error=%s', str(e))
        if _cached_models:
            return {"models": _cached_models}
        raise HTTPException(status_code=500, detail=str(e))
