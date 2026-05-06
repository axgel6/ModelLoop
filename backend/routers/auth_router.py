import logging
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from slowapi import Limiter
from slowapi.util import get_remote_address

from database import get_db
from models import User, RefreshToken
from feature_flags import get_all_flags
from auth import (
    hash_password, verify_password, create_token,
    get_current_user_id, generate_refresh_token,
    hash_refresh_token, REFRESH_EXPIRE_DAYS,
)
from schemas import RegisterRequest, LoginRequest, RefreshRequest, LogoutRequest, UpdateProfileRequest
from audit import log_audit
from dependencies import _get_client_ip

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/auth", tags=["auth"])
limiter = Limiter(key_func=get_remote_address)


async def _issue_tokens(user_id: str, db: AsyncSession, role: str = "free") -> dict:
    raw_refresh = generate_refresh_token()
    db.add(RefreshToken(
        user_id=user_id,
        token_hash=hash_refresh_token(raw_refresh),
        expires_at=datetime.now(timezone.utc) + timedelta(days=REFRESH_EXPIRE_DAYS),
    ))
    await db.commit()
    return {"token": create_token(user_id, role), "refresh_token": raw_refresh, "role": role}


@router.post("/register", status_code=201)
@limiter.limit("5/minute")
async def register(request: Request, body: RegisterRequest, db: AsyncSession = Depends(get_db)):
    existing = await db.execute(select(User).where(User.email == body.email))
    if existing.scalar_one_or_none():
        logger.warning('register_conflict email=%s', body.email)
        raise HTTPException(status_code=409, detail="Email already registered")
    user = User(email=body.email, password_hash=hash_password(body.password), full_name=body.full_name or None)
    db.add(user)
    await db.flush()
    logger.info('user_registered user_id=%s', user.id)
    tokens = await _issue_tokens(str(user.id), db, user.role)
    await log_audit(db, "register", target_id=str(user.id), details={"email": body.email}, ip_address=_get_client_ip(request))
    return tokens


@router.post("/login")
@limiter.limit("10/minute")
async def login(request: Request, body: LoginRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == body.email))
    user = result.scalar_one_or_none()
    if not user or not verify_password(body.password, user.password_hash):
        logger.warning('login_failed email=%s', body.email)
        await log_audit(db, "login_failed", details={"email": body.email}, ip_address=_get_client_ip(request))
        raise HTTPException(status_code=401, detail="Invalid credentials")
    logger.info('login_success user_id=%s', user.id)
    tokens = await _issue_tokens(str(user.id), db, user.role)
    await log_audit(db, "login", target_id=str(user.id), details={"email": user.email}, ip_address=_get_client_ip(request))
    return tokens


@router.post("/refresh")
async def refresh_token(body: RefreshRequest, db: AsyncSession = Depends(get_db)):
    token_hash = hash_refresh_token(body.refresh_token)
    result = await db.execute(select(RefreshToken).where(RefreshToken.token_hash == token_hash))
    rt = result.scalar_one_or_none()
    if not rt or rt.revoked or rt.expires_at < datetime.now(timezone.utc):
        logger.warning('refresh_token_invalid token_found=%s revoked=%s', rt is not None, rt.revoked if rt else None)
        raise HTTPException(status_code=401, detail="Invalid or expired refresh token")
    rt.revoked = True
    logger.info('refresh_token_rotated user_id=%s', rt.user_id)
    user_result = await db.execute(select(User).where(User.id == rt.user_id))
    refreshed_user = user_result.scalar_one_or_none()
    role = refreshed_user.role if refreshed_user else "free"
    return await _issue_tokens(str(rt.user_id), db, role)


@router.get("/me")
async def get_me(
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return {"id": str(user.id), "email": user.email, "full_name": user.full_name, "role": user.role, "is_active": user.is_active}


@router.patch("/me")
async def update_profile(
    body: UpdateProfileRequest,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.full_name = body.full_name.strip()
    await db.commit()
    return {"id": str(user.id), "email": user.email, "full_name": user.full_name, "role": user.role, "is_active": user.is_active}


@router.get("/features")
async def get_features(
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    flags = await get_all_flags(db)
    role_field = f"{user.role}_enabled"
    return {f.name: bool(getattr(f, role_field, False)) for f in flags}


@router.get("/features/guest")
async def get_guest_features(db: AsyncSession = Depends(get_db)):
    """Public endpoint — returns guest-tier flags for unauthenticated users."""
    flags = await get_all_flags(db)
    return {f.name: bool(f.guest_enabled) for f in flags}


@router.post("/logout")
async def logout(request: Request, body: LogoutRequest, db: AsyncSession = Depends(get_db)):
    token_hash = hash_refresh_token(body.refresh_token)
    result = await db.execute(select(RefreshToken).where(RefreshToken.token_hash == token_hash))
    rt = result.scalar_one_or_none()
    if rt:
        rt.revoked = True
        await db.commit()
        await log_audit(db, "logout", target_id=str(rt.user_id), ip_address=_get_client_ip(request))
    return {"ok": True}


@router.delete("/account", status_code=204)
async def delete_account(
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    await db.delete(user)
    await db.commit()
