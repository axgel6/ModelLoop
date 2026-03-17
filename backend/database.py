from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
import os

# ----- Engine Setup -----

# statement_cache_size=0 is required for Supabase PgBouncer compatibility
engine = create_async_engine(
    os.environ["DATABASE_URL"],
    echo=False,
    connect_args={"statement_cache_size": 0},
)

# Session factory — expire_on_commit=False keeps objects usable after commit
AsyncSessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

# ----- Base + Session -----

# Shared declarative base for all ORM models
class Base(DeclarativeBase):
    pass


# Dependency that yields a per-request DB session
async def get_db():
    async with AsyncSessionLocal() as session:
        yield session
