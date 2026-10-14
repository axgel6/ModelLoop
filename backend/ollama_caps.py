"""What a model can do (think, see images, call tools), as Ollama reports it for that model.

Asked once per server and model, then remembered. When the server cannot be asked, the
THINKING_MODELS setting stands in, so nothing breaks while Ollama is unreachable.
"""
import logging

import ollama_http
from config import NGROK_HEADERS, THINKING_MODELS

logger = logging.getLogger(__name__)

_known: dict[tuple[str, str], list[str]] = {}


async def capabilities(base_url: str, model: str) -> list[str]:
    key = (base_url, model)
    if key not in _known:
        try:
            resp = await ollama_http.client().post(
                f"{base_url}/api/show", json={"model": model}, headers=NGROK_HEADERS, timeout=10,
            )
            resp.raise_for_status()
            _known[key] = list(resp.json().get("capabilities") or [])
        except Exception as e:
            logger.warning("model_show_failed model=%s error=%s", model, str(e))
            # Not remembered: the next call asks again
            return ["thinking"] if any(p in model.lower() for p in THINKING_MODELS) else []
    return _known[key]


async def can_think(base_url: str, model: str) -> bool:
    """Whether the model can reason before answering. Asking one that cannot to think, or to
    stop thinking, is an error, so callers only set `think` for models where this is true."""
    return "thinking" in await capabilities(base_url, model)
