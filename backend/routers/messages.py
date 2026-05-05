from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import Chat, Message
from dependencies import get_active_user_id

router = APIRouter(prefix="/api/v1/chats", tags=["messages"])


@router.get("/{chat_id}/messages")
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
            "role":       m.role,
            "content":    m.content,
            "created_at": m.created_at.isoformat(),
            **({"images": m.images} if m.images else {}),
        }
        for m in msgs.scalars().all()
    ]}
