import httpx
import os
import uuid
import json
import re
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Cookie, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from typing import Optional
from fastapi.security import APIKeyHeader

load_dotenv()

# ---------------------------------------------------------------------------
# App + middleware
# ---------------------------------------------------------------------------

app = FastAPI()

# CORS configuration for frontend access
ALLOWED_ORIGINS = os.environ.get("ALLOWED_ORIGINS", "http://localhost:5173").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Rate limiting to prevent API abuse
limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
from fastapi.responses import JSONResponse

# Custom exception handler for RateLimitExceeded
def rate_limit_exceeded_handler(request: Request, exc: Exception):
    return JSONResponse(
        status_code=429,
        content={"detail": "Rate limit exceeded"}
    )

app.add_exception_handler(RateLimitExceeded, rate_limit_exceeded_handler)

# ---------------------------------------------------------------------------
# Security
# ---------------------------------------------------------------------------
API_KEY = os.environ.get("API_KEY")
api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)

async def verify_api_key(key: str = Depends(api_key_header)):
    if API_KEY and key != API_KEY:
        raise HTTPException(status_code=403, detail="Invalid or missing API key")

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

MAX_PROMPT_LENGTH = 10000
OLLAMA_BASE_URL   = os.environ.get("OLLAMA_URL")
DEFAULT_MODEL     = os.environ.get("DEFAULT_MODEL", "llama3.2:latest")
IS_PRODUCTION     = os.environ.get("APP_ENV", "development").lower() == "production"
NGROK_HEADERS     = {"ngrok-skip-browser-warning": "true"}  # Bypass ngrok browser warning

# System prompt for consistent formatting
SYSTEM_PROMPT = """You are a helpful assistant. Important rules:
1. Always consider the conversation history when answering follow-up questions
2. When the user says "add X" or similar, apply it to the previous result
3. Use $ for inline math and $$ for block math
4. Be concise - don't over-explain simple questions"""

# ---------------------------------------------------------------------------
# In-memory state
# ---------------------------------------------------------------------------

# session_id -> message history
session_histories: dict[str, list[dict]] = {}

# Cached models list
cached_models: list[str] = []

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# Post-process model output to fix math delimiters
def fix_math_delimiters(text: str) -> str:
    # Convert \[ ... \] to $$ ... $$
    text = re.sub(r'\\\[(.+?)\\\]', r'$$\1$$', text, flags=re.DOTALL)
    # Convert \( ... \) to $ ... $
    text = re.sub(r'\\\((.+?)\\\)', r'$\1$',   text, flags=re.DOTALL)
    # Convert [ ... ] containing LaTeX commands to $$ ... $$
    text = re.sub(r'\[\s*([^[\]]*\\[a-zA-Z]+[^[\]]*)\s*\]', r'$$\1$$', text)
    # Convert standalone [ expr ] math (simple expressions with operators)
    text = re.sub(r'\[\s*(\d+[^[\]]*[+\-*/=][^[\]]*\d+[^[\]]*)\s*\]', r'$$\1$$', text)
    return text


# Get existing session or create new one. Returns (session_id, history, is_new)
def get_or_create_session(session_id: Optional[str]) -> tuple[str, list[dict], bool]:
    is_new = False
    if not session_id:
        session_id = str(uuid.uuid4())
        is_new = True
        session_histories[session_id] = []
    elif session_id not in session_histories:
        session_histories[session_id] = []
    return session_id, session_histories[session_id], is_new


# Set session cookie on response
def attach_session_cookie(response: StreamingResponse, session_id: str):
    response.set_cookie(
        "session_id",
        session_id,
        httponly=True,
        samesite="none" if IS_PRODUCTION else "lax",
        secure=IS_PRODUCTION,
        max_age=86400,  # 24 hours
    )

# ---------------------------------------------------------------------------
# Request schemas
# ---------------------------------------------------------------------------

class ChatRequest(BaseModel):
    prompt:        str           = Field(..., min_length=1)
    model:         Optional[str] = None
    system_prompt: Optional[str] = None

# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

# POST /api/chat/stream - Stream chat responses using Server-Sent Events (SSE)
@app.post("/api/chat/stream")
@limiter.limit("10/minute")
async def chat_stream(
    request: Request,                           # required by slowapi for rate limiting
    body: ChatRequest,
    session_id: Optional[str] = Cookie(default=None),
    _: None = Depends(verify_api_key),
):
    prompt = body.prompt.strip()
    model  = (body.model or DEFAULT_MODEL).strip()

    if len(prompt) > MAX_PROMPT_LENGTH:
        raise HTTPException(status_code=400, detail=f"Prompt exceeds maximum length of {MAX_PROMPT_LENGTH} characters")

    sid, history, is_new = get_or_create_session(session_id)

    # Build messages array for Ollama chat API
    system_prompt = body.system_prompt or SYSTEM_PROMPT
    messages = [{"role": "system", "content": system_prompt}]
    messages.extend(history)
    messages.append({"role": "user", "content": prompt})

    async def generate():
        full_response = ""
        success       = False

        try:
            # httpx.AsyncClient is non-blocking — frees the event loop while
            # waiting for tokens, unlike requests which blocks a thread
            async with httpx.AsyncClient(timeout=120) as client:
                async with client.stream(
                    "POST",
                    f"{OLLAMA_BASE_URL}/api/chat",
                    json={"model": model, "messages": messages, "stream": True},
                    headers=NGROK_HEADERS,
                ) as resp:
                    resp.raise_for_status()

                    # Stream tokens as they arrive
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

            # Only persist to history after successful completion
            if success and full_response.strip():
                processed = fix_math_delimiters(full_response.strip())
                history.append({"role": "user",      "content": prompt})
                history.append({"role": "assistant", "content": processed})
                yield f"data: {json.dumps({'type': 'done', 'history': history})}\n\n"
            else:
                yield f"data: {json.dumps({'type': 'error', 'error': 'Empty response from model'})}\n\n"

        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'error': str(e)})}\n\n"

    response = StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
    if is_new:
        attach_session_cookie(response, sid)
    return response


# GET /api/history - Retrieve conversation history for current session
@app.get("/api/history")
async def get_history(
    session_id: Optional[str] = Cookie(default=None),
    _: None = Depends(verify_api_key),
):
    _sid, history, _is_new = get_or_create_session(session_id) #_sid (sessionID) and _is_new (whether session was created) are unused but we want the side effect of creating a session if one doesn't exist
    return {"history": history}


# DELETE /api/history - Clear conversation history for current session
@app.delete("/api/history")
async def clear_history(
    session_id: Optional[str] = Cookie(default=None),
    _: None = Depends(verify_api_key),
):
    if session_id and session_id in session_histories:
        session_histories[session_id].clear() # Clear in-place to ensure all references are updated
    return {"message": "History cleared"}


# GET /api/models - Fetch available models from Ollama server
@app.get("/api/models")
async def get_models():
    global cached_models
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(f"{OLLAMA_BASE_URL}/api/tags", headers=NGROK_HEADERS)
            resp.raise_for_status()
            data = resp.json()

        fetched = [m.get("name") for m in data.get("models", []) if m.get("name")]

        # Add any new models to the cache
        for model in fetched:
            if model not in cached_models:
                cached_models.append(model)

        # Sort so DEFAULT_MODEL comes first if present
        if DEFAULT_MODEL in cached_models:
            cached_models.remove(DEFAULT_MODEL)
            cached_models.insert(0, DEFAULT_MODEL)

        return {"models": cached_models}

    except Exception as e:
        # Return cached models if available, otherwise error
        if cached_models:
            return {"models": cached_models}
        raise HTTPException(status_code=500, detail=str(e))

    # ---------------------------------------------------------------------------
    # Main entry point
    # ---------------------------------------------------------------------------
    
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "server:app",
        host="0.0.0.0",
        port=int(os.environ.get("PORT", 8000)),
        reload=not IS_PRODUCTION
    )