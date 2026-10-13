import os
import logging
from contextlib import asynccontextmanager
from pathlib import Path
from dotenv import load_dotenv
load_dotenv(Path(__file__).parent / ".env")

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi.errors import RateLimitExceeded
from sqlalchemy import text

from database import engine, Base
from config import ALLOWED_ORIGINS, IS_PRODUCTION
from routers import auth_router, chats, messages, documents, models_router, ollama_status, stream, health
from routers.stream import close_ollama_client
from rag import close_embed_client
from ollama_http import close_client as close_ollama_http
from rate_limit import limiter, caller_key

logging.basicConfig(
    level=logging.INFO,
    format='{"time": "%(asctime)s", "level": "%(levelname)s", "msg": "%(message)s"}',
)
logger = logging.getLogger(__name__)



@asynccontextmanager
async def lifespan(_: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

        # Schema migrations (idempotent; safe to run on every startup)
        migrations = [
            "ALTER TABLE messages ADD COLUMN IF NOT EXISTS images JSON",
            "ALTER TABLE messages ADD COLUMN IF NOT EXISTS image_context TEXT",
            "ALTER TABLE messages ADD COLUMN IF NOT EXISTS search_context TEXT",
            "ALTER TABLE documents ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE",
            "ALTER TABLE documents ADD COLUMN IF NOT EXISTS chat_id UUID REFERENCES chats(id) ON DELETE CASCADE",
            "ALTER TABLE documents ADD COLUMN IF NOT EXISTS filename TEXT",
            "CREATE INDEX IF NOT EXISTS ix_documents_user_id ON documents (user_id)",
            "CREATE INDEX IF NOT EXISTS ix_documents_chat_id ON documents (chat_id)",
            "ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS document_id UUID REFERENCES documents(id) ON DELETE CASCADE",
            "ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS content TEXT",
            # Drop embedding column if it exists as non-JSON (pgvector migration)
            """DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'document_chunks'
                      AND column_name = 'embedding'
                      AND data_type <> 'json'
                ) THEN
                    ALTER TABLE document_chunks DROP COLUMN embedding;
                END IF;
            END $$""",
            "ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS embedding JSON",
            "ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS chunk_index INTEGER",
            "CREATE INDEX IF NOT EXISTS ix_document_chunks_document_id ON document_chunks (document_id)",
            "ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS chat_id UUID REFERENCES chats(id) ON DELETE CASCADE",
            "CREATE INDEX IF NOT EXISTS ix_document_chunks_chat_id ON document_chunks (chat_id)",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS theme VARCHAR(20) NOT NULL DEFAULT 'meadow'",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS font VARCHAR(20) NOT NULL DEFAULT 'rounded'",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS personal_context TEXT",
            "ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS ollama_url VARCHAR(300)",
            "ALTER TABLE messages ADD COLUMN IF NOT EXISTS model VARCHAR(100)",
        ]
        for stmt in migrations:
            await conn.execute(text(stmt))

    yield

    await engine.dispose()
    await close_ollama_client()
    await close_embed_client()
    await close_ollama_http()


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.state.limiter = limiter


def _rate_limit_handler(request: Request, _exc: Exception):
    logger.warning('rate_limit_exceeded path=%s caller=%s', request.url.path, caller_key(request))
    return JSONResponse(status_code=429, content={"detail": "Rate limit exceeded"})


app.add_exception_handler(RateLimitExceeded, _rate_limit_handler)

# Register all route modules
app.include_router(auth_router.router)
app.include_router(chats.router)
app.include_router(messages.router)
app.include_router(documents.router)
app.include_router(models_router.router)
app.include_router(ollama_status.router)
app.include_router(stream.router)
app.include_router(health.router)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "server:app",
        host="0.0.0.0",
        port=int(os.environ.get("PORT", 8000)),
        reload=not IS_PRODUCTION,
    )
