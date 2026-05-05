import logging
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from database import get_db
from models import User, RefreshToken
from auth import (
    hash_password, verify_password, create_token, get_current_user_id,
    generate_refresh_token, hash_refresh_token, REFRESH_EXPIRE_DAYS,
)
from limiter import limiter

logger = logging.getLogger(__name__)
router = APIRouter()


class RegisterRequest(BaseModel):
    email:    EmailStr = Field(..., max_length=254)
    password: str      = Field(..., min_length=8, max_length=128)

class LoginRequest(BaseModel):
    email:    EmailStr = Field(..., max_length=254)
    password: str      = Field(..., max_length=128)

class RefreshRequest(BaseModel):
    refresh_token: str = Field(..., min_length=1, max_length=256)

class LogoutRequest(BaseModel):
    refresh_token: str = Field(..., min_length=1, max_length=256)


async def _issue_tokens(user_id: str, db: AsyncSession, role: str = "free") -> dict:
    raw_refresh = generate_refresh_token()
    db.add(RefreshToken(
        user_id=user_id,
        token_hash=hash_refresh_token(raw_refresh),
        expires_at=datetime.now(timezone.utc) + timedelta(days=REFRESH_EXPIRE_DAYS),
    ))
    await db.commit()
    return {"token": create_token(user_id), "refresh_token": raw_refresh, "role": role}


async def get_active_user_id(user_id: str = Depends(get_current_user_id), db: AsyncSession = Depends(get_db)) -> str:
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user or not user.is_active:
        raise HTTPException(status_code=403, detail="Account access has been disabled")
    return user_id


@router.post("/api/v1/auth/register", status_code=201)
@limiter.limit("5/minute")
async def register(request: Request, body: RegisterRequest, db: AsyncSession = Depends(get_db)):
    existing = await db.execute(select(User).where(User.email == body.email))
    if existing.scalar_one_or_none():
        logger.warning('register_conflict email=%s', body.email)
        raise HTTPException(status_code=409, detail="Email already registered")
    user = User(email=body.email, password_hash=hash_password(body.password))
    db.add(user)
    await db.flush()
    logger.info('user_registered user_id=%s', user.id)
    return await _issue_tokens(str(user.id), db, user.role)


@router.post("/api/v1/auth/login")
@limiter.limit("10/minute")
async def login(request: Request, body: LoginRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == body.email))
    user = result.scalar_one_or_none()
    if not user or not verify_password(body.password, user.password_hash):
        logger.warning('login_failed email=%s', body.email)
        raise HTTPException(status_code=401, detail="Invalid credentials")
    logger.info('login_success user_id=%s', user.id)
    return await _issue_tokens(str(user.id), db, user.role)


@router.post("/api/v1/auth/refresh")
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


@router.get("/api/v1/auth/me")
async def get_me(
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return {"id": str(user.id), "email": user.email, "role": user.role, "is_active": user.is_active}


@router.post("/api/v1/auth/logout")
async def logout(body: LogoutRequest, db: AsyncSession = Depends(get_db)):
    token_hash = hash_refresh_token(body.refresh_token)
    result = await db.execute(select(RefreshToken).where(RefreshToken.token_hash == token_hash))
    rt = result.scalar_one_or_none()
    if rt:
        rt.revoked = True
        await db.commit()
    return {"ok": True}


@router.delete("/api/v1/auth/account", status_code=204)
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
