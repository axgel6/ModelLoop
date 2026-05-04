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
    "current", "today", "recent", "price", "score", "weather", "stock", "headline",
    # Entertainment & music
    "song", "album", "artist", "track", "release", "unreleased", "cancelled",
    "movie", "film", "actor", "celebrity", "concert", "festival",
    # Events & announcements
    "event", "announcement", "conference", "keynote",
    # Learning & how-to
    "tutorial", "guide", "how to", "instructions",
    # Software & updates
    "update", "version", "bug", "error", "issue", "fix",
    # Reviews & opinions
    "review", "rating", "rank", "best",
    # Travel & lifestyle
    "travel", "hotel", "flight", "restaurant", "recipe",
    # Sports
    "sports", "game", "match", "tournament", "team", "player",
    # Business & tech
    "company", "startup", "business", "ipo", "funding",
    # Other
    "book", "author", "politics", "election", "pandemic", "covid",
}

_SEARCH_TRIGGERS = re.compile(
    r"\b("
    # Basic search actions
    r"search|look up|find|lookup|google|"
    # Question words
    r"what('s| is| are| was| were)|"
    r"who (is|are|won|made|created)|"
    r"when (did|is|was|does)|"
    r"where (is|are|can i find)|"
    r"why (did|didn't|don't|doesn't|isn't|can't|couldn't|wasn't)|"
    r"how (much|many|to|does|do)?|"
    # News & current events
    r"news (about|on)|latest|any (news|info|updates)|"
    # Pricing & reviews
    r"price (of)?|cost (of)?|"
    r"(best|top|worst) ([\w\s]+)?|"
    r"review (of|about)?|ratings?|"
    # Learning & how-to
    r"tutorial (on|for)|guide (to|on)|how to|instructions|"
    # Factual checks
    r"is (it|this|that|he|she) (real|true|legit|safe|possible)?|"
    r"what (happened|is happening) (with|to)?|"
    # Entertainment
    r"movie|film|book|album|song|track|actor|artist|celebrity|concert|festival|"
    # Travel & lifestyle
    r"hotel|flight|restaurant|cafe|travel|trip|vacation|"
    # Business & tech
    r"company|startup|business|ipo|funding|"
    # Sports
    r"team|player|sport|game|match|tournament|"
    # Software & tech issues
    r"bug|error|issue|fix|update|version|"
    # Politics & events
    r"politics|election|pandemic|covid"
    r")\b",
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
