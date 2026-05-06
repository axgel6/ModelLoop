import json
import re
import time
from html.parser import HTMLParser
from typing import Optional

import httpx

DEFINITION = {
    "type": "function",
    "function": {
        "name": "web_search",
        "description": (
            "Search the web with DuckDuckGo and return the top results. "
            "Use this for current events, news, prices, sports scores, weather, or any factual question "
            "where your training data may be outdated. Returns titles, URLs, and snippets."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "The search query, e.g. 'latest Python 3.13 release notes'",
                },
                "max_results": {
                    "type": "integer",
                    "description": "Number of results to return (1–10, default 8)",
                },
            },
            "required": ["query"],
        },
    },
}

# Tight keyword set — only genuine time-sensitive / real-world-lookup signals.
# Broad terms like "bug", "error", "how to", "what is" are intentionally excluded:
# they fire on nearly every coding question, injecting irrelevant search results
# that confuse the model. The model can call the tool itself when it decides to.
KEYWORDS = {
    "news", "latest", "current", "today", "recent", "live",
    "price", "cost", "stock", "weather", "forecast", "score",
    "headline", "trending",
    "search", "lookup",
}

_SEARCH_TRIGGERS = re.compile(
    r"\b("
    # Explicit search requests
    r"search (for|about|the|up)|look up|lookup|"
    # Time-sensitive queries
    r"(latest|current|today'?s?|recent|live) (news|updates?|version|release|scores?|weather|price|results?)|"
    r"(news|headlines?) (about|on|regarding)|"
    r"weather (in|for|today|tonight|tomorrow)|"
    r"(stock|share) price|"
    r"(who|what|when) (won|is winning|happened) (the |this |last )?(game|match|election|race|series)|"
    r"(current|live) (standings?|rankings?|scores?)|"
    r"(this|last) (week|month|year)'?s? .{0,30}(news|results?|winner|champion)"
    r")\b",
    re.IGNORECASE,
)

# Entity question patterns — must pair with a proper noun check to avoid firing on coding questions.
_ENTITY_QUESTION_RE = re.compile(
    r"\b(?:who|what)\s+(?:is|are|was|were)\b"
    r"|\btell\s+me\s+about\b"
    r"|\b(?:biography|background|profile|history|age|nationality)\s+of\b"
    r"|\bwho\s+(?:made|created|founded|invented|wrote|directed|produced|plays?|played)\b",
    re.IGNORECASE,
)

# Words that appear capitalised but are NOT proper nouns (sentence starters, articles, etc.)
_COMMON_CAPS = frozenset({
    "The", "A", "An", "Is", "Are", "Was", "Were", "Who", "What", "Where",
    "When", "Why", "How", "Do", "Does", "Did", "Can", "Could", "Would",
    "Will", "Should", "He", "She", "They", "We", "You", "His", "Her",
    "Their", "Its", "My", "Your", "Our", "This", "That", "These", "Those",
    "In", "On", "At", "For", "Of", "To", "By", "With", "From", "And",
    "Or", "But", "So", "If", "Tell", "Give", "Show", "List",
})


def _has_proper_noun(text: str) -> bool:
    """Returns True if text contains a proper noun (capitalised non-common word after the first)."""
    words = text.split()
    for word in words[1:]:  # skip first word — sentence-start capital is meaningless
        clean = re.sub(r"[^\w]", "", word)
        if clean and clean[0].isupper() and clean not in _COMMON_CAPS:
            return True
    return False

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

# Module-level persistent client — reuses TCP connections across requests.
_async_client: Optional[httpx.AsyncClient] = None
_sync_client: Optional[httpx.Client] = None

# Simple TTL cache: query_key -> (json_str, timestamp)
_cache: dict[str, tuple[str, float]] = {}
_CACHE_TTL = 300.0   # 5 minutes
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
            limits=httpx.Limits(max_keepalive_connections=5, max_connections=10),
        )
    return _async_client


def _get_sync_client() -> httpx.Client:
    global _sync_client
    if _sync_client is None or _sync_client.is_closed:
        _sync_client = httpx.Client(
            headers=_HEADERS,
            follow_redirects=True,
            timeout=8,
        )
    return _sync_client


class _DDGParser(HTMLParser):
    """Parses DDG Lite HTML into a list of {title, url, snippet} dicts."""

    def __init__(self, max_results: int) -> None:
        super().__init__(convert_charrefs=True)
        self._max = max_results
        self.results: list = []
        self._cur_url: Optional[str] = None
        self._cur_title: Optional[list] = None
        self._in_snippet = False
        self._snippet: list = []

    def handle_starttag(self, tag: str, attrs: list) -> None:
        if len(self.results) >= self._max:
            return
        d = dict(attrs)
        if tag == "a" and d.get("class") == "result-link":
            self._cur_url = d.get("href", "").strip()
            self._cur_title = []
        elif tag == "td" and d.get("class") == "result-snippet":
            self._in_snippet = True
            self._snippet = []

    def handle_endtag(self, tag: str) -> None:
        if tag == "a" and self._cur_title is not None:
            title = "".join(self._cur_title).strip()
            if self._cur_url and title:
                self.results.append({"title": title, "url": self._cur_url, "snippet": ""})
            self._cur_url = None
            self._cur_title = None
        elif tag == "td" and self._in_snippet:
            self._in_snippet = False
            snippet = re.sub(r"\s+", " ", "".join(self._snippet)).strip()
            if self.results:
                self.results[-1]["snippet"] = snippet
            self._snippet = []

    def handle_data(self, data: str) -> None:
        if self._cur_title is not None:
            self._cur_title.append(data)
        if self._in_snippet:
            self._snippet.append(data)


def _parse_results(html: str, max_results: int) -> list:
    parser = _DDGParser(max_results)
    parser.feed(html)
    return parser.results


def should_activate(text: str, words: set) -> bool:
    if words & KEYWORDS:
        return True
    if _SEARCH_TRIGGERS.search(text):
        return True
    # Entity queries ("who is X", "what is X", "tell me about X") only trigger when
    # the query contains a proper noun — this avoids firing on coding questions like
    # "who is the function caller" or "what is a variable".
    if _ENTITY_QUESTION_RE.search(text) and _has_proper_noun(text):
        return True
    return False


async def async_execute(arguments: dict) -> str:
    query = arguments.get("query", "").strip()
    try:
        max_results = min(max(int(arguments.get("max_results") or 8), 1), 10)
    except (TypeError, ValueError):
        max_results = 8
    if not query:
        return json.dumps({"error": "No query provided"})
    cache_key = f"{query}:{max_results}"
    cached = _cache_get(cache_key)
    if cached:
        return cached
    try:
        client = _get_async_client()
        resp = await client.post("https://lite.duckduckgo.com/lite/", data={"q": query})
        resp.raise_for_status()
        results = _parse_results(resp.text, max_results)
        out = json.dumps(
            {"query": query, "results": results}
            if results
            else {"query": query, "results": [], "note": "No results found"}
        )
        if results:
            _cache_set(cache_key, out)
        return out
    except Exception as e:
        return json.dumps({"error": str(e)})


def execute(arguments: dict) -> str:
    query = arguments.get("query", "").strip()
    try:
        max_results = min(max(int(arguments.get("max_results") or 8), 1), 10)
    except (TypeError, ValueError):
        max_results = 8
    if not query:
        return json.dumps({"error": "No query provided"})
    cache_key = f"{query}:{max_results}"
    cached = _cache_get(cache_key)
    if cached:
        return cached
    try:
        client = _get_sync_client()
        resp = client.post("https://lite.duckduckgo.com/lite/", data={"q": query})
        resp.raise_for_status()
        results = _parse_results(resp.text, max_results)
        out = json.dumps(
            {"query": query, "results": results}
            if results
            else {"query": query, "results": [], "note": "No results found"}
        )
        if results:
            _cache_set(cache_key, out)
        return out
    except Exception as e:
        return json.dumps({"error": str(e)})
