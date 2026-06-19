from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, and_, or_
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import Chat, Friendship, SharedChat, User
from schemas import RenameChatRequest, ShareChatRequest
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
    owned_result = await db.execute(
        select(Chat).where(Chat.user_id == user_id).order_by(Chat.updated_at.desc())
    )
    owned = owned_result.scalars().all()

    shared_result = await db.execute(
        select(SharedChat)
        .options(selectinload(SharedChat.chat), selectinload(SharedChat.from_user))
        .where(SharedChat.to_user_id == user_id)
        .order_by(SharedChat.shared_at.desc())
    )
    shared = shared_result.scalars().all()

    owned_list = [
        {
            "id":         str(c.id),
            "title":      c.title,
            "created_at": c.created_at,
            "updated_at": c.updated_at,
        }
        for c in owned
    ]
    shared_list = [
        {
            "id":          str(s.chat_id),
            "title":       s.chat.title,
            "created_at":  s.shared_at,
            "updated_at":  s.chat.updated_at,
            "is_shared":   True,
            "shared_from": s.from_user.username,
        }
        for s in shared
    ]

    return {"chats": owned_list + shared_list}


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


@router.post("/{chat_id}/share", status_code=201)
async def share_chat(
    chat_id: str,
    body: ShareChatRequest,
    user_id: str = Depends(get_active_user_id),
    db: AsyncSession = Depends(get_db),
):
    # Verify ownership
    chat_result = await db.execute(select(Chat).where(Chat.id == chat_id, Chat.user_id == user_id))
    if not chat_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Chat not found")

    # Resolve target user by username
    target_result = await db.execute(select(User).where(User.username == body.username))
    target = target_result.scalar_one_or_none()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if str(target.id) == user_id:
        raise HTTPException(status_code=400, detail="Cannot share a chat with yourself")

    # Require accepted friendship
    friendship_result = await db.execute(
        select(Friendship).where(
            Friendship.status == "accepted",
            or_(
                and_(Friendship.requester_id == user_id, Friendship.addressee_id == str(target.id)),
                and_(Friendship.requester_id == str(target.id), Friendship.addressee_id == user_id),
            ),
        )
    )
    if not friendship_result.scalar_one_or_none():
        raise HTTPException(status_code=403, detail="You can only share chats with friends")

    # Upsert: ignore if already shared with this user
    existing = await db.execute(
        select(SharedChat).where(SharedChat.chat_id == chat_id, SharedChat.to_user_id == str(target.id))
    )
    if existing.scalar_one_or_none():
        return {"shared": True, "note": "Already shared"}

    db.add(SharedChat(chat_id=chat_id, from_user_id=user_id, to_user_id=str(target.id)))
    await db.commit()
    return {"shared": True}
