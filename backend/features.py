"""Feature gating driven entirely by environment variables.

Replaces the former database-backed feature_flags table and its admin UI.
Flags are read once at import time; change a value in .env and restart.
"""
from config import (
    ENABLE_ACTIONS, ENABLE_PHOTO_UPLOAD, ENABLE_RAG, ENABLE_QUICK_MODELS,
    GUEST_ENABLE_ACTIONS, GUEST_ENABLE_PHOTO_UPLOAD,
)

# Feature names are unchanged from the old flag table so the frontend
# (which reads features.actions / features.photo_upload / features.rag) still works.
_AUTHENTICATED = {
    "actions":      ENABLE_ACTIONS,
    "photo_upload": ENABLE_PHOTO_UPLOAD,
    "rag":          ENABLE_RAG,
    "quick_models": ENABLE_QUICK_MODELS,
}

# Guests have no chat records, so RAG (which is scoped to a stored chat) is never available.
_GUEST = {
    "actions":      GUEST_ENABLE_ACTIONS,
    "photo_upload": GUEST_ENABLE_PHOTO_UPLOAD,
    "rag":          False,
    "quick_models": ENABLE_QUICK_MODELS,
}


def get_features(guest: bool = False) -> dict[str, bool]:
    """Return the full feature map for a guest or an authenticated user."""
    return dict(_GUEST if guest else _AUTHENTICATED)


def is_feature_enabled(name: str, guest: bool = False) -> bool:
    return get_features(guest).get(name, False)
