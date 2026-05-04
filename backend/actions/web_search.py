import html as _html
import json
import re
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
                    "description": "Number of results to return (1–8, default 5)",
                },
            },
            "required": ["query"],
        },
    },
}

KEYWORDS = {
    "search", "look up", "lookup", "google", "find", "news", "latest",
    "current", "today", "recent", "price", "score", "weather", "who is",
    "what is", "when did", "where is", "how much", "stock", "headline",
}

_SEARCH_TRIGGERS = re.compile(
    r"\b(search|look up|find out|what('s| is) the (latest|current|news)|"
    r"tell me about|who (is|are|won)|when (did|is|was)|where (is|are)|"
    r"how much (is|does|did)|price of|score of|news (about|on))\b",
    re.IGNORECASE,
)

_HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; ModelLoop/1.0)",
    "Accept": "text/html,application/xhtml+xml",
    "Accept-Language": "en-US,en;q=0.9",
}

_LINK_RE = re.compile(r'<a[^>]+href="([^"]+)"[^>]+class=\'result-link\'[^>]*>([^<]+)</a>')
_SNIPPET_RE = re.compile(r"<td class='result-snippet'>(.*?)</td>", re.DOTALL)
_TAG_RE = re.compile(r"<[^>]+>")


def _strip_tags(text: str) -> str:
    return _html.unescape(re.sub(r"\s+", " ", _TAG_RE.sub("", text)).strip())


def should_activate(text: str, words: set) -> bool:
    if words & KEYWORDS:
        return True
    return bool(_SEARCH_TRIGGERS.search(text))


def _parse_results(html: str, max_results: int) -> list:
    links = _LINK_RE.findall(html)
    snippets = _SNIPPET_RE.findall(html)
    return [
        {"title": _strip_tags(title), "url": url, "snippet": _strip_tags(snippet)}
        for (url, title), snippet in zip(links[:max_results], snippets[:max_results])
    ]


async def async_execute(arguments: dict) -> str:
    query = arguments.get("query", "").strip()
    max_results = min(max(int(arguments.get("max_results", 5)), 1), 8)
    if not query:
        return json.dumps({"error": "No query provided"})
    try:
        async with httpx.AsyncClient(headers=_HEADERS, follow_redirects=True, timeout=10) as client:
            resp = await client.post("https://lite.duckduckgo.com/lite/", data={"q": query})
            resp.raise_for_status()
        results = _parse_results(resp.text, max_results)
        if not results:
            return json.dumps({"query": query, "results": [], "note": "No results found"})
        return json.dumps({"query": query, "results": results})
    except Exception as e:
        return json.dumps({"error": str(e)})


def execute(arguments: dict) -> str:
    with httpx.Client(headers=_HEADERS, follow_redirects=True, timeout=10) as client:
        query = arguments.get("query", "").strip()
        max_results = min(max(int(arguments.get("max_results", 5)), 1), 8)
        if not query:
            return json.dumps({"error": "No query provided"})
        try:
            resp = client.post("https://lite.duckduckgo.com/lite/", data={"q": query})
            resp.raise_for_status()
            results = _parse_results(resp.text, max_results)
            if not results:
                return json.dumps({"query": query, "results": [], "note": "No results found"})
            return json.dumps({"query": query, "results": results})
        except Exception as e:
            return json.dumps({"error": str(e)})
