from datetime import datetime, timedelta, timezone
from jose import jwt, JWTError
import bcrypt
import hashlib
import secrets
from fastapi import Depends, HTTPException
from fastapi.security import OAuth2PasswordBearer
import os

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")

SECRET               = os.environ["JWT_SECRET"]
ALGORITHM            = os.environ.get("JWT_ALGORITHM", "HS256")
EXPIRE_MIN           = int(os.environ.get("JWT_EXPIRE_MINUTES", 15))
REFRESH_EXPIRE_DAYS  = int(os.environ.get("JWT_REFRESH_EXPIRE_DAYS", 30))


def _password_bytes(password: str) -> bytes:
    # bcrypt only reads the first 72 bytes. Older releases dropped the rest silently;
    # 5.0 raises instead, so truncate here to keep long passwords (and hashes made
    # under the old behaviour) working.
    return password.encode("utf-8")[:72]


def hash_password(password: str) -> str:
    return bcrypt.hashpw(_password_bytes(password), bcrypt.gensalt()).decode("utf-8")


def generate_refresh_token() -> str:
    return secrets.token_urlsafe(64)


def hash_refresh_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(_password_bytes(plain), hashed.encode("utf-8"))


def create_token(user_id: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=EXPIRE_MIN)
    return jwt.encode({"sub": user_id, "exp": expire}, SECRET, algorithm=ALGORITHM)


def decode_token(token: str) -> str:
    try:
        payload = jwt.decode(token, SECRET, algorithms=[ALGORITHM])
        user_id = payload.get("sub")
        if not user_id:
            raise HTTPException(status_code=401, detail="Invalid token")
        return user_id
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")


async def get_current_user_id(token: str = Depends(oauth2_scheme)) -> str:
    return decode_token(token)
