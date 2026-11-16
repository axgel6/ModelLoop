"""What the tools share: one HTTP client for the free JSON services, and a small expiring cache."""
import time
from typing import Any, Optional

import httpx

_client: Optional[httpx.AsyncClient] = None

# Sent when fetching web pages, which many sites refuse to serve to a bare HTTP client
BROWSER_USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)

# Stands in for a miss, so a cached None ("no such word") still counts as an answer
MISSING: Any = object()


def http_client() -> httpx.AsyncClient:
    """A client kept open across requests, so lookups reuse their connections."""
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(timeout=6)
    return _client


class TTLCache:
    """Values kept for ttl seconds, holding at most max_size of them."""

    def __init__(self, ttl: float, max_size: int = 200):
        self.ttl = ttl
        self.max_size = max_size
        self._items: dict[str, tuple[Any, float]] = {}

    def get(self, key: str) -> Any:
        """The value, or MISSING when it was never stored or has expired."""
        entry = self._items.get(key)
        if entry is None:
            return MISSING
        if time.monotonic() - entry[1] >= self.ttl:
            del self._items[key]
            return MISSING
        return entry[0]

    def set(self, key: str, value: Any) -> None:
        if len(self._items) >= self.max_size:
            cutoff = time.monotonic() - self.ttl
            for k in [k for k, (_, at) in self._items.items() if at < cutoff]:
                del self._items[k]
            # A burst of new keys inside one ttl expires nothing, so drop the oldest instead
            while len(self._items) >= self.max_size:
                del self._items[next(iter(self._items))]
        self._items[key] = (value, time.monotonic())
