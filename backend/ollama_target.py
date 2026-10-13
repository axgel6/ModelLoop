"""Resolves which Ollama server a given request should talk to.

A user may save their own endpoint; everyone else (and every guest) uses the shared
server from OLLAMA_URL. User-supplied values are re-validated here, immediately before
use, so a hostname that has since been repointed at a private address is still refused.
"""
import logging
from typing import Optional

import config as _config
from models import User
from net_guard import validate_ollama_url_async, UnsafeOllamaUrl

logger = logging.getLogger(__name__)


async def effective_ollama_url(user: Optional[User]) -> str:
    """Return the base URL to use, falling back to the shared server.

    Async because validating a custom URL resolves its hostname off the event loop.
    Guests and users on the shared server never reach the resolver.
    """
    custom = getattr(user, "ollama_url", None) if user else None
    if not custom:
        return _config.OLLAMA_BASE_URL
    try:
        return await validate_ollama_url_async(custom)
    except UnsafeOllamaUrl as exc:
        # A stored value that no longer passes the guard must never be fetched.
        logger.warning("stored_ollama_url_rejected user_id=%s reason=%s", user.id, exc)
        return _config.OLLAMA_BASE_URL
