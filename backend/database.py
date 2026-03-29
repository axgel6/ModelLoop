from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
import os

# ----- Engine Setup -----

engine = create_async_engine(
    # Pulls the connection string (must start with postgresql+asyncpg://)
    os.environ["DATABASE_URL"],
    # Set to True only during local debugging to see raw SQL queries in the console
    echo=False,
    # The number of connections to keep open in the pool
    pool_size=10,
    # The number of additional connections to allow during high traffic bursts
    max_overflow=20,
    # Forces connections to refresh every 30 mins to prevent stale/dropped links
    pool_recycle=1800,
    # Verifies the connection is still alive before attempting a query
    pool_pre_ping=True,
    # Required for Supabase PgBouncer compatibility
    connect_args={
        # Disables client-side prepared statement caching.
        # This is mandatory for PgBouncer 'Transaction Mode' because 
        # statements aren't shared across different backend sessions.
        "statement_cache_size": 0,
        "prepared_statement_cache_size": 0
    },
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
