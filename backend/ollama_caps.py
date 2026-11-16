"""What a model can do (think, see images, call tools) and how much context it takes, as
Ollama reports it for that model.

Asked once per server and model, then remembered. When the server cannot be asked, the
THINKING_MODELS setting stands in, so nothing breaks while Ollama is unreachable.
"""
import logging
from typing import Optional

import ollama_http
from config import NGROK_HEADERS, NUM_CTX_MAX, THINKING_MODELS

logger = logging.getLogger(__name__)

# (base_url, model) -> {"capabilities": [...], "context_length": int or None}
_known: dict[tuple[str, str], dict] = {}


def _context_length(model_info: dict) -> Optional[int]:
    """The model's trained context length. Ollama keys it by architecture, e.g. "llama.context_length"."""
    for key, value in (model_info or {}).items():
        if key.endswith(".context_length") and isinstance(value, int) and value > 0:
            return value
    return None


async def _show(base_url: str, model: str) -> Optional[dict]:
    key = (base_url, model)
    if key not in _known:
        try:
            resp = await ollama_http.client().post(
                f"{base_url}/api/show", json={"model": model}, headers=NGROK_HEADERS, timeout=10,
            )
            resp.raise_for_status()
            data = resp.json()
            _known[key] = {
                "capabilities": list(data.get("capabilities") or []),
                "context_length": _context_length(data.get("model_info") or {}),
            }
        except Exception as e:
            logger.warning("model_show_failed model=%s error=%r", model, e)
            # Not remembered: the next call asks again
            return None
    return _known[key]


async def capabilities(base_url: str, model: str) -> list[str]:
    shown = await _show(base_url, model)
    if shown is None:
        return ["thinking"] if any(p in model.lower() for p in THINKING_MODELS) else []
    return shown["capabilities"]


async def can_think(base_url: str, model: str) -> bool:
    """Whether the model can reason before answering. Asking one that cannot to think, or to
    stop thinking, is an error, so callers only set `think` for models where this is true."""
    return "thinking" in await capabilities(base_url, model)


async def with_num_ctx(options: dict, base_url: str, model: str) -> dict:
    """`options` with the context window to load `model` with: what it was trained for, capped
    at NUM_CTX_MAX to bound memory. Without it Ollama uses its small default and silently drops
    the start of a long chat.

    Every call for a model must ask for the same size, or Ollama reloads the model each time
    it changes, so every request goes through here. Left to the server's default when the
    model's length is unknown or NUM_CTX_MAX is 0."""
    if NUM_CTX_MAX <= 0:
        return options
    shown = await _show(base_url, model)
    length = shown and shown["context_length"]
    if not length:
        return options
    return {**options, "num_ctx": min(length, NUM_CTX_MAX)}
