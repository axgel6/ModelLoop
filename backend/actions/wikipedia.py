import json
import re
import time
from typing import Optional

import httpx

DEFINITION = {
    "type": "function",
    "function": {
        "name": "wikipedia_summary",
        "description": (
            "Look up a topic on Wikipedia and return a concise summary. "
            "Use this for factual, encyclopedic questions: who/what someone or something is, "
            "historical events, scientific concepts, biographies, or definitions. "
            "Prefer this over web_search when the question is definitional rather than time-sensitive."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "The topic or person to look up, e.g. 'Marie Curie' or 'quantum entanglement'",
                },
            },
            "required": ["query"],
        },
    },
}

_WIKI_EXPLICIT = re.compile(
    r"\b(wikipedia|wiki)\b|on wikipedia\b|(look up|search) (wikipedia|wiki)\b",
    re.IGNORECASE,
)

_BASE_URL = "https://en.wikipedia.org/api/rest_v1/page/summary/"
_SEARCH_URL = "https://en.wikipedia.org/w/api.php"

_HEADERS = {
    "User-Agent": "ModelLoop/1.0 (self-hosted AI assistant; contact via github)",
    "Accept": "application/json",
}

_async_client: Optional[httpx.AsyncClient] = None

_cache: dict[str, tuple[str, float]] = {}
_CACHE_TTL = 3600.0  # Wikipedia summaries are stable; cache for 1 hour
_CACHE_MAX = 200


def _cache_get(key: str) -> Optional[str]:
    entry = _cache.get(key)
    if entry and time.monotonic() - entry[1] < _CACHE_TTL:
        return entry[0]
    if entry:
        del _cache[key]
    return None


def _cache_set(key: str, value: str) -> None:
    if len(_cache) >= _CACHE_MAX:
        cutoff = time.monotonic() - _CACHE_TTL
        expired = [k for k, (_, ts) in _cache.items() if ts < cutoff]
        for k in expired:
            del _cache[k]
    _cache[key] = (value, time.monotonic())


def _get_async_client() -> httpx.AsyncClient:
    global _async_client
    if _async_client is None or _async_client.is_closed:
        _async_client = httpx.AsyncClient(
            headers=_HEADERS,
            follow_redirects=True,
            timeout=8,
        )
    return _async_client


def should_activate(text: str, words: set) -> bool:
    return bool(_WIKI_EXPLICIT.search(text))


async def async_execute(arguments: dict) -> str:
    query = (arguments.get("query") or "").strip()
    if not query:
        return json.dumps({"error": "No query provided"})

    cache_key = query.lower()
    cached = _cache_get(cache_key)
    if cached:
        return cached

    client = _get_async_client()

    # Try direct summary lookup first (works well for proper nouns and exact titles)
    slug = query.replace(" ", "_")
    try:
        resp = await client.get(_BASE_URL + httpx.utils.quote(slug, safe=""))
        if resp.status_code == 200:
            data = resp.json()
            result = _format_summary(data)
            _cache_set(cache_key, result)
            return result
    except Exception:
        pass

    # Fall back to search API to find the best matching page title
    try:
        resp = await client.get(_SEARCH_URL, params={
            "action": "query",
            "list": "search",
            "srsearch": query,
            "srlimit": 1,
            "format": "json",
        })
        resp.raise_for_status()
        hits = resp.json().get("query", {}).get("search", [])
        if not hits:
            return json.dumps({"error": f"No Wikipedia article found for: {query}"})

        title = hits[0]["title"]
        slug = title.replace(" ", "_")
        resp2 = await client.get(_BASE_URL + httpx.utils.quote(slug, safe=""))
        resp2.raise_for_status()
        result = _format_summary(resp2.json())
        _cache_set(cache_key, result)
        return result
    except Exception as e:
        return json.dumps({"error": str(e)})


def _format_summary(data: dict) -> str:
    return json.dumps({
        "title": data.get("title", ""),
        "summary": data.get("extract", ""),
        "url": data.get("content_urls", {}).get("desktop", {}).get("page", ""),
        "type": data.get("type", ""),  # "standard", "disambiguation", "no-extract"
    })
