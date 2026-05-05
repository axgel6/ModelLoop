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
        "guest_enabled": True,
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
    {
        "name": "guest_tools",
        "description": "Show the tools/settings button in the input toolbar for guest users",
        "guest_enabled": False,
        "free_enabled": False,
        "pro_enabled": False,
        "admin_enabled": False,
    },
    {
        "name": "guest_preferences",
        "description": "Show the preferences button in the topbar for guest users",
        "guest_enabled": False,
        "free_enabled": False,
        "pro_enabled": False,
        "admin_enabled": False,
    },
]


async def is_feature_enabled(name: str, role: str, db: AsyncSession) -> bool:
    """Return True if the named feature flag is enabled for the given role."""
    result = await db.execute(select(FeatureFlag).where(FeatureFlag.name == name))
    flag = result.scalar_one_or_none()
    if not flag:
        return False
    return bool(getattr(flag, f"{role}_enabled", False))


async def get_all_flags(db: AsyncSession) -> list[FeatureFlag]:
    result = await db.execute(select(FeatureFlag).order_by(FeatureFlag.name))
    return list(result.scalars().all())
