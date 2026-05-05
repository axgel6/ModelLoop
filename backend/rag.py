import httpx
import logging
import numpy as np
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from models import Document, DocumentChunk
from config import OLLAMA_BASE_URL, EMBED_MODEL, NGROK_HEADERS, CHUNK_SIZE, CHUNK_OVERLAP, RAG_TOP_K

logger = logging.getLogger(__name__)


def chunk_text(text: str) -> list[str]:
    chunks, start = [], 0
    while start < len(text):
        end = min(start + CHUNK_SIZE, len(text))
        chunk = text[start:end].strip()
        if chunk:
            chunks.append(chunk)
        start += CHUNK_SIZE - CHUNK_OVERLAP
    return chunks


async def get_embedding(text: str) -> list[float]:
    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(
            f"{OLLAMA_BASE_URL}/api/embeddings",
            json={"model": EMBED_MODEL, "prompt": text},
            headers=NGROK_HEADERS,
        )
        resp.raise_for_status()
        return resp.json()["embedding"]


def cosine_similarity(a: list[float], b: list[float]) -> float:
    va, vb = np.array(a, dtype=np.float32), np.array(b, dtype=np.float32)
    denom = float(np.linalg.norm(va) * np.linalg.norm(vb))
    return float(np.dot(va, vb) / denom) if denom > 0 else 0.0


async def retrieve_rag_context(chat_id: str, user_id: str, query: str, db: AsyncSession) -> str:
    result = await db.execute(
        select(DocumentChunk)
        .join(Document, DocumentChunk.document_id == Document.id)
        .where(Document.chat_id == chat_id, Document.user_id == user_id)
    )
    chunks = result.scalars().all()
    if not chunks:
        return ""

    try:
        query_embedding = await get_embedding(query)
    except Exception as e:
        logger.warning("rag_embed_failed error=%s", str(e))
        return ""

    scored = sorted(chunks, key=lambda c: cosine_similarity(query_embedding, c.embedding), reverse=True)[:RAG_TOP_K]
    parts = [f"[Chunk {c.chunk_index + 1}]\n{c.content}" for c in scored]
    return "\n\n---\n\n".join(parts)
