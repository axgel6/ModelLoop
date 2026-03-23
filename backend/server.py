import httpx
import os
import json
import re
from dotenv import load_dotenv
load_dotenv()
from contextlib import asynccontextmanager
from fastapi import Depends, FastAPI, HTTPException, Request, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse
from pydantic import BaseModel, EmailStr, Field
from slowapi import Limiter
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional
from database import get_db, engine, Base, AsyncSessionLocal
from models import User, Chat, Message
from auth import hash_password, verify_password, create_token, get_current_user_id

# ----- App Setup -----

@asynccontextmanager
async def lifespan(_: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield

app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None)

# Restrict cross-origin requests to the configured frontend origin
ALLOWED_ORIGINS = os.environ.get("ALLOWED_ORIGINS", "http://localhost:5173").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Rate limiter keyed by client IP to prevent API abuse
limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter

#API key for guest chat endpoint
API_KEY = os.environ.get("API_KEY")


def rate_limit_exceeded_handler(request: Request, exc: Exception):
    return JSONResponse(
        status_code=429,
        content={"detail": "Rate limit exceeded"}
    )

app.add_exception_handler(RateLimitExceeded, rate_limit_exceeded_handler)

# ----- Configuration -----

MAX_PROMPT_LENGTH        = 10000
MAX_SYSTEM_PROMPT_LENGTH = 2000
MAX_TITLE_LENGTH         = 100
MAX_GUEST_HISTORY        = 100
MODEL_NAME_PATTERN       = r"^[a-zA-Z0-9._:/ -]+$"
OLLAMA_BASE_URL   = os.environ.get("OLLAMA_URL")
DEFAULT_MODEL     = os.environ.get("DEFAULT_MODEL", "llama3.2:latest")
IS_PRODUCTION     = os.environ.get("APP_ENV", "development").lower() == "production"
# Skip the ngrok browser interstitial page on tunnel requests
NGROK_HEADERS     = {"ngrok-skip-browser-warning": "true"}

SYSTEM_PROMPT = """You are a helpful assistant. Important rules:
1. Always consider the conversation history when answering follow-up questions
2. When the user says "add X" or similar, apply it to the previous result
3. Use $ for inline math and $$ for block math
4. Be concise - don't over-explain simple questions"""

cached_models: list[str] = []


# Normalize LaTeX delimiters in model output to the format the frontend renderer expects
def fix_math_delimiters(text: str) -> str:
    # Convert \[ ... \] to $$ ... $$
    text = re.sub(r'\\\[(.+?)\\\]', r'$$\1$$', text, flags=re.DOTALL)
    # Convert \( ... \) to $ ... $
    text = re.sub(r'\\\((.+?)\\\)', r'$\1$',   text, flags=re.DOTALL)
    # Convert [ ... ] blocks containing LaTeX commands to $$ ... $$
    text = re.sub(r'\[\s*([^[\]]*\\[a-zA-Z]+[^[\]]*)\s*\]', r'$$\1$$', text)
    # Convert standalone bracketed arithmetic expressions to $$ ... $$
    text = re.sub(r'\[\s*(\d+[^[\]]*[+\-*/=][^[\]]*\d+[^[\]]*)\s*\]', r'$$\1$$', text)
    return text

# ----- Schemas -----

class RegisterRequest(BaseModel):
    email:    EmailStr = Field(..., max_length=254)
    password: str      = Field(..., min_length=8, max_length=128)

# Validated guest history entry, "system" role is excluded to prevent prompt-injection 
class GuestMessage(BaseModel):
    role:    str = Field(..., pattern=r"^(user|assistant)$")
    content: str = Field(..., max_length=MAX_PROMPT_LENGTH)

class ChatRequest(BaseModel):
    prompt:        str           = Field(..., min_length=1, max_length=MAX_PROMPT_LENGTH)
    # Frontend must create a chat first via POST /api/chats
    chat_id:       str           = Field(..., min_length=1, max_length=36)
    model:         Optional[str] = Field(default=None, max_length=100, pattern=MODEL_NAME_PATTERN)
    system_prompt: Optional[str] = Field(default=None, max_length=MAX_SYSTEM_PROMPT_LENGTH)

class GuestChatRequest(BaseModel):
    prompt:        str                    = Field(..., min_length=1, max_length=MAX_PROMPT_LENGTH)
    # Conversation history supplied by the client (not persisted)
    messages:      list[GuestMessage]     = Field(default=[], max_length=MAX_GUEST_HISTORY)
    model:         Optional[str]          = Field(default=None, max_length=100, pattern=MODEL_NAME_PATTERN)
    system_prompt: Optional[str]          = Field(default=None, max_length=MAX_SYSTEM_PROMPT_LENGTH)

class RenameChatRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=MAX_TITLE_LENGTH)

# ----- Auth Routes -----

# POST /api/auth/register - Create a new user account and return a JWT
@app.post("/api/auth/register", status_code=201)
async def register(body: RegisterRequest, db: AsyncSession = Depends(get_db)):
    existing = await db.execute(select(User).where(User.email == body.email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Email already registered")
    user = User(email=body.email, password_hash=hash_password(body.password))
    db.add(user)
    await db.commit()
    return {"token": create_token(str(user.id))}


# POST /api/auth/login - Verify credentials and return a JWT
@app.post("/api/auth/login")
async def login(body: RegisterRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == body.email))
    user = result.scalar_one_or_none()
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    return {"token": create_token(str(user.id))}

# ----- Chat Routes -----

# POST /api/chats - Create a new chat session for the authenticated user
@app.post("/api/chats", status_code=201)
async def create_chat(
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    chat = Chat(user_id=user_id)
    db.add(chat)
    await db.commit()
    await db.refresh(chat)
    return {"id": str(chat.id), "title": chat.title, "created_at": chat.created_at}


# GET /api/chats - List all chats for the authenticated user, newest first
@app.get("/api/chats")
async def list_chats(
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Chat).where(Chat.user_id == user_id).order_by(Chat.updated_at.desc())
    )
    chats = result.scalars().all()
    return {
        "chats": [
            {
                "id":         str(c.id),
                "title":      c.title,
                "created_at": c.created_at,
                "updated_at": c.updated_at,
            }
            for c in chats
        ]
    }


# PATCH /api/chats/{chat_id} - Rename a chat (user must own it)
@app.patch("/api/chats/{chat_id}")
async def rename_chat(
    chat_id: str,
    body: RenameChatRequest,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Chat).where(Chat.id == chat_id, Chat.user_id == user_id))
    chat = result.scalar_one_or_none()
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")
    chat.title = body.title
    await db.commit()
    return {"id": str(chat.id), "title": chat.title}


# DELETE /api/chats/{chat_id} - Delete a chat and all its messages (cascade)
@app.delete("/api/chats/{chat_id}", status_code=204)
async def delete_chat(
    chat_id: str,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Chat).where(Chat.id == chat_id, Chat.user_id == user_id))
    chat = result.scalar_one_or_none()
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")
    await db.delete(chat)
    await db.commit()

# ----- Message Routes -----

# GET /api/chats/{chat_id}/messages - Return full conversation history for a chat
@app.get("/api/chats/{chat_id}/messages")
async def get_messages(
    chat_id: str,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    # Verify the chat belongs to the requesting user before returning messages
    result = await db.execute(select(Chat).where(Chat.id == chat_id, Chat.user_id == user_id))
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Chat not found")
    msgs = await db.execute(
        select(Message).where(Message.chat_id == chat_id).order_by(Message.created_at)
    )
    return {"messages": [{"role": m.role, "content": m.content} for m in msgs.scalars().all()]}

# ----- Stream Routes -----

# POST /api/chat/stream - Stream a chat response via Server-Sent Events
@app.post("/api/chat/stream")
@limiter.limit("10/minute")
async def chat_stream(
    request: Request,
    body: ChatRequest,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    prompt = body.prompt.strip()
    model  = (body.model or DEFAULT_MODEL).strip()

    if len(prompt) > MAX_PROMPT_LENGTH:
        raise HTTPException(status_code=400, detail=f"Prompt exceeds maximum length of {MAX_PROMPT_LENGTH} characters")

    # Verify the chat exists and belongs to the requesting user
    result = await db.execute(select(Chat).where(Chat.id == body.chat_id, Chat.user_id == user_id))
    chat = result.scalar_one_or_none()
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")

    # Load full conversation history from the DB to provide context to the model
    msgs_result = await db.execute(
        select(Message).where(Message.chat_id == body.chat_id).order_by(Message.created_at)
    )
    history = [{"role": m.role, "content": m.content} for m in msgs_result.scalars().all()]

    # Build the messages array for the Ollama chat API
    system_prompt = body.system_prompt or SYSTEM_PROMPT
    messages = [{"role": "system", "content": system_prompt}]
    messages.extend(history)
    messages.append({"role": "user", "content": prompt})

    # Capture in local vars for use inside the generator closure
    chat_id    = body.chat_id
    chat_title = chat.title

    async def generate():
        full_response = ""
        success       = False

        try:
            # AsyncClient is non-blocking — frees the event loop while waiting for tokens
            async with httpx.AsyncClient(timeout=120) as client:
                async with client.stream(
                    "POST",
                    f"{OLLAMA_BASE_URL}/api/chat",
                    json={"model": model, "messages": messages, "stream": True},
                    headers=NGROK_HEADERS,
                ) as resp:
                    resp.raise_for_status()

                    # Forward each token to the client as it arrives
                    async for line in resp.aiter_lines():
                        if line:
                            try:
                                chunk = json.loads(line)
                                token = chunk.get("message", {}).get("content", "")
                                if token:
                                    full_response += token
                                    yield f"data: {json.dumps({'type': 'token', 'token': token})}\n\n"
                                if chunk.get("done"):
                                    success = True
                                    break
                            except json.JSONDecodeError:
                                continue

            # Persist to the DB only after the stream completes successfully
            if success and full_response.strip():
                processed = fix_math_delimiters(full_response.strip())

                # Use a fresh session — the outer session may have expired during a long stream
                async with AsyncSessionLocal() as write_db:
                    write_db.add(Message(chat_id=chat_id, role="user",      content=prompt))
                    write_db.add(Message(chat_id=chat_id, role="assistant", content=processed))

                    # Auto-title the chat from the first 60 characters of the opening prompt
                    if chat_title == "New Chat":
                        chat_result = await write_db.execute(select(Chat).where(Chat.id == chat_id))
                        chat_row = chat_result.scalar_one_or_none()
                        if chat_row:
                            chat_row.title = prompt[:60]

                    await write_db.commit()

                yield f"data: {json.dumps({'type': 'done'})}\n\n"
            else:
                yield f"data: {json.dumps({'type': 'error', 'error': 'Empty response from model'})}\n\n"

        except Exception as e:
            msg = str(e) if not IS_PRODUCTION else "An error occurred"
            yield f"data: {json.dumps({'type': 'error', 'error': msg})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# POST /api/chat/guest/stream - Stream a chat response for unauthenticated users (no persistence)
@app.post("/api/chat/guest/stream")
@limiter.limit("3/minute")
@limiter.limit("30/day", error_message="Daily guest limit reached")
async def guest_chat_stream(
    request: Request,
    body: GuestChatRequest,
    x_api_key: str = Header(None)
):
    if x_api_key != API_KEY:
        raise HTTPException(status_code=401, detail="Unauthorized access")
    
    prompt = body.prompt.strip()
    model  = (body.model or DEFAULT_MODEL).strip()

    if len(prompt) > MAX_PROMPT_LENGTH:
        raise HTTPException(status_code=400, detail=f"Prompt exceeds maximum length of {MAX_PROMPT_LENGTH} characters")

    system_prompt = body.system_prompt or SYSTEM_PROMPT
    messages = [{"role": "system", "content": system_prompt}]
    messages.extend({"role": m.role, "content": m.content} for m in body.messages)
    messages.append({"role": "user", "content": prompt})

    async def generate():
        try:
            async with httpx.AsyncClient(timeout=120) as client:
                async with client.stream(
                    "POST",
                    f"{OLLAMA_BASE_URL}/api/chat",
                    json={"model": model, "messages": messages, "stream": True},
                    headers=NGROK_HEADERS,
                ) as resp:
                    resp.raise_for_status()
                    async for line in resp.aiter_lines():
                        if line:
                            try:
                                chunk = json.loads(line)
                                token = chunk.get("message", {}).get("content", "")
                                if token:
                                    yield f"data: {json.dumps({'type': 'token', 'token': token})}\n\n"
                                if chunk.get("done"):
                                    yield f"data: {json.dumps({'type': 'done'})}\n\n"
                                    break
                            except json.JSONDecodeError:
                                continue
        except Exception as e:
            msg = str(e) if not IS_PRODUCTION else "An error occurred"
            yield f"data: {json.dumps({'type': 'error', 'error': msg})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )

# ----- Model Routes -----

# GET /api/models - Return available Ollama models, with results cached across requests
@app.get("/api/models")
async def get_models():
    global cached_models
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(f"{OLLAMA_BASE_URL}/api/tags", headers=NGROK_HEADERS)
            resp.raise_for_status()
            data = resp.json()

        fetched = [m.get("name") for m in data.get("models", []) if m.get("name")]

        # Append any newly discovered models to the cache
        for model in fetched:
            if model not in cached_models:
                cached_models.append(model)

        # Promote the default model to the top of the list
        if DEFAULT_MODEL in cached_models:
            cached_models.remove(DEFAULT_MODEL)
            cached_models.insert(0, DEFAULT_MODEL)

        return {"models": cached_models}

    except Exception as e:
        # Return stale cache on error rather than failing the request
        if cached_models:
            return {"models": cached_models}
        raise HTTPException(status_code=500, detail=str(e))

# ----- Utility -----

# GET /api/health - Liveness check
@app.get("/api/health")
async def health():
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "server:app",
        host="0.0.0.0",
        port=int(os.environ.get("PORT", 8000)),
        reload=not IS_PRODUCTION
    )
