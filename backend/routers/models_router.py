import logging
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException

import config as _config
from config import DEFAULT_MODEL, NGROK_HEADERS, THINKING_MODELS, TOOL_CAPABLE_MODELS
from dependencies import get_optional_user
from models import User
from ollama_http import client as ollama_client
from ollama_target import effective_ollama_url

logger = logging.getLogger(__name__)
router = APIRouter(tags=["models"])

_cached_models: list[str] = []


def _model_capabilities(name: str) -> list[str]:
    lower = name.lower()
    caps = []
    if any(p in lower for p in THINKING_MODELS):
        caps.append("thinking")
    if any(p in lower for p in TOOL_CAPABLE_MODELS):
        caps.append("web")
    return caps


@router.get("/api/v1/models")
async def get_models(user: Optional[User] = Depends(get_optional_user)):
    global _cached_models
    base_url = await effective_ollama_url(user)
    shared = base_url == _config.OLLAMA_BASE_URL
    try:
        resp = await ollama_client().get(f"{base_url}/api/tags", headers=NGROK_HEADERS, timeout=10)
        resp.raise_for_status()
        data = resp.json()

        fetched = [m.get("name") for m in data.get("models", []) if m.get("name")]
        if DEFAULT_MODEL in fetched:
            fetched.remove(DEFAULT_MODEL)
            fetched.insert(0, DEFAULT_MODEL)

        # Cache only the shared server's list; one user's private models must never be
        # served to another from this module-level cache.
        if shared:
            _cached_models = fetched

        return {"models": fetched, "capabilities": {m: _model_capabilities(m) for m in fetched}}

    except Exception as e:
        logger.error('ollama_fetch_failed error=%s', str(e))
        if shared and _cached_models:
            capabilities = {m: _model_capabilities(m) for m in _cached_models}
            return {"models": _cached_models, "capabilities": capabilities}
        # Not str(e): httpx status errors carry the full URL, and the shared server's
        # address must not reach callers (this endpoint is open to guests).
        raise HTTPException(status_code=502, detail="Could not reach the model server")
