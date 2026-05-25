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


async def is_feature_enabled(name: str, role: str, db: AsyncSession) -> bool:
    result = await db.execute(select(FeatureFlag).where(FeatureFlag.name == name))
    flag = result.scalar_one_or_none()
    if not flag:
        return False
    return bool(getattr(flag, f"{role}_enabled", False))


async def get_features_for_role(names: list[str], role: str, db: AsyncSession) -> dict[str, bool]:
    """Fetch multiple feature flags in one query. Returns name→bool for each requested name."""
    result = await db.execute(select(FeatureFlag).where(FeatureFlag.name.in_(names)))
    flags = {f.name: bool(getattr(f, f"{role}_enabled", False)) for f in result.scalars().all()}
    return {name: flags.get(name, False) for name in names}


async def get_all_flags(db: AsyncSession) -> list[FeatureFlag]:
    result = await db.execute(select(FeatureFlag).order_by(FeatureFlag.name))
    return list(result.scalars().all())
