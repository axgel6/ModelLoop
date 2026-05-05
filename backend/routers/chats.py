from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from database import get_db
from models import Chat, Message
from config import MAX_TITLE_LENGTH
from routers.auth import get_active_user_id

router = APIRouter()


class RenameChatRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=MAX_TITLE_LENGTH)


@router.post("/api/v1/chats", status_code=201)
async def create_chat(
    user_id: str = Depends(get_active_user_id),
    db: AsyncSession = Depends(get_db),
):
    chat = Chat(user_id=user_id)
    db.add(chat)
    await db.commit()
    await db.refresh(chat)
    return {"id": str(chat.id), "title": chat.title, "created_at": chat.created_at}


@router.get("/api/v1/chats")
async def list_chats(
    user_id: str = Depends(get_active_user_id),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Chat).where(Chat.user_id == user_id).order_by(Chat.updated_at.desc())
    )
    chats = result.scalars().all()
    return {
        "chats": [
            {"id": str(c.id), "title": c.title, "created_at": c.created_at, "updated_at": c.updated_at}
            for c in chats
        ]
    }


@router.patch("/api/v1/chats/{chat_id}")
async def rename_chat(
    chat_id: str,
    body: RenameChatRequest,
    user_id: str = Depends(get_active_user_id),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Chat).where(Chat.id == chat_id, Chat.user_id == user_id))
    chat = result.scalar_one_or_none()
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")
    chat.title = body.title
    await db.commit()
    return {"id": str(chat.id), "title": chat.title}


@router.delete("/api/v1/chats/{chat_id}", status_code=204)
async def delete_chat(
    chat_id: str,
    user_id: str = Depends(get_active_user_id),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Chat).where(Chat.id == chat_id, Chat.user_id == user_id))
    chat = result.scalar_one_or_none()
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")
    await db.delete(chat)
    await db.commit()


@router.get("/api/v1/chats/{chat_id}/messages")
async def get_messages(
    chat_id: str,
    user_id: str = Depends(get_active_user_id),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Chat).where(Chat.id == chat_id, Chat.user_id == user_id))
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Chat not found")
    msgs = await db.execute(
        select(Message).where(Message.chat_id == chat_id).order_by(Message.created_at)
    )
    return {"messages": [
        {
            "role": m.role,
            "content": m.content,
            "created_at": m.created_at.isoformat(),
            **({"images": m.images} if m.images else {}),
        }
        for m in msgs.scalars().all()
    ]}
