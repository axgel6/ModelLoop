"""Shared rate limiter for every limited route."""
from fastapi import HTTPException, Request
from slowapi import Limiter
from slowapi.util import get_remote_address

from auth import decode_token


def caller_key(request: Request) -> str:
    """Key signed-in callers on user id, everyone else on peer address.

    Access tokens rotate, so keying on the token would hand the caller a fresh
    bucket on every refresh. Behind a proxy the peer address is the proxy, so
    anonymous callers share a bucket; X-Forwarded-For is caller-supplied and is
    deliberately not trusted here.
    """
    header = request.headers.get("authorization") or ""
    if header.lower().startswith("bearer "):
        try:
            return f"user:{decode_token(header[7:].strip())}"
        except HTTPException:
            pass  # unparseable token: limit by address instead
    return get_remote_address(request)


limiter = Limiter(key_func=caller_key)
