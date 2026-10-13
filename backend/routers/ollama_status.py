import logging
import time

import httpx
from fastapi import APIRouter, Depends, HTTPException

import config as _config
from config import NGROK_HEADERS
from dependencies import get_user
from models import User
from net_guard import validate_ollama_url_async, UnsafeOllamaUrl
from ollama_http import client as ollama_client
from ollama_target import effective_ollama_url
from schemas import UpdateOllamaUrlRequest

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/ollama", tags=["ollama"])

# A cold shared server (an ngrok tunnel to a sleeping machine, say) can take a while to
# answer the first request. Wait long enough to tell "waking up" apart from "not there".
_PROBE_TIMEOUT = 25.0


async def _probe(base_url: str) -> dict:
    started = time.monotonic()
    try:
        resp = await ollama_client().get(
            f"{base_url}/api/tags", headers=NGROK_HEADERS, timeout=_PROBE_TIMEOUT
        )
        resp.raise_for_status()
        models = [m.get("name") for m in resp.json().get("models", []) if m.get("name")]
        return {
            "reachable":  True,
            "models":     len(models),
            "sample":     models[:5],
            "latency_ms": round((time.monotonic() - started) * 1000),
        }
    except httpx.TimeoutException:
        return {
            "reachable": False,
            "reason":    "timeout",
            "detail":    "No answer yet. If this is the shared test server it may still "
                         "be waking up, so try again in a minute.",
        }
    except httpx.HTTPStatusError as exc:
        # Something answered, but not Ollama. Say that plainly instead of echoing the
        # library's exception text, which carries a stack-ish URL and a docs link.
        code = exc.response.status_code
        detail = (
            f"Something answered at that address but returned HTTP {code}, so it does "
            "not look like an Ollama server. Check the address and the port."
        )
        logger.info("ollama_probe_bad_status status=%s", code)
        return {"reachable": False, "reason": "unreachable", "detail": detail}
    except httpx.ConnectError:
        return {
            "reachable": False,
            "reason":    "unreachable",
            "detail":    "Could not connect. Check that the server is running and that "
                         "the address is reachable from the internet.",
        }
    except Exception as exc:
        logger.info("ollama_probe_failed error=%s", type(exc).__name__)
        return {
            "reachable": False,
            "reason":    "unreachable",
            "detail":    "Could not reach that address.",
        }


@router.get("/status")
async def ollama_status(user: User = Depends(get_user)):
    """Reachability of the server this account actually uses."""
    base_url = await effective_ollama_url(user)
    result = await _probe(base_url)
    result["using_shared_server"] = base_url == _config.OLLAMA_BASE_URL
    # Never echo the shared server's address back: it is the operator's infrastructure.
    result["url"] = None if result["using_shared_server"] else base_url
    return result


@router.post("/test")
async def test_ollama_url(
    body: UpdateOllamaUrlRequest,
    _: User = Depends(get_user),
):
    """Probe a candidate URL without saving it, so the user can check before committing."""
    raw = (body.ollama_url or "").strip()
    if not raw:
        raise HTTPException(status_code=400, detail="Enter a URL to test")
    try:
        base_url = await validate_ollama_url_async(raw)
    except UnsafeOllamaUrl as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {**await _probe(base_url), "url": base_url}
