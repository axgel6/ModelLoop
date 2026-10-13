"""Validation for user-supplied Ollama URLs.

The backend fetches whatever address a user saves, so an unchecked value here is a
server-side request forgery hole: a user could point us at cloud metadata endpoints
(169.254.169.254), at services bound to the server's own loopback, or anywhere else
inside the private network, and read the response back through the chat.

Every hostname is resolved and every address it resolves to is checked, so a public
name that resolves to 127.0.0.1 or 10.x is rejected too. Validation runs again right
before the URL is used, which closes most of the DNS-rebinding window.
"""
import asyncio
import ipaddress
import socket
from urllib.parse import urlparse, urlunparse

from config import ALLOW_PRIVATE_OLLAMA_URLS

MAX_URL_LENGTH = 300


class UnsafeOllamaUrl(ValueError):
    """Raised when a URL is malformed or points somewhere the server must not fetch."""


def _address_is_forbidden(ip: ipaddress._BaseAddress) -> bool:
    return (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local      # includes 169.254.169.254, the cloud metadata address
        or ip.is_reserved
        or ip.is_multicast
        or ip.is_unspecified
    )


def _resolve(hostname: str, port: int) -> list[str]:
    try:
        infos = socket.getaddrinfo(hostname, port, proto=socket.IPPROTO_TCP)
    except socket.gaierror as exc:
        raise UnsafeOllamaUrl(f"Could not resolve host '{hostname}'") from exc
    return sorted({info[4][0] for info in infos})


def validate_ollama_url(raw: str) -> str:
    """Return the normalized base URL, or raise UnsafeOllamaUrl.

    Normalizing strips any path, query, and trailing slash so callers can append
    '/api/chat' without producing a double slash or inheriting a path prefix.
    """
    if not raw or not raw.strip():
        raise UnsafeOllamaUrl("URL is empty")
    raw = raw.strip()
    if len(raw) > MAX_URL_LENGTH:
        raise UnsafeOllamaUrl("URL is too long")

    parsed = urlparse(raw)
    if parsed.scheme not in {"http", "https"}:
        raise UnsafeOllamaUrl("URL must start with http:// or https://")
    if parsed.username or parsed.password:
        raise UnsafeOllamaUrl("Credentials in the URL are not allowed")
    if not parsed.hostname:
        raise UnsafeOllamaUrl("URL is missing a host")

    try:
        port = parsed.port
    except ValueError as exc:
        raise UnsafeOllamaUrl("URL has an invalid port") from exc

    if ALLOW_PRIVATE_OLLAMA_URLS:
        return urlunparse((parsed.scheme, parsed.netloc, "", "", "", "")).rstrip("/")

    hostname = parsed.hostname
    # A literal IP needs no lookup; anything else is resolved and every answer checked.
    try:
        addresses = [str(ipaddress.ip_address(hostname))]
    except ValueError:
        addresses = _resolve(hostname, port or (443 if parsed.scheme == "https" else 80))

    for addr in addresses:
        try:
            ip = ipaddress.ip_address(addr)
        except ValueError:
            raise UnsafeOllamaUrl(f"Host resolved to an unusable address: {addr}")
        if _address_is_forbidden(ip):
            raise UnsafeOllamaUrl(
                "That address is on a private or reserved network, which this server "
                "will not connect to. Expose Ollama on a public address (for example "
                "with ngrok or Tailscale Funnel) and use that URL."
            )

    return urlunparse((parsed.scheme, parsed.netloc, "", "", "", "")).rstrip("/")


async def validate_ollama_url_async(raw: str) -> str:
    """validate_ollama_url off the event loop.

    The hostname lookup is a blocking getaddrinfo with no timeout of its own, and it
    sits on the request path of every message from a user with a custom endpoint.
    """
    return await asyncio.to_thread(validate_ollama_url, raw)
