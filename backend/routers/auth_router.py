import logging
from typing import Optional
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from config import REFRESH_REUSE_GRACE_SECONDS
from rate_limit import limiter
from net_guard import validate_ollama_url_async, UnsafeOllamaUrl
from database import get_db
from models import User, RefreshToken
from dependencies import get_user
from features import get_features
from auth import (
    hash_password, verify_password, create_token,
    get_current_user_id, generate_refresh_token,
    hash_refresh_token, REFRESH_EXPIRE_DAYS,
)
from schemas import (
    RegisterRequest, LoginRequest, RefreshRequest, LogoutRequest, UpdateProfileRequest, UpdatePreferencesRequest,
    UpdatePersonalContextRequest, UpdateOllamaUrlRequest, UpdateEmailRequest,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


async def _issue_tokens(user_id: str, db: AsyncSession) -> dict:
    raw_refresh = generate_refresh_token()
    db.add(RefreshToken(
        user_id=user_id,
        token_hash=hash_refresh_token(raw_refresh),
        expires_at=datetime.now(timezone.utc) + timedelta(days=REFRESH_EXPIRE_DAYS),
    ))
    await db.commit()
    return {"token": create_token(user_id), "refresh_token": raw_refresh}


def _profile(user: User) -> dict:
    return {
        "id":               str(user.id),
        "username":         user.username,
        "email":            user.email,
        "full_name":        user.full_name,
        "theme":            user.theme,
        "font":             user.font,
        "avatar_color":     user.avatar_color,
        "personal_context": user.personal_context,
        "ollama_url":       user.ollama_url,
    }


async def _email_taken(email: str, db: AsyncSession, except_user: Optional[User] = None) -> bool:
    """Emails from before they were lowercased can have capitals, so compare without case."""
    query = select(User.id).where(func.lower(User.email) == email)
    if except_user is not None:
        query = query.where(User.id != except_user.id)
    return (await db.execute(query)).first() is not None


@router.post("/register", status_code=201)
@limiter.limit("5/minute")
async def register(request: Request, body: RegisterRequest, db: AsyncSession = Depends(get_db)):
    if (await db.execute(select(User.id).where(User.username == body.username))).first():
        logger.warning('register_conflict username=%s', body.username)
        raise HTTPException(status_code=409, detail="That username is taken")
    if body.email and await _email_taken(body.email, db):
        logger.warning('register_conflict email=%s', body.email)
        raise HTTPException(status_code=409, detail="Email already registered")
    user = User(username=body.username, email=body.email, password_hash=hash_password(body.password), full_name=body.full_name)
    db.add(user)
    try:
        await db.flush()
    except IntegrityError:
        # Someone registered the same name between the check and here
        raise HTTPException(status_code=409, detail="That username or email is taken")
    logger.info('user_registered user_id=%s', user.id)
    return await _issue_tokens(str(user.id), db)


@router.post("/login")
@limiter.limit("10/minute")
async def login(request: Request, body: LoginRequest, db: AsyncSession = Depends(get_db)):
    identifier = body.identifier.strip().lower()
    # Usernames cannot hold "@", so it tells the two apart
    column = func.lower(User.email) if "@" in identifier else User.username
    result = await db.execute(select(User).where(column == identifier))
    user = result.scalar_one_or_none()
    if not user or not verify_password(body.password, user.password_hash):
        logger.warning('login_failed identifier=%s', identifier)
        raise HTTPException(status_code=401, detail="Invalid credentials")
    logger.info('login_success user_id=%s', user.id)
    return await _issue_tokens(str(user.id), db)


@router.post("/refresh")
async def refresh_token(body: RefreshRequest, db: AsyncSession = Depends(get_db)):
    token_hash = hash_refresh_token(body.refresh_token)
    now = datetime.now(timezone.utc)

    # Claim the token atomically. Only the first caller matches revoked == False, so two
    # requests arriving together can no longer both rotate it and orphan each other.
    claimed = await db.execute(
        update(RefreshToken)
        .where(
            RefreshToken.token_hash == token_hash,
            RefreshToken.revoked == False,  # noqa: E712 - SQL comparison, not a Python bool test
            RefreshToken.expires_at > now,
        )
        .values(revoked=True, revoked_at=now)
        .returning(RefreshToken.user_id)
    )
    user_id = claimed.scalar_one_or_none()

    if user_id is None:
        # Lost the race, or a genuinely stale token. Look at why before rejecting.
        existing = await db.execute(
            select(RefreshToken).where(RefreshToken.token_hash == token_hash)
        )
        rt = existing.scalar_one_or_none()
        # Read into plain values up front: the session may be rolled back or closed
        # before these are logged, and a lazy reload there would raise.
        found     = rt is not None
        revoked   = bool(rt.revoked) if rt else False
        expired   = (rt.expires_at <= now) if rt else False
        revoked_at = rt.revoked_at if rt else None
        owner_id  = rt.user_id if rt else None

        within_grace = (
            found
            and revoked
            and not expired
            and revoked_at is not None
            and (now - revoked_at).total_seconds() <= REFRESH_REUSE_GRACE_SECONDS
        )
        if not within_grace:
            logger.warning(
                'refresh_token_invalid token_found=%s revoked=%s expired=%s',
                found, revoked, expired,
            )
            raise HTTPException(status_code=401, detail="Invalid or expired refresh token")
        # Rotated moments ago by a parallel request: hand this caller a fresh pair too
        # rather than logging them out over a timing accident.
        user_id = owner_id
        logger.info('refresh_token_grace_reuse user_id=%s', user_id)

    logger.info('refresh_token_rotated user_id=%s', user_id)
    return await _issue_tokens(str(user_id), db)


@router.get("/me")
async def get_me(user: User = Depends(get_user)):
    return _profile(user)


@router.patch("/me")
async def update_profile(
    body: UpdateProfileRequest,
    user: User = Depends(get_user),
    db: AsyncSession = Depends(get_db),
):
    user.full_name = body.full_name
    await db.commit()
    return _profile(user)


@router.patch("/me/email")
async def update_email(
    body: UpdateEmailRequest,
    user: User = Depends(get_user),
    db: AsyncSession = Depends(get_db),
):
    """Add, change or remove the optional email on the account."""
    if body.email and await _email_taken(body.email, db, except_user=user):
        raise HTTPException(status_code=409, detail="Email already registered")
    user.email = body.email
    try:
        await db.commit()
    except IntegrityError:
        raise HTTPException(status_code=409, detail="Email already registered")
    return {"email": user.email}


@router.patch("/me/context")
async def update_personal_context(
    body: UpdatePersonalContextRequest,
    user: User = Depends(get_user),
    db: AsyncSession = Depends(get_db),
):
    user.personal_context = body.personal_context.strip() if body.personal_context else None
    await db.commit()
    return {"personal_context": user.personal_context}


@router.patch("/preferences")
async def update_preferences(
    body: UpdatePreferencesRequest,
    user: User = Depends(get_user),
    db: AsyncSession = Depends(get_db),
):
    if body.theme is not None:
        user.theme = body.theme
    if body.font is not None:
        user.font = body.font
    if body.avatar_color is not None:
        user.avatar_color = body.avatar_color.lower() or None
    await db.commit()
    return {"theme": user.theme, "font": user.font, "avatar_color": user.avatar_color}


@router.patch("/me/ollama")
async def update_ollama_url(
    body: UpdateOllamaUrlRequest,
    user: User = Depends(get_user),
    db: AsyncSession = Depends(get_db),
):
    """Point this account at its own Ollama server, or clear it to use the shared one."""
    raw = (body.ollama_url or "").strip()
    if not raw:
        user.ollama_url = None
    else:
        try:
            user.ollama_url = await validate_ollama_url_async(raw)
        except UnsafeOllamaUrl as exc:
            raise HTTPException(status_code=400, detail=str(exc))
    await db.commit()
    return {"ollama_url": user.ollama_url}


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
    # revoked_at stays unset: a logged-out token must not get the rotation grace in refresh_token
    await db.execute(
        update(RefreshToken)
        .where(RefreshToken.token_hash == hash_refresh_token(body.refresh_token))
        .values(revoked=True)
    )
    await db.commit()
    return {"ok": True}


@router.delete("/account", status_code=204)
async def delete_account(
    user: User = Depends(get_user),
    db: AsyncSession = Depends(get_db),
):
    await db.delete(user)
    await db.commit()
