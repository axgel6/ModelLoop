import asyncio
import time
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from models import FeatureFlag

# Flags seeded on startup; ON CONFLICT DO NOTHING makes this idempotent
DEFAULT_FLAGS = [
    {
        "name": "actions",
        "description": "Tool-calling actions (web search, get_time, etc.)",
        "guest_enabled": False,
        "free_enabled": False,
        "pro_enabled": True,
        "admin_enabled": True,
    },
    {
        "name": "photo_upload",
        "description": "Attach images to messages (analyzed by vision model)",
        "guest_enabled": False,
        "free_enabled": True,
        "pro_enabled": True,
        "admin_enabled": True,
    },
    {
        "name": "rag",
        "description": "Upload documents and use retrieval-augmented generation",
        "guest_enabled": False,
        "free_enabled": False,
        "pro_enabled": True,
        "admin_enabled": True,
    },
]

# ---------------------------------------------------------------------------
# In-process TTL cache for feature flags.
#
# Stores: { role -> { flag_name -> bool } }, refreshed at most once per TTL.
# A lock prevents cache-stampede: only one coroutine reloads at a time;
# others wait and then read the freshly-populated value.
# ---------------------------------------------------------------------------
_FLAG_CACHE: dict[str, dict[str, bool]] = {}  # role -> {name: bool}
_FLAG_CACHE_TS: float = 0.0
_FLAG_CACHE_TTL = 60.0   # seconds; flags change rarely, 1 min is plenty
_flag_cache_lock = asyncio.Lock()


async def _reload_flag_cache(db: AsyncSession) -> None:
    """Fetch all flags from DB and repopulate the in-process cache."""
    global _FLAG_CACHE, _FLAG_CACHE_TS
    result = await db.execute(select(FeatureFlag))
    flags = list(result.scalars().all())
    new_cache: dict[str, dict[str, bool]] = {}
    for role in ("guest", "free", "pro", "admin"):
        new_cache[role] = {
            f.name: bool(getattr(f, f"{role}_enabled", False)) for f in flags
        }
    _FLAG_CACHE = new_cache
    _FLAG_CACHE_TS = time.monotonic()


async def _get_flag_cache(db: AsyncSession) -> dict[str, dict[str, bool]]:
    """Return the cached flag map, refreshing from DB when the TTL has expired."""
    if time.monotonic() - _FLAG_CACHE_TS < _FLAG_CACHE_TTL:
        return _FLAG_CACHE  # fast path; no lock needed for reads
    async with _flag_cache_lock:
        # Double-check: another waiter may have already refreshed while we held the lock
        if time.monotonic() - _FLAG_CACHE_TS < _FLAG_CACHE_TTL:
            return _FLAG_CACHE
        await _reload_flag_cache(db)
    return _FLAG_CACHE


def bust_flag_cache() -> None:
    """Force the next call to _get_flag_cache() to reload from DB.
    Call this after any admin write to the feature_flags table."""
    global _FLAG_CACHE_TS
    _FLAG_CACHE_TS = 0.0


# ---------------------------------------------------------------------------
# Public API (same signatures as before; callers need no changes)
# ---------------------------------------------------------------------------

async def is_feature_enabled(name: str, role: str, db: AsyncSession) -> bool:
    features = await get_features_for_role([name], role, db)
    return features.get(name, False)


async def get_features_for_role(names: list[str], role: str, db: AsyncSession) -> dict[str, bool]:
    """Fetch multiple feature flags efficiently. Returns name→bool for each requested name."""
    cache = await _get_flag_cache(db)
    role_flags = cache.get(role, {})
    return {name: role_flags.get(name, False) for name in names}


async def get_all_flags(db: AsyncSession) -> list[FeatureFlag]:
    result = await db.execute(select(FeatureFlag).order_by(FeatureFlag.name))
    return list(result.scalars().all())
