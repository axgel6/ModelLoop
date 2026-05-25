import logging
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy import func as sqlfunc
from sqlalchemy.ext.asyncio import AsyncSession

import config as _config
from database import get_db
from models import User, Chat, Message, Document, AuditLog, FeatureFlag
from schemas import SetRoleRequest, UpdateFeatureFlagRequest, UpdateServerConfigRequest
from dependencies import require_admin, _get_client_ip
from audit import log_audit
from config import VALID_ROLES
from feature_flags import get_all_flags

_ENV_PATH = Path(__file__).parent.parent / ".env"


def _write_env_key(key: str, value: str) -> None:
    text = _ENV_PATH.read_text() if _ENV_PATH.exists() else ""
    pattern = re.compile(rf'^{re.escape(key)}\s*=.*$', re.MULTILINE)
    quoted = f'{key}="{value}"'
    if pattern.search(text):
        text = pattern.sub(quoted, text)
    else:
        text = text.rstrip("\n") + f"\n{quoted}\n"
    _ENV_PATH.write_text(text)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/admin", tags=["admin"])


@router.get("/users")
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
            "id":         str(u.id),
            "email":      u.email,
            "role":       u.role,
            "is_active":  u.is_active,
            "created_at": u.created_at.isoformat(),
            "chats":      chats,
            "messages":   messages,
        }
        for u, chats, messages in rows
    ]


@router.delete("/users/{target_id}", status_code=204)
async def admin_delete_user(
    target_id: str,
    request: Request,
    admin_id: str = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    if target_id == admin_id:
        raise HTTPException(status_code=400, detail="Cannot delete your own account via admin panel")
    result = await db.execute(select(User).where(User.id == target_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    await log_audit(db, "delete_user", admin_id, target_id, {"email": user.email}, _get_client_ip(request))
    await db.delete(user)
    await db.commit()
    logger.info('admin_delete_user admin_id=%s target_id=%s', admin_id, target_id)


@router.patch("/users/{target_id}/role")
async def admin_set_role(
    target_id: str,
    body: SetRoleRequest,
    request: Request,
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
    old_role = user.role
    user.role = body.role
    await log_audit(db, "set_role", admin_id, target_id, {"old_role": old_role, "new_role": body.role}, _get_client_ip(request))
    await db.commit()
    logger.info('admin_set_role admin_id=%s target_id=%s role=%s', admin_id, target_id, body.role)
    return {"id": str(user.id), "email": user.email, "role": user.role}


@router.patch("/users/{target_id}/access")
async def admin_toggle_access(
    target_id: str,
    request: Request,
    admin_id: str = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    if target_id == admin_id:
        raise HTTPException(status_code=400, detail="Cannot disable your own access")
    result = await db.execute(select(User).where(User.id == target_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    old_status = user.is_active
    user.is_active = not user.is_active
    await log_audit(db, "toggle_access", admin_id, target_id, {"was_active": old_status, "is_active": user.is_active}, _get_client_ip(request))
    await db.commit()
    logger.info('admin_toggle_access admin_id=%s target_id=%s is_active=%s', admin_id, target_id, user.is_active)
    return {"id": str(user.id), "is_active": user.is_active}


@router.get("/audit-logs")
async def admin_get_audit_logs(
    _: str = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
    limit: int = 100,
    offset: int = 0,
    action: Optional[str] = None,
    admin_id: Optional[str] = None,
):
    query = select(AuditLog)
    if action:
        query = query.where(AuditLog.action == action)
    if admin_id:
        query = query.where(AuditLog.admin_id == admin_id)

    result = await db.execute(
        query.order_by(AuditLog.created_at.desc()).limit(limit).offset(offset)
    )
    logs = result.scalars().all()

    count_result = await db.execute(select(sqlfunc.count(AuditLog.id)))
    total = count_result.scalar() or 0

    log_dicts = []
    for log in logs:
        admin_email = target_email = None

        if log.admin_id:
            admin_result = await db.execute(select(User).where(User.id == log.admin_id))
            admin_user = admin_result.scalar_one_or_none()
            admin_email = admin_user.email if admin_user else None

        if log.target_id:
            try:
                target_result = await db.execute(select(User).where(User.id == log.target_id))
                target_user = target_result.scalar_one_or_none()
                target_email = target_user.email if target_user else None
            except Exception:
                pass

        log_dicts.append({
            "id":           str(log.id),
            "admin_id":     str(log.admin_id) if log.admin_id else None,
            "admin_email":  admin_email,
            "action":       log.action,
            "target_id":    log.target_id,
            "target_email": target_email,
            "details":      log.details,
            "created_at":   log.created_at.isoformat(),
        })

    return {"logs": log_dicts, "total": total, "limit": limit, "offset": offset}


@router.get("/analytics")
async def admin_get_analytics(
    _: str = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    now = datetime.now(timezone.utc)
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    week_ago = today - timedelta(days=7)

    total_users    = await db.execute(select(sqlfunc.count(User.id)))
    total_chats    = await db.execute(select(sqlfunc.count(Chat.id)))
    total_messages = await db.execute(select(sqlfunc.count(Message.id)))
    total_docs     = await db.execute(select(sqlfunc.count(Document.id)))

    active_today = await db.execute(
        select(sqlfunc.count(sqlfunc.distinct(Chat.user_id)))
        .where(Chat.created_at >= today)
    )
    active_week = await db.execute(
        select(sqlfunc.count(sqlfunc.distinct(Chat.user_id)))
        .where(Chat.created_at >= week_ago)
    )

    role_counts = await db.execute(
        select(User.role, sqlfunc.count(User.id)).group_by(User.role)
    )
    roles = {role: count for role, count in role_counts.all()}

    audit_result = await db.execute(
        select(AuditLog.action, sqlfunc.count(AuditLog.id))
        .where(AuditLog.created_at >= today)
        .group_by(AuditLog.action)
    )
    recent_actions = {action: count for action, count in audit_result.all()}

    return {
        "totals": {
            "users":     total_users.scalar() or 0,
            "chats":     total_chats.scalar() or 0,
            "messages":  total_messages.scalar() or 0,
            "documents": total_docs.scalar() or 0,
        },
        "active": {
            "today":     active_today.scalar() or 0,
            "this_week": active_week.scalar() or 0,
        },
        "roles":                roles,
        "recent_admin_actions": recent_actions,
        "timestamp":            now.isoformat(),
    }


# ----- Feature Flag Management -----

@router.get("/feature-flags")
async def admin_list_feature_flags(
    _: str = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    flags = await get_all_flags(db)
    return [
        {
            "name":           f.name,
            "description":    f.description,
            "guest_enabled":  f.guest_enabled,
            "free_enabled":   f.free_enabled,
            "pro_enabled":    f.pro_enabled,
            "admin_enabled":  f.admin_enabled,
            "updated_at":     f.updated_at.isoformat(),
        }
        for f in flags
    ]


@router.patch("/feature-flags/{name}")
async def admin_update_feature_flag(
    name: str,
    body: UpdateFeatureFlagRequest,
    request: Request,
    admin_id: str = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(FeatureFlag).where(FeatureFlag.name == name))
    flag = result.scalar_one_or_none()
    if not flag:
        raise HTTPException(status_code=404, detail=f"Feature flag '{name}' not found")

    changes: dict = {}
    if body.guest_enabled is not None:
        changes["guest_enabled"] = {"from": flag.guest_enabled, "to": body.guest_enabled}
        flag.guest_enabled = body.guest_enabled
    if body.free_enabled is not None:
        changes["free_enabled"] = {"from": flag.free_enabled, "to": body.free_enabled}
        flag.free_enabled = body.free_enabled
    if body.pro_enabled is not None:
        changes["pro_enabled"] = {"from": flag.pro_enabled, "to": body.pro_enabled}
        flag.pro_enabled = body.pro_enabled
    if body.admin_enabled is not None:
        changes["admin_enabled"] = {"from": flag.admin_enabled, "to": body.admin_enabled}
        flag.admin_enabled = body.admin_enabled

    await log_audit(db, "update_feature_flag", admin_id, None, {"flag": name, "changes": changes}, _get_client_ip(request))
    await db.commit()
    await db.refresh(flag)
    logger.info('admin_update_feature_flag admin_id=%s flag=%s changes=%s', admin_id, name, changes)
    return {
        "name":           flag.name,
        "description":    flag.description,
        "guest_enabled":  flag.guest_enabled,
        "free_enabled":   flag.free_enabled,
        "pro_enabled":    flag.pro_enabled,
        "admin_enabled":  flag.admin_enabled,
        "updated_at":     flag.updated_at.isoformat() if flag.updated_at else None,
    }


# ----- Server Config Management -----

@router.get("/server-config")
async def admin_get_server_config(_: str = Depends(require_admin)):
    return {
        "ollama_url":              _config.OLLAMA_BASE_URL or "",
        "default_model":           _config.DEFAULT_MODEL,
        "vision_model":            _config.VISION_MODEL,
        "embed_model":             _config.EMBED_MODEL,
        "thinking_models":         ",".join(_config.THINKING_MODELS),
        "tool_capable_models":     ",".join(_config.TOOL_CAPABLE_MODELS),
        "no_system_prompt_models": ",".join(_config.NO_SYSTEM_PROMPT_MODELS),
    }


@router.patch("/server-config")
async def admin_update_server_config(
    body: UpdateServerConfigRequest,
    request: Request,
    admin_id: str = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    changes: dict = {}

    if body.ollama_url is not None:
        changes["ollama_url"] = body.ollama_url
        _config.OLLAMA_BASE_URL = body.ollama_url.rstrip("/")
        _write_env_key("OLLAMA_URL", body.ollama_url.rstrip("/"))

    if body.default_model is not None:
        changes["default_model"] = body.default_model
        _config.DEFAULT_MODEL = body.default_model
        _write_env_key("DEFAULT_MODEL", body.default_model)

    if body.vision_model is not None:
        changes["vision_model"] = body.vision_model
        _config.VISION_MODEL = body.vision_model
        _write_env_key("VISION_MODEL", body.vision_model)

    if body.embed_model is not None:
        changes["embed_model"] = body.embed_model
        _config.EMBED_MODEL = body.embed_model
        _write_env_key("EMBED_MODEL", body.embed_model)

    if body.thinking_models is not None:
        parsed = [m.strip().lower() for m in body.thinking_models.split(",") if m.strip()]
        changes["thinking_models"] = parsed
        _config.THINKING_MODELS.clear()
        _config.THINKING_MODELS.extend(parsed)
        _write_env_key("THINKING_MODELS", body.thinking_models)

    if body.tool_capable_models is not None:
        parsed = [m.strip().lower() for m in body.tool_capable_models.split(",") if m.strip()]
        changes["tool_capable_models"] = parsed
        _config.TOOL_CAPABLE_MODELS.clear()
        _config.TOOL_CAPABLE_MODELS.extend(parsed)
        _write_env_key("TOOL_CAPABLE_MODELS", body.tool_capable_models)

    if body.no_system_prompt_models is not None:
        parsed = [m.strip().lower() for m in body.no_system_prompt_models.split(",") if m.strip()]
        changes["no_system_prompt_models"] = parsed
        _config.NO_SYSTEM_PROMPT_MODELS.clear()
        _config.NO_SYSTEM_PROMPT_MODELS.extend(parsed)
        _write_env_key("NO_SYSTEM_PROMPT_MODELS", body.no_system_prompt_models)

    if not changes:
        raise HTTPException(status_code=400, detail="No changes provided")

    await log_audit(db, "update_server_config", admin_id, None, changes, _get_client_ip(request))
    logger.info('admin_update_server_config admin_id=%s changes=%s', admin_id, list(changes.keys()))
    return {"updated": list(changes.keys())}
