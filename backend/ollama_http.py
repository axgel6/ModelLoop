"""Shared HTTP client for short, non-streaming calls to Ollama.

Timeouts vary per caller, so they are passed at call time rather than set here.
Streaming and embeddings keep their own clients: different pool sizes, and
streaming runs with no read timeout at all.
"""
import httpx

_client = httpx.AsyncClient(
    limits=httpx.Limits(max_connections=10, max_keepalive_connections=5),
)


def client() -> httpx.AsyncClient:
    return _client


async def close_client() -> None:
    await _client.aclose()
