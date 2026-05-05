import logging
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, func as sqlfunc
from sqlalchemy.ext.asyncio import AsyncSession
from database import get_db
from models import User, Chat, Message
from auth import get_current_user_id

logger = logging.getLogger(__name__)
router = APIRouter()

VALID_ROLES = {"free", "pro", "admin"}


class SetRoleRequest(BaseModel):
    role: str


async def require_admin(user_id: str = Depends(get_current_user_id), db: AsyncSession = Depends(get_db)) -> str:
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user or user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user_id


@router.get("/api/v1/admin/users")
async def admin_list_users(
    _: str = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    chat_counts = (
        select(Chat.user_id, sqlfunc.count(Chat.id).label("chat_count"))
        .group_by(Chat.user_id)
        .subquery()
    )
    msg_counts = (
        select(Chat.user_id, sqlfunc.count(Message.id).label("msg_count"))
        .join(Message, Message.chat_id == Chat.id)
        .group_by(Chat.user_id)
        .subquery()
    )
    rows = await db.execute(
        select(
            User,
            sqlfunc.coalesce(chat_counts.c.chat_count, 0).label("chats"),
            sqlfunc.coalesce(msg_counts.c.msg_count, 0).label("messages"),
        )
        .outerjoin(chat_counts, chat_counts.c.user_id == User.id)
        .outerjoin(msg_counts, msg_counts.c.user_id == User.id)
        .order_by(User.created_at)
    )
    return [
        {
            "id": str(u.id), "email": u.email, "role": u.role,
            "is_active": u.is_active,
            "created_at": u.created_at.isoformat(),
            "chats": chats, "messages": messages,
        }
        for u, chats, messages in rows
    ]


@router.delete("/api/v1/admin/users/{target_id}", status_code=204)
async def admin_delete_user(
    target_id: str,
    admin_id: str = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    if target_id == admin_id:
        raise HTTPException(status_code=400, detail="Cannot delete your own account via admin panel")
    result = await db.execute(select(User).where(User.id == target_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    await db.delete(user)
    await db.commit()
    logger.info('admin_delete_user admin_id=%s target_id=%s', admin_id, target_id)


@router.patch("/api/v1/admin/users/{target_id}/role")
async def admin_set_role(
    target_id: str,
    body: SetRoleRequest,
    admin_id: str = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    if body.role not in VALID_ROLES:
        raise HTTPException(status_code=400, detail=f"Invalid role. Must be one of: {', '.join(VALID_ROLES)}")
    result = await db.execute(select(User).where(User.id == target_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if target_id == admin_id:
        raise HTTPException(status_code=400, detail="Cannot change your own role")
    user.role = body.role
    await db.commit()
    logger.info('admin_set_role admin_id=%s target_id=%s role=%s', admin_id, target_id, body.role)
    return {"id": str(user.id), "email": user.email, "role": user.role}


@router.patch("/api/v1/admin/users/{target_id}/access")
async def admin_toggle_access(
    target_id: str,
    admin_id: str = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    if target_id == admin_id:
        raise HTTPException(status_code=400, detail="Cannot disable your own access")
    result = await db.execute(select(User).where(User.id == target_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.is_active = not user.is_active
    await db.commit()
    logger.info('admin_toggle_access admin_id=%s target_id=%s is_active=%s', admin_id, target_id, user.is_active)
    return {"id": str(user.id), "is_active": user.is_active}
