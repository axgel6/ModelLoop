import logging
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException

import config as _config
import asyncio

import ollama_caps
from config import DEFAULT_MODEL, NGROK_HEADERS, TOOL_CAPABLE_MODELS
from dependencies import get_optional_user
from models import User
from ollama_http import client as ollama_client
from ollama_target import effective_ollama_url

logger = logging.getLogger(__name__)
router = APIRouter(tags=["models"])

_cached_models: list[str] = []


async def _model_capabilities(base_url: str, name: str) -> list[str]:
    """What the picker and chat show for a model: thinking and images as Ollama reports them,
    and web search for the models allowed to use tools."""
    reported = await ollama_caps.capabilities(base_url, name)
    caps = [c for c in ("thinking", "vision") if c in reported]
    if "tools" in reported or any(p in name.lower() for p in TOOL_CAPABLE_MODELS):
        caps.append("web")
    return caps


async def _all_capabilities(base_url: str, names: list[str]) -> dict[str, list[str]]:
    found = await asyncio.gather(*(_model_capabilities(base_url, n) for n in names))
    return dict(zip(names, found))


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

        return {
            "models": fetched,
            "capabilities": await _all_capabilities(base_url, fetched),
            # What chat and the games fall back to when nothing is picked
            "defaults": {"chat": DEFAULT_MODEL, "game": _config.GAME_MODEL},
        }

    except Exception as e:
        logger.error('ollama_fetch_failed error=%s', str(e))
        if shared and _cached_models:
            capabilities = await _all_capabilities(base_url, _cached_models)
            return {
                "models": _cached_models, "capabilities": capabilities,
                "defaults": {"chat": DEFAULT_MODEL, "game": _config.GAME_MODEL},
            }
        # Not str(e): httpx status errors carry the full URL, and the shared server's
        # address must not reach callers (this endpoint is open to guests).
        raise HTTPException(status_code=502, detail="Could not reach the model server")
