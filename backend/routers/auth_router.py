import logging
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from slowapi import Limiter
from slowapi.util import get_remote_address

from database import get_db
from models import User, RefreshToken
from features import get_features
from auth import (
    hash_password, verify_password, create_token,
    get_current_user_id, generate_refresh_token,
    hash_refresh_token, REFRESH_EXPIRE_DAYS,
)
from schemas import RegisterRequest, LoginRequest, RefreshRequest, LogoutRequest, UpdateProfileRequest, UpdatePreferencesRequest, UpdatePersonalContextRequest

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/auth", tags=["auth"])
limiter = Limiter(key_func=get_remote_address)


async def _issue_tokens(user_id: str, db: AsyncSession) -> dict:
    raw_refresh = generate_refresh_token()
    db.add(RefreshToken(
        user_id=user_id,
        token_hash=hash_refresh_token(raw_refresh),
        expires_at=datetime.now(timezone.utc) + timedelta(days=REFRESH_EXPIRE_DAYS),
    ))
    await db.commit()
    return {"token": create_token(user_id), "refresh_token": raw_refresh}


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
    return await _issue_tokens(str(user.id), db)


@router.post("/login")
@limiter.limit("10/minute")
async def login(request: Request, body: LoginRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == body.email))
    user = result.scalar_one_or_none()
    if not user or not verify_password(body.password, user.password_hash):
        logger.warning('login_failed email=%s', body.email)
        raise HTTPException(status_code=401, detail="Invalid credentials")
    logger.info('login_success user_id=%s', user.id)
    return await _issue_tokens(str(user.id), db)


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
    return await _issue_tokens(str(rt.user_id), db)


@router.get("/me")
async def get_me(
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return {"id": str(user.id), "email": user.email, "full_name": user.full_name, "theme": user.theme, "font": user.font, "personal_context": user.personal_context}


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
    return {"id": str(user.id), "email": user.email, "full_name": user.full_name, "theme": user.theme, "font": user.font, "personal_context": user.personal_context}


@router.patch("/me/context")
async def update_personal_context(
    body: UpdatePersonalContextRequest,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.personal_context = body.personal_context.strip() if body.personal_context else None
    await db.commit()
    return {"personal_context": user.personal_context}


@router.patch("/preferences")
async def update_preferences(
    body: UpdatePreferencesRequest,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if body.theme is not None:
        user.theme = body.theme
    if body.font is not None:
        user.font = body.font
    await db.commit()
    return {"theme": user.theme, "font": user.font}


@router.get("/features")
async def my_features(_: str = Depends(get_current_user_id)):
    """Feature availability for signed-in users, driven by ENABLE_* env vars."""
    return get_features(guest=False)


@router.get("/features/guest")
async def guest_features():
    """Public endpoint - feature availability for the guest chat flow."""
    return get_features(guest=True)


@router.post("/logout")
async def logout(body: LogoutRequest, db: AsyncSession = Depends(get_db)):
    token_hash = hash_refresh_token(body.refresh_token)
    result = await db.execute(select(RefreshToken).where(RefreshToken.token_hash == token_hash))
    rt = result.scalar_one_or_none()
    if rt:
        rt.revoked = True
        await db.commit()
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
