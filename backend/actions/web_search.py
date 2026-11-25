import json
import logging
import re
from html.parser import HTMLParser
from typing import Optional

import httpx

from config import SEARCH_PROVIDER, TAVILY_API_KEY

from ._shared import BROWSER_USER_AGENT, MISSING, TTLCache
from .page_text import add_excerpts

DEFINITION = {
    "type": "function",
    "function": {
        "name": "web_search",
        "description": (
            "Search the web and return the top results. "
            "Use this for current events, news, prices, sports scores, weather, or any factual question "
            "where your training data may be outdated. Also use it to identify quotes, lyrics, memes, "
            "names, or references you don't recognize. Returns titles, URLs, and snippets."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "The search query, e.g. 'latest Python 3.14 release notes'",
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

# Tight keyword set — only domain-specific, unambiguous lookup signals.
# Temporal words like "today", "current", "latest", "recent", "live" are intentionally
# excluded here: they are too common in casual conversation (e.g. "how are you today?")
# and cause false alarms. Those words are already covered by _SEARCH_TRIGGERS when
# paired with search-worthy context (e.g. "today's weather", "latest news").
KEYWORDS = {
    "news", "headline", "trending",
    "weather", "forecast",
    "price", "cost", "stock",
    "score",
    "search", "lookup",
}

_SEARCH_TRIGGERS = re.compile(
    r"\b("
    # Explicit search requests
    r"search (for|about|the|up)|look up|lookup|"
    # Time-sensitive queries
    r"(latest|current|today'?s?|recent|live) (news|updates?|version|release|scores?|weather|price|results?)|"
    # "The latest iPhone", "the newest Pixel": the answer moves with time. Not "the latest
    # item in a list" and the like, which are about code.
    r"(latest|newest|most recent) (?!(item|element|entry|entries|commit|file|row|record|value|node|message|one|ones)\b)[\w-]+|"
    r"(who is|who'?s) (the )?(current|new) |"
    r"(news|headlines?) (about|on|regarding)|"
    r"weather (in|for|today|tonight|tomorrow)|"
    r"(stock|share) price|"
    r"(who|what teams?) (is|are) playing (tonight|today|now|this (week|weekend))|"
    r"(who|what|when) (won|is winning|happened) (the |this |last )?(game|match|election|race|series)|"
    r"(game|match|fixture)s? (tonight|today|this (week|weekend))|"
    r"(tonight|today)'?s? (game|match|schedule|lineup|fixture|standings?|results?)|"
    r"(current|live) (standings?|rankings?|scores?)|"
    r"(this|last) (week|month|year)'?s? .{0,30}(news|results?|winner|champion)|"
    # Entertainment / media releases
    r"(new|latest|recent) (single|album|song|track|movie|film|show|episode|season|release|video|tour)"
    r")\b",
    re.IGNORECASE,
)



_COUNTRY_TO_DDG = {
    "us": "us-en", "gb": "uk-en", "au": "au-en", "ca": "ca-en",
    "de": "de-de", "fr": "fr-fr", "es": "es-es", "it": "it-it",
    "mx": "mx-es", "br": "br-pt", "pt": "pt-pt", "nl": "nl-nl",
    "pl": "pl-pl", "ru": "ru-ru", "jp": "jp-jp", "kr": "kr-ko",
    "cn": "cn-zh", "in": "in-en", "ar": "ar-es", "co": "co-es",
    "cl": "cl-es", "pe": "pe-es",
}

_LANG_TO_DDG = {
    "en": "us-en", "de": "de-de", "fr": "fr-fr", "it": "it-it",
    "pt": "br-pt", "nl": "nl-nl", "pl": "pl-pl", "ru": "ru-ru",
    "ja": "jp-jp", "ko": "kr-ko", "zh": "cn-zh",
}


def accept_language_to_region(header: str) -> str:
    """Map an Accept-Language header to a DDG kl region string.

    Two-pass: prefer tags with explicit country codes so that es-US and
    es-419 (Latin American Spanish) correctly resolve to us-en rather than
    es-es, then fall back to language-only defaults.
    """
    tags = [p.split(";")[0].strip().lower() for p in header.split(",") if p.strip()]

    # First pass — explicit country codes
    for tag in tags:
        parts = tag.split("-")
        lang, country = parts[0], parts[1] if len(parts) > 1 else None
        if lang == "es" and country == "419":   # Latin American Spanish
            return "us-en"
        if country:
            region = _COUNTRY_TO_DDG.get(country)
            if region:
                return region

    # Second pass — language-only fallbacks
    for tag in tags:
        region = _LANG_TO_DDG.get(tag.split("-")[0])
        if region:
            return region

    return "us-en"


_HEADERS = {
    "User-Agent": BROWSER_USER_AGENT,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

_DDG_LITE_URL = "https://lite.duckduckgo.com/lite/"
_DDG_HTML_URL = "https://html.duckduckgo.com/html/"

# DuckDuckGo blocks most datacenter IPs (Render, Fly, AWS...), so hosted instances
# need a keyed search API. SEARCH_PROVIDER picks which is used (see config.py).
_TAVILY_URL = "https://api.tavily.com/search"

logger = logging.getLogger(__name__)

# Module-level persistent client — reuses TCP connections across requests.
_async_client: Optional[httpx.AsyncClient] = None

# Search results by query, kept 5 minutes
_cache = TTLCache(ttl=300.0)


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


class _DDGLiteParser(HTMLParser):
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


class _DDGHtmlParser(HTMLParser):
    """Parses DDG HTML endpoint (html.duckduckgo.com/html/) as a fallback."""

    def __init__(self, max_results: int) -> None:
        super().__init__(convert_charrefs=True)
        self._max = max_results
        self.results: list = []
        self._in_title = False
        self._in_snippet = False
        self._cur_url: Optional[str] = None
        self._cur_title: list = []
        self._cur_snippet: list = []

    def handle_starttag(self, tag: str, attrs: list) -> None:
        if len(self.results) >= self._max:
            return
        d = dict(attrs)
        cls = d.get("class", "")
        if tag == "a" and "result__a" in cls:
            self._cur_url = d.get("href", "").strip()
            self._in_title = True
            self._cur_title = []
        elif tag == "a" and "result__snippet" in cls:
            self._in_snippet = True
            self._cur_snippet = []

    def handle_endtag(self, tag: str) -> None:
        if tag == "a" and self._in_title:
            self._in_title = False
            title = "".join(self._cur_title).strip()
            if self._cur_url and title:
                self.results.append({"title": title, "url": self._cur_url, "snippet": ""})
            self._cur_url = None
            self._cur_title = []
        elif tag == "a" and self._in_snippet:
            self._in_snippet = False
            snippet = re.sub(r"\s+", " ", "".join(self._cur_snippet)).strip()
            if self.results:
                self.results[-1]["snippet"] = snippet
            self._cur_snippet = []

    def handle_data(self, data: str) -> None:
        if self._in_title:
            self._cur_title.append(data)
        if self._in_snippet:
            self._cur_snippet.append(data)


def _is_ad_url(url: str) -> bool:
    """DDG ad links route through duckduckgo.com/y.js before reaching the advertiser."""
    return "duckduckgo.com/y.js" in url or "ad_domain=" in url or "ad_provider=" in url


def _filter_ads(results: list) -> list:
    return [r for r in results if not _is_ad_url(r.get("url", ""))]


def _parse_results(html: str, max_results: int) -> list:
    parser = _DDGLiteParser(max_results + 5)  # fetch extra to account for filtered ads
    parser.feed(html)
    return _filter_ads(parser.results)[:max_results]


def _parse_html_results(html: str, max_results: int) -> list:
    parser = _DDGHtmlParser(max_results + 5)
    parser.feed(html)
    return _filter_ads(parser.results)[:max_results]


async def _duckduckgo_search(client: httpx.AsyncClient, query: str, max_results: int, region: str) -> list:
    # DuckDuckGo answers a request it takes for a bot with "202 Accepted" and a challenge
    # page, not an error, so anything but a 200 with results moves on to the next endpoint.
    error: Optional[Exception] = None
    for url, parse in ((_DDG_LITE_URL, _parse_results), (_DDG_HTML_URL, _parse_html_results)):
        try:
            resp = await client.post(url, data={"q": query, "kl": region})
            resp.raise_for_status()
            if resp.status_code != 200:
                logger.warning("web_search_blocked url=%s status=%s", url, resp.status_code)
                continue
            results = parse(resp.text, max_results)
            if results:
                return results
        except Exception as e:
            error = e
            logger.warning("web_search_failed url=%s error=%s", url, e)
    if error is not None:
        raise error
    return []


async def _tavily_search(client: httpx.AsyncClient, query: str, max_results: int, region: str = "") -> list:
    resp = await client.post(
        _TAVILY_URL,
        # raw_content: Tavily's own copy of each page, so the excerpts don't depend on fetching
        # the pages from this server, which many sites block from datacenter IPs
        json={"query": query, "max_results": max_results, "search_depth": "basic", "include_raw_content": "markdown"},
        headers={"Accept": "application/json", "Authorization": f"Bearer {TAVILY_API_KEY}"},
    )
    resp.raise_for_status()
    return [
        {
            "title": r.get("title", ""),
            "url": r.get("url", ""),
            "snippet": r.get("content", ""),
            # Read and removed by add_excerpts
            "raw_content": r.get("raw_content") or "",
        }
        for r in (resp.json().get("results") or [])[:max_results]
        if r.get("url")
    ]


def _parse_search_args(arguments: dict) -> tuple[str, int, str, str]:
    query = arguments.get("query", "").strip()
    region = arguments.get("_region", "us-en")
    try:
        max_results = min(max(int(arguments.get("max_results") or 8), 1), 10)
    except (TypeError, ValueError):
        max_results = 8
    cache_key = f"{query.lower()}:{max_results}:{region}"
    return query, max_results, region, cache_key


def _build_output(query: str, results: Optional[list]) -> str:
    return json.dumps(
        {"query": query, "results": results}
        if results
        else {"query": query, "results": [], "note": "No results found"}
    )


# Openings of a request or a question put to Olly, as opposed to a line quoted from somewhere
_REQUEST_START = re.compile(
    r"^\s*(please|pls|can|could|would|will|should|do|does|did|is|are|am|was|were|how|why|when|where|which|who|"
    r"write|make|create|build|generate|draft|compose|help|explain|describe|tell|give|show|list|fix|debug|"
    r"translate|summarize|summarise|rewrite|edit|improve|check|find|compare|plan|suggest|recommend|"
    r"calculate|convert|solve|teach|define|i need|i want|i'?d like|i have|i'?m trying|let'?s|hey|hi|hello|ok|okay|thanks)\b",
    re.IGNORECASE,
)
# Code, not prose: a fence, a line ending in a brace or semicolon, a line opening with a
# keyword, an operator, or a tag. Words like "return" or "function" alone are ordinary English.
_CODE_HINT = re.compile(
    r"```|[{};]\s*$|^\s*(def|class|import|from|function|const|let|var|return)\s|\w\s*(==|=>|!=|\+=|:=)\s*\w|</?[a-z]+[^>]*>",
    re.MULTILINE,
)
# Sentence punctuation per word below this reads as text typed from memory, not composed prose
_REFERENCE_MAX_PUNCT_RATIO = 0.08


def worth_searching(text: str, min_words: int = 8) -> bool:
    """Long enough to be about something a search could find, and not code."""
    return len(text.split()) >= min_words and not _CODE_HINT.search(text)


def looks_like_reference(text: str) -> bool:
    """A message that reads like a quote, lyric or line from something, rather than a request:
    long, no question mark, no request opening, no code, and barely punctuated. Small models
    answer these from memory with confident inventions, so they are searched before answering."""
    # Ten words or more, so short chat ("cool beans man") never searches
    if not worth_searching(text, min_words=10) or "?" in text or "\n\n" in text:
        return False
    if _REQUEST_START.search(text):
        return False
    punct = len(re.findall(r"[.,;:!]", text))
    return punct / len(text.split()) < _REFERENCE_MAX_PUNCT_RATIO


def should_activate(text: str, words: set) -> bool:
    if words & KEYWORDS:
        return True
    return bool(_SEARCH_TRIGGERS.search(text))


async def async_execute(arguments: dict) -> str:
    query, max_results, region, cache_key = _parse_search_args(arguments)
    if not query:
        return json.dumps({"error": "No query provided"})
    cached = _cache.get(cache_key)
    if cached is not MISSING:
        return cached
    client = _get_async_client()
    results = None
    error: Optional[Exception] = None
    # Tavily falls back to DuckDuckGo (out of credits, say); DuckDuckGo alone never spends Tavily credits
    providers = [_tavily_search, _duckduckgo_search] if SEARCH_PROVIDER == "tavily" and TAVILY_API_KEY else [_duckduckgo_search]
    for search in providers:
        try:
            results = await search(client, query, max_results, region)
            error = None
            if results:
                break
        except Exception as e:
            error = e
            logger.warning("web_search_failed provider=%s error=%s", search.__name__, e)
    if not results and error is not None:
        return json.dumps({"error": str(error)})
    if results:
        # Snippets alone leave a small model guessing: add passages from the top pages
        results = await add_excerpts(results, query)
    out = _build_output(query, results)
    if results:
        _cache.set(cache_key, out)
    return out
