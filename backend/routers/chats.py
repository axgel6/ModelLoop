from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import Chat
from schemas import RenameChatRequest
from dependencies import get_active_user_id

router = APIRouter(prefix="/api/v1/chats", tags=["chats"])


@router.post("", status_code=201)
async def create_chat(
    user_id: str = Depends(get_active_user_id),
    db: AsyncSession = Depends(get_db),
):
    chat = Chat(user_id=user_id)
    db.add(chat)
    await db.commit()
    await db.refresh(chat)
    return {"id": str(chat.id), "title": chat.title, "created_at": chat.created_at}


@router.get("")
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
            {
                "id":         str(c.id),
                "title":      c.title,
                "created_at": c.created_at,
                "updated_at": c.updated_at,
            }
            for c in chats
        ]
    }


@router.patch("/{chat_id}")
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


@router.delete("/{chat_id}", status_code=204)
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
