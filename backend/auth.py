from datetime import datetime, timedelta, timezone
from jose import jwt, JWTError
from passlib.context import CryptContext
from fastapi import Depends, HTTPException
from fastapi.security import OAuth2PasswordBearer
import os

pwd_context   = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")

SECRET     = os.environ["JWT_SECRET"]
ALGORITHM  = os.environ.get("JWT_ALGORITHM", "HS256")
EXPIRE_MIN = int(os.environ.get("JWT_EXPIRE_MINUTES", 1440))


def hash_password(password: str) -> str:
    # bcrypt only processes the first 72 bytes, so truncate before hashing
    truncated = password.encode("utf-8")[:72]
    return pwd_context.hash(truncated)


def verify_password(plain: str, hashed: str) -> bool:
    # Truncate the same way as hash_password before comparing
    truncated = plain.encode("utf-8")[:72]
    return pwd_context.verify(truncated, hashed)


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
