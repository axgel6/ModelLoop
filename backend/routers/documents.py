import asyncio
import io
import logging
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy import select, func as sqlfunc
from sqlalchemy.ext.asyncio import AsyncSession
from database import get_db
from models import Chat, Document, DocumentChunk
from config import MAX_UPLOAD_BYTES
from routers.auth import get_active_user_id
from services.rag import _chunk_text, _get_embedding

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post("/api/v1/chats/{chat_id}/documents", status_code=201)
async def upload_document(
    chat_id: str,
    file: UploadFile = File(...),
    user_id: str = Depends(get_active_user_id),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Chat).where(Chat.id == chat_id, Chat.user_id == user_id))
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Chat not found")

    content = await file.read()
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="File too large (max 10 MB)")

    filename = file.filename or "document"
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""

    if ext == "pdf":
        try:
            from pypdf import PdfReader
            reader = PdfReader(io.BytesIO(content))
            raw_text = "\n".join(page.extract_text() or "" for page in reader.pages)
        except Exception as e:
            logger.warning("pdf_parse_failed filename=%s error=%s", filename, str(e))
            raise HTTPException(status_code=422, detail="Could not parse PDF")
    elif ext in ("txt", "md"):
        raw_text = content.decode("utf-8", errors="ignore")
    else:
        raise HTTPException(status_code=415, detail="Unsupported file type — use PDF, TXT, or MD")

    raw_text = raw_text.strip()
    if not raw_text:
        raise HTTPException(status_code=422, detail="No text found in file")

    doc = Document(user_id=user_id, chat_id=chat_id, filename=filename)
    db.add(doc)
    await db.flush()

    chunks = _chunk_text(raw_text)
    try:
        embeddings = await asyncio.gather(*[_get_embedding(c) for c in chunks])
    except Exception as e:
        logger.error("embed_chunk_failed doc_id=%s error=%s", doc.id, str(e))
        raise HTTPException(status_code=502, detail="Embedding model unavailable — is nomic-embed-text pulled?")
    for i, (chunk_text_item, embedding) in enumerate(zip(chunks, embeddings)):
        db.add(DocumentChunk(document_id=doc.id, chat_id=chat_id, content=chunk_text_item, embedding=embedding, chunk_index=i))

    await db.commit()
    await db.refresh(doc)
    logger.info("document_uploaded doc_id=%s filename=%s chunks=%d", doc.id, filename, len(chunks))
    return {"id": str(doc.id), "filename": doc.filename, "chunk_count": len(chunks), "created_at": doc.created_at.isoformat()}


@router.get("/api/v1/chats/{chat_id}/documents")
async def list_documents(
    chat_id: str,
    user_id: str = Depends(get_active_user_id),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Chat).where(Chat.id == chat_id, Chat.user_id == user_id))
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Chat not found")

    docs_result = await db.execute(
        select(Document)
        .where(Document.chat_id == chat_id, Document.user_id == user_id)
        .order_by(Document.created_at.desc())
    )
    docs = docs_result.scalars().all()
    if not docs:
        return {"documents": []}

    counts_result = await db.execute(
        select(DocumentChunk.document_id, sqlfunc.count(DocumentChunk.id))
        .where(DocumentChunk.document_id.in_([d.id for d in docs]))
        .group_by(DocumentChunk.document_id)
    )
    chunk_counts = {str(doc_id): count for doc_id, count in counts_result.all()}

    return {"documents": [
        {"id": str(d.id), "filename": d.filename, "chunk_count": chunk_counts.get(str(d.id), 0), "created_at": d.created_at.isoformat()}
        for d in docs
    ]}


@router.delete("/api/v1/documents/{doc_id}", status_code=204)
async def delete_document(
    doc_id: str,
    user_id: str = Depends(get_active_user_id),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Document).where(Document.id == doc_id, Document.user_id == user_id))
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    await db.delete(doc)
    await db.commit()
