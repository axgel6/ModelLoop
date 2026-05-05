import httpx
import json
import logging
from typing import Optional
from config import OLLAMA_BASE_URL, VISION_MODEL, NGROK_HEADERS, THINKING_MODELS

logger = logging.getLogger(__name__)


def _is_thinking_model(model: str) -> bool:
    name = model.lower()
    return any(pattern in name for pattern in THINKING_MODELS)


async def _describe_images(images: list[str]) -> str:
    n = len(images)
    prompt = (
        f"Describe {'this image' if n == 1 else f'these {n} images'} in full detail. "
        "If there is text, equations, or code, transcribe it exactly word-for-word. "
        "If it is a photo or diagram, describe every visible element, object, color, and layout."
    )
    payload = {
        "model": VISION_MODEL,
        "messages": [{"role": "user", "content": prompt, "images": images}],
        "stream": False,
        "keep_alive": -1,
        "options": {"temperature": 0.1},
    }
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(
                f"{OLLAMA_BASE_URL}/api/chat",
                json=payload,
                headers=NGROK_HEADERS,
            )
            resp.raise_for_status()
            data = resp.json()
            return data.get("message", {}).get("content", "").strip()
    except Exception as e:
        logger.warning("image_description_failed error=%s", str(e))
        return ""


async def _ollama_stream(messages: list, model: str, temperature: float, tools: Optional[list] = None):
    payload: dict = {
        "model":      model,
        "messages":   messages,
        "stream":     True,
        "keep_alive": -1,
        "options":    {"temperature": temperature},
    }
    # Thinking models don't support tools parameter; skip them
    if tools and not _is_thinking_model(model):
        payload["tools"] = tools
    if _is_thinking_model(model):
        payload["think"] = True
    async with httpx.AsyncClient(timeout=120) as client:
        async with client.stream(
            "POST",
            f"{OLLAMA_BASE_URL}/api/chat",
            json=payload,
            headers=NGROK_HEADERS,
        ) as resp:
            resp.raise_for_status()
            async for line in resp.aiter_lines():
                if line:
                    try:
                        chunk = json.loads(line)
                        thinking = chunk.get("message", {}).get("thinking", "")
                        if thinking:
                            yield {"_thinking": thinking}
                        yield chunk
                    except json.JSONDecodeError:
                        continue
