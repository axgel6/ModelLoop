import httpx
import logging
from typing import Optional

import numpy as np
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from models import Document, DocumentChunk
from config import OLLAMA_BASE_URL, EMBED_MODEL, NGROK_HEADERS, CHUNK_SIZE, CHUNK_OVERLAP, RAG_TOP_K

logger = logging.getLogger(__name__)

# Persistent client: reuses TCP connections to Ollama across embedding calls.
# Creating a fresh AsyncClient per call (as done previously) paid TCP handshake
# and TLS setup costs on every request; this eliminates that overhead.
_embed_http = httpx.AsyncClient(
    timeout=60,
    limits=httpx.Limits(max_connections=5, max_keepalive_connections=3),
)


async def close_embed_client() -> None:
    """Gracefully close the shared embedding HTTP client on server shutdown."""
    await _embed_http.aclose()


def chunk_text(text: str) -> list[str]:
    chunks, start = [], 0
    while start < len(text):
        end = min(start + CHUNK_SIZE, len(text))
        chunk = text[start:end].strip()
        if chunk:
            chunks.append(chunk)
        start += CHUNK_SIZE - CHUNK_OVERLAP
    return chunks


async def get_embedding(text: str, base_url: Optional[str] = None) -> list[float]:
    resp = await _embed_http.post(
        f"{base_url or OLLAMA_BASE_URL}/api/embeddings",
        json={"model": EMBED_MODEL, "prompt": text},
        headers=NGROK_HEADERS,
    )
    resp.raise_for_status()
    return resp.json()["embedding"]


def rank_by_similarity(query: list[float], chunks: list, k: int) -> list:
    """Return the k chunks whose embeddings are closest to the query.

    Chunks whose embedding width differs from the query are dropped: a chat can hold
    vectors from a different embedding model, and those are not comparable. Stacking
    them would raise on the ragged array instead of degrading.
    """
    q = np.asarray(query, dtype=np.float32)
    usable = [c for c in chunks if len(c.embedding) == q.shape[0]]
    if len(usable) != len(chunks):
        logger.warning(
            "rag_dimension_mismatch skipped=%d expected_dim=%d",
            len(chunks) - len(usable), q.shape[0],
        )
    if not usable:
        return []

    matrix = np.asarray([c.embedding for c in usable], dtype=np.float32)  # (n, d)
    norms = np.linalg.norm(matrix, axis=1) * float(np.linalg.norm(q))
    # Zero-norm rows score 0; a nan here would sort unpredictably.
    scores = np.divide(matrix @ q, norms, out=np.zeros(len(usable), dtype=np.float32), where=norms > 0)

    top = np.argsort(scores)[::-1][:k]
    return [usable[i] for i in top]


async def retrieve_rag_context(chat_id: str, user_id: str, query: str, db: AsyncSession, base_url: Optional[str] = None) -> str:
    result = await db.execute(
        select(DocumentChunk)
        .join(Document, DocumentChunk.document_id == Document.id)
        .where(Document.chat_id == chat_id, Document.user_id == user_id)
    )
    chunks = result.scalars().all()
    if not chunks:
        return ""

    try:
        query_embedding = await get_embedding(query, base_url)
    except Exception as e:
        logger.warning("rag_embed_failed error=%s", str(e))
        return ""

    scored = rank_by_similarity(query_embedding, list(chunks), RAG_TOP_K)
    parts = [f"[Chunk {c.chunk_index + 1}]\n{c.content}" for c in scored]
    return "\n\n---\n\n".join(parts)
