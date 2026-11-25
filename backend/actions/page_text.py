"""Excerpts from the pages behind the top search results.

Search snippets are a sentence or two, often cut mid-thought. Told only those, a small
model fills the gaps with guesses: the right show but an invented episode, the right
song but made-up lyrics. So the top few pages are fetched and the passages that best
match the query are handed over with the results.

Best effort and bounded: a page that is slow, blocked, too big, or not HTML is skipped,
and the whole step gives up after FETCH_TIMEOUT seconds, leaving the snippets as they were.
"""
import asyncio
import logging
import re
from html.parser import HTMLParser
from typing import Optional
from urllib.parse import parse_qs, urljoin, urlparse

import httpx

from net_guard import is_public_host

from ._shared import BROWSER_USER_AGENT

logger = logging.getLogger(__name__)

# How many of the top results are read
PAGES = 2
# Characters of excerpt kept per page
EXCERPT_CHARS = 1500
FETCH_TIMEOUT = 5.0
MAX_PAGE_BYTES = 2_000_000
MAX_REDIRECTS = 3
# Pages are split into passages of about this many characters, then the best are kept
PASSAGE_CHARS = 400

_HEADERS = {
    "User-Agent": BROWSER_USER_AGENT,
    "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
    "Accept-Language": "en-US,en;q=0.9",
}

_STOPWORDS = {
    "the", "and", "for", "you", "your", "that", "this", "with", "what", "are", "was", "were", "can", "cant",
    "not", "but", "have", "has", "had", "from", "they", "them", "his", "her", "she", "him", "its", "our",
    "who", "how", "why", "when", "where", "which", "about", "into", "than", "then", "there", "their",
    "just", "all", "any", "out", "get", "got", "too", "very", "will", "would", "could", "should", "im",
    "quote", "lyrics", "song", "does", "did", "dont", "doesnt", "been", "being", "some",
}

_client: Optional[httpx.AsyncClient] = None


def _get_client() -> httpx.AsyncClient:
    global _client
    if _client is None or _client.is_closed:
        # Redirects are followed by hand so each hop is checked before it is fetched
        _client = httpx.AsyncClient(headers=_HEADERS, follow_redirects=False, timeout=FETCH_TIMEOUT)
    return _client


class _TextParser(HTMLParser):
    """The readable text of a page, one line per block, without scripts, menus or footers."""

    _SKIP = {"script", "style", "noscript", "svg", "nav", "header", "footer", "aside", "form", "button", "select", "template"}
    _BLOCK = {"p", "div", "li", "br", "tr", "td", "th", "h1", "h2", "h3", "h4", "h5", "h6",
              "blockquote", "dd", "dt", "pre", "section", "article", "table"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.lines: list[str] = []
        self._buf: list[str] = []
        self._skip_depth = 0

    def _flush(self) -> None:
        text = re.sub(r"\s+", " ", "".join(self._buf)).strip()
        if text:
            self.lines.append(text)
        self._buf = []

    def handle_starttag(self, tag: str, attrs: list) -> None:
        if tag in self._SKIP:
            self._skip_depth += 1
        elif tag in self._BLOCK:
            self._flush()

    def handle_endtag(self, tag: str) -> None:
        if tag in self._SKIP:
            self._skip_depth = max(0, self._skip_depth - 1)
        elif tag in self._BLOCK:
            self._flush()

    def handle_data(self, data: str) -> None:
        if not self._skip_depth:
            self._buf.append(data)

    def text_lines(self) -> list[str]:
        self._flush()
        return self.lines


def _terms(text: str) -> set[str]:
    words = re.findall(r"[a-z0-9]+", text.lower().replace("'", ""))
    return {w for w in words if len(w) > 2 and w not in _STOPWORDS}


def _passages(lines: list[str]) -> list[str]:
    """Consecutive lines joined into passages of about PASSAGE_CHARS, so a run of short
    lines (dialogue, lyrics, a table) stays together."""
    passages, cur = [], ""
    for line in lines:
        if cur and len(cur) + len(line) > PASSAGE_CHARS:
            passages.append(cur)
            cur = ""
        cur = f"{cur}\n{line}" if cur else line
    if cur:
        passages.append(cur)
    return passages


def _best_from_lines(lines: list[str], query: str, limit: int) -> str:
    """The passages that share the most words with the query, in page order."""
    passages = _passages(lines)
    wanted = _terms(query)
    if not passages or not wanted:
        return ""
    scored = sorted(
        ((len(wanted & _terms(p)), i) for i, p in enumerate(passages)),
        key=lambda s: (-s[0], s[1]),
    )
    chosen, used = [], 0
    for score, i in scored:
        if score == 0 or used >= limit:
            break
        chosen.append(i)
        used += len(passages[i])
    text = "\n...\n".join(passages[i] for i in sorted(chosen))
    return text[:limit].rstrip()


def best_excerpt(html: str, query: str, limit: int = EXCERPT_CHARS) -> str:
    """The passages of an HTML page that share the most words with the query, in page order."""
    parser = _TextParser()
    try:
        parser.feed(html)
    except Exception:
        return ""
    return _best_from_lines(parser.text_lines(), query, limit)


# Markdown that only gets in the way of reading: images, link targets, heading and list marks
_MD_IMAGE = re.compile(r"!\[[^\]]*\]\([^)]*\)")
_MD_LINK = re.compile(r"\[([^\]]*)\]\([^)]*\)")
_MD_LEAD = re.compile(r"^\s*(#{1,6}\s+|[-*+]\s+|>\s*)")


def best_text_excerpt(text: str, query: str, limit: int = EXCERPT_CHARS) -> str:
    """The same, from a page that is already text (a search API's copy, in markdown)."""
    lines = []
    for line in text[:MAX_PAGE_BYTES].splitlines():
        line = _MD_LINK.sub(r"\1", _MD_IMAGE.sub("", line))
        line = re.sub(r"\s+", " ", _MD_LEAD.sub("", line).replace("**", "").replace("__", "")).strip()
        if line:
            lines.append(line)
    return _best_from_lines(lines, query, limit)


async def _fetch_html(url: str) -> Optional[str]:
    client = _get_client()
    for _ in range(MAX_REDIRECTS + 1):
        parsed = urlparse(url)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname:
            return None
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
        if not await asyncio.to_thread(is_public_host, parsed.hostname, port):
            logger.warning("page_text_blocked host=%s", parsed.hostname)
            return None
        async with client.stream("GET", url) as resp:
            if resp.is_redirect:
                location = resp.headers.get("location")
                if not location:
                    return None
                url = urljoin(url, location)
                continue
            if resp.status_code != 200 or "html" not in resp.headers.get("content-type", ""):
                return None
            body = bytearray()
            async for chunk in resp.aiter_bytes():
                body.extend(chunk)
                if len(body) > MAX_PAGE_BYTES:
                    break
            return body.decode(resp.encoding or "utf-8", errors="replace")
    return None


def _real_url(url: str) -> str:
    """DuckDuckGo can wrap result links in its own redirect: //duckduckgo.com/l/?uddg=<url>."""
    if url.startswith("//"):
        url = "https:" + url
    parsed = urlparse(url)
    if parsed.hostname and parsed.hostname.endswith("duckduckgo.com") and parsed.path.startswith("/l/"):
        target = parse_qs(parsed.query).get("uddg")
        if target:
            return target[0]
    return url


async def _excerpt_for(result: dict, query: str) -> str:
    # The search API already read the page (Tavily's raw_content): use its copy. Many sites
    # refuse a server's own fetch from a datacenter IP, which is where the app runs in production.
    raw = result.get("raw_content")
    if isinstance(raw, str) and raw.strip():
        excerpt = best_text_excerpt(raw, query)
        if excerpt:
            return excerpt
    url = _real_url(result["url"])
    try:
        html = await _fetch_html(url)
    except Exception as e:
        logger.info("page_text_failed url=%s error=%r", url, e)
        return ""
    return best_excerpt(html, query) if html else ""


async def add_excerpts(results: list[dict], query: str) -> list[dict]:
    """`results` with an "excerpt" added to the top PAGES that could be read. Any whole-page
    copy a search API returned ("raw_content") is used here and then dropped, never passed on."""
    top = results[:PAGES]
    excerpts: list[str] = []
    try:
        excerpts = await asyncio.wait_for(
            asyncio.gather(*(_excerpt_for(r, query) for r in top)),
            timeout=FETCH_TIMEOUT + 1,
        )
    except asyncio.TimeoutError:
        logger.info("page_text_timeout query=%s", query[:80])
    out = []
    for i, r in enumerate(results):
        r = {k: v for k, v in r.items() if k != "raw_content"}
        excerpt = excerpts[i] if i < len(excerpts) else ""
        out.append({**r, "excerpt": excerpt} if excerpt else r)
    return out
