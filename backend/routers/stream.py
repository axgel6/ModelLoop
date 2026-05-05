import asyncio
import json
import logging
import re
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from database import get_db, AsyncSessionLocal
from models import Chat, Message
from config import (
    API_KEY, DEFAULT_MODEL, IS_PRODUCTION, MAX_GUEST_HISTORY,
    MAX_PROMPT_LENGTH, MAX_SYSTEM_PROMPT_LENGTH, MODEL_NAME_PATTERN, SYSTEM_PROMPT,
)
from routers.auth import get_active_user_id
from services.rag import _retrieve_rag_context
from services.ollama import _describe_images, _is_thinking_model, _ollama_stream
from actions import execute_tool, get_active_tools
from actions.web_search import async_execute as _run_web_search_async, should_activate as _web_search_should_activate
from limiter import limiter

logger = logging.getLogger(__name__)
router = APIRouter()

# Compiled once at module load; recompiling on every call is wasteful
_MATH_PATTERNS = [
    (re.compile(r'\\\[(.+?)\\\]', re.DOTALL),                             r'$$\1$$'),
    (re.compile(r'\\\((.+?)\\\)',  re.DOTALL),                             r'$\1$'),
    (re.compile(r'\[\s*([^[\]]*\\[a-zA-Z]+[^[\]]*)\s*\]'),               r'$$\1$$'),
    (re.compile(r'\[\s*(\d+[^[\]]*[+\-*/=][^[\]]*\d+[^[\]]*)\s*\]'),    r'$$\1$$'),
]

_PRONOUN_RE = re.compile(r'\b(his|her|their|he|she|they|him|them|its|it)\b', re.IGNORECASE)
_PROPER_NOUN_RE = re.compile(r'\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b')
_QUESTION_WORDS = {"what", "who", "where", "when", "why", "how", "which", "is", "are", "was", "were", "do", "does", "did", "can", "could", "would", "will", "should", "tell", "give", "show", "list", "name"}


def fix_math_delimiters(text: str) -> str:
    for pattern, replacement in _MATH_PATTERNS:
        text = pattern.sub(replacement, text)
    return text


def _resolve_search_query(prompt: str, history) -> str:
    """Resolve implicit context in a search query using conversation history.

    Two cases handled:
    1. Prompt contains pronouns (his/her/they/it…) — replace with the most recent
       named entity found in a prior user message.
    2. Prompt contains no proper nouns of its own (ignoring sentence-starting
       capitals like "What" or "How") — prefix with the most recent named entities
       from history so the query isn't sent bare.
    """
    has_pronouns = bool(_PRONOUN_RE.search(prompt))
    rest = prompt[prompt.find(' ') + 1:] if ' ' in prompt else prompt
    has_own_nouns = bool(_PROPER_NOUN_RE.search(rest))

    if has_pronouns:
        for msg in reversed(history):
            if msg.role != "user" or _PRONOUN_RE.search(msg.content):
                continue
            names = _PROPER_NOUN_RE.findall(msg.content)
            if names:
                return _PRONOUN_RE.sub(names[-1], prompt)
        return prompt

    if not has_own_nouns:
        for msg in reversed(history):
            names = [n for n in _PROPER_NOUN_RE.findall(msg.content) if n.lower() not in _QUESTION_WORDS]
            if names:
                context = " ".join(names[-3:])
                return f"{context}: {prompt}"

    return prompt


class GuestMessage(BaseModel):
    role:    str = Field(..., pattern=r"^(user|assistant)$")
    content: str = Field(..., max_length=MAX_PROMPT_LENGTH)

class ChatRequest(BaseModel):
    prompt:        str             = Field(..., min_length=1, max_length=MAX_PROMPT_LENGTH)
    chat_id:       str             = Field(..., min_length=1, max_length=36)
    model:         Optional[str]   = Field(default=None, max_length=100, pattern=MODEL_NAME_PATTERN)
    system_prompt: Optional[str]   = Field(default=None, max_length=MAX_SYSTEM_PROMPT_LENGTH)
    temperature:   Optional[float] = Field(default=0.7, ge=0.0, le=2.0)
    images:        Optional[list[str]] = Field(default=None, max_length=4)

class GuestChatRequest(BaseModel):
    prompt:        str                 = Field(..., min_length=1, max_length=MAX_PROMPT_LENGTH)
    messages:      list[GuestMessage]  = Field(default=[], max_length=MAX_GUEST_HISTORY)
    model:         Optional[str]       = Field(default=None, max_length=100, pattern=MODEL_NAME_PATTERN)
    system_prompt: Optional[str]       = Field(default=None, max_length=MAX_SYSTEM_PROMPT_LENGTH)
    temperature:   Optional[float]     = Field(default=0.7, ge=0.0, le=2.0)
    images:        Optional[list[str]] = Field(default=None, max_length=4)


@router.post("/api/v1/chat/stream")
@limiter.limit("10/minute")
async def chat_stream(
    request: Request,
    body: ChatRequest,
    user_id: str = Depends(get_active_user_id),
    db: AsyncSession = Depends(get_db),
):
    prompt = body.prompt.strip()
    model  = (body.model or DEFAULT_MODEL).strip()

    result = await db.execute(select(Chat).where(Chat.id == body.chat_id, Chat.user_id == user_id))
    chat = result.scalar_one_or_none()
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")

    msgs_result = await db.execute(
        select(Message).where(Message.chat_id == body.chat_id).order_by(Message.created_at)
    )
    db_history = msgs_result.scalars().all()

    system_prompt = body.system_prompt or SYSTEM_PROMPT
    images = body.images or []

    _recent_user = " ".join(m.content for m in db_history[-6:] if m.role == "user") if db_history else ""
    active_tools = get_active_tools(prompt + " " + _recent_user)

    _search_words = set(re.sub(r"[^\w\s]", "", prompt.lower()).split())
    _run_search = _web_search_should_activate(prompt, _search_words)
    if _run_search and active_tools:
        active_tools = [t for t in active_tools if t["function"]["name"] != "web_search"] or None

    async def _image_description():
        return await _describe_images(images) if images else ""

    async def _web_search_task():
        if not _run_search:
            return None
        try:
            return json.loads(await _run_web_search_async({"query": _resolve_search_query(prompt, db_history), "max_results": 5}))
        except Exception as _e:
            logger.warning("proactive_web_search_failed error=%s", str(_e))
            return None

    image_context, rag_context, _search_data = await asyncio.gather(
        _image_description(),
        _retrieve_rag_context(body.chat_id, user_id, prompt, db),
        _web_search_task(),
    )

    effective_system = system_prompt
    if rag_context:
        effective_system = (
            system_prompt
            + "\n\n<rag_context>\nThe following excerpts are from documents the user has uploaded. "
            "Use them to answer questions when relevant, and cite [Chunk N] if you quote directly.\n\n"
            + rag_context
            + "\n</rag_context>"
        )

    messages = [{"role": "system", "content": effective_system}]
    for m in db_history:
        if m.role == "user" and m.image_context:
            messages.append({"role": "user", "content": f"<image_context>\n{m.image_context}\n</image_context>\n\n{m.content}"})
        else:
            messages.append({"role": m.role, "content": m.content})

    user_content = prompt
    if image_context:
        user_content = f"<image_context>\n{image_context}\n</image_context>\n\n{prompt}"
    user_msg: dict = {"role": "user", "content": user_content}
    if images:
        user_msg["images"] = images
    messages.append(user_msg)

    if _search_data and _search_data.get("results"):
        _search_block = "\n\n".join(
            f"**{r['title']}** ({r['url']})\n{r['snippet']}"
            for i, r in enumerate(_search_data["results"])
        )
        last_msg = messages[-1]
        last_msg["content"] = (
            f"[Live web search results fetched right now — today's date is {datetime.now(timezone.utc).strftime('%Y-%m-%d')}. "
            f"Use these results to answer directly and specifically. Do NOT call any tools or functions — just answer using the results below.]\n\n"
            f"{_search_block}\n\n"
            f"User question: {last_msg['content']}"
        )

    chat_id    = body.chat_id
    chat_title = chat.title
    temperature = body.temperature or 0.7

    async def generate():
        full_response    = ""
        success          = False
        current_messages: list[dict] = list(messages)

        try:
            # Tool-use loop: model may call tools before producing the final answer.
            # Cap at 5 rounds to prevent runaway loops.
            for _round in range(5):
                round_content = ""
                tool_calls: list = []
                # Peek buffer: hold tokens until we can tell if the response is
                # a hallucinated JSON tool call (starts with '{').  Once we know
                # it isn't, flush the buffer and stream the rest immediately.
                peek_buf: list[str] = []
                streaming_live = False

                async for chunk in _ollama_stream(current_messages, model, temperature, tools=active_tools):
                    if "_thinking" in chunk:
                        yield f"data: {json.dumps({'type': 'thinking_token', 'token': chunk['_thinking']})}\n\n"
                        continue
                    msg   = chunk.get("message", {})
                    token = msg.get("content", "")
                    if token:
                        round_content += token
                        if streaming_live:
                            yield f"data: {json.dumps({'type': 'token', 'token': token})}\n\n"
                        else:
                            peek_buf.append(token)
                            if len(round_content.lstrip()) >= 2:
                                if not round_content.lstrip().startswith("{"):
                                    streaming_live = True
                                    for t in peek_buf:
                                        yield f"data: {json.dumps({'type': 'token', 'token': t})}\n\n"
                                    peek_buf = []
                    if msg.get("tool_calls"):
                        tool_calls.extend(msg["tool_calls"])
                    if chunk.get("done"):
                        success = True
                        break

                if not tool_calls and peek_buf:
                    try:
                        parsed = json.loads(round_content.strip())
                        name = parsed.get("name") or parsed.get("function", {}).get("name", "")
                        args = parsed.get("parameters") or parsed.get("arguments") or {}
                        if name:
                            tool_calls = [{"function": {"name": name, "arguments": args}}]
                        else:
                            raise ValueError("no name field")
                    except Exception:
                        for t in peek_buf:
                            yield f"data: {json.dumps({'type': 'token', 'token': t})}\n\n"

                if not tool_calls:
                    full_response = round_content
                    break

                current_messages.append({
                    "role": "assistant",
                    "content": round_content,
                    "tool_calls": tool_calls,
                })
                for tc in tool_calls:
                    fn        = tc.get("function", {})
                    tool_name = fn.get("name", "")
                    tool_args = fn.get("arguments") or {}
                    yield f"data: {json.dumps({'type': 'tool_use', 'tool': tool_name})}\n\n"
                    try:
                        tool_result = await execute_tool(tool_name, tool_args)
                    except Exception:
                        tool_result = json.dumps({"note": f"Tool '{tool_name}' does not exist. Answer the user's question directly in plain text using any context already provided."})
                    current_messages.append({"role": "tool", "content": tool_result})

            if success and full_response.strip():
                processed = fix_math_delimiters(full_response.strip())

                async with AsyncSessionLocal() as write_db:
                    write_db.add(Message(chat_id=chat_id, role="user", content=prompt, images=images or None, image_context=image_context or None))
                    write_db.add(Message(chat_id=chat_id, role="assistant", content=processed))

                    chat_result = await write_db.execute(select(Chat).where(Chat.id == chat_id))
                    chat_row = chat_result.scalar_one_or_none()
                    if chat_row:
                        if chat_title == "New Chat":
                            chat_row.title = prompt[:60]
                        chat_row.updated_at = datetime.now(timezone.utc)

                    await write_db.commit()

                yield f"data: {json.dumps({'type': 'done'})}\n\n"
            else:
                yield f"data: {json.dumps({'type': 'error', 'error': 'Empty response from model'})}\n\n"

        except Exception as e:
            logger.error('stream_error chat_id=%s model=%s error=%s', chat_id, model, str(e))
            msg = str(e) if not IS_PRODUCTION else "An error occurred"
            yield f"data: {json.dumps({'type': 'error', 'error': msg})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/api/v1/chat/guest/stream")
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

    system_prompt = body.system_prompt or SYSTEM_PROMPT
    images = body.images or []

    _guest_search_words = set(re.sub(r"[^\w\s]", "", prompt.lower()).split())
    _guest_run_search = _web_search_should_activate(prompt, _guest_search_words)

    async def _guest_image_description():
        return await _describe_images(images) if images else ""

    async def _guest_web_search_task():
        if not _guest_run_search:
            return None
        try:
            return json.loads(await _run_web_search_async({"query": prompt, "max_results": 5}))
        except Exception as _e:
            logger.warning("guest_proactive_web_search_failed error=%s", str(_e))
            return None

    image_context, _guest_search_data = await asyncio.gather(
        _guest_image_description(),
        _guest_web_search_task(),
    )

    messages = [{"role": "system", "content": system_prompt}]
    messages.extend({"role": m.role, "content": m.content} for m in body.messages)

    guest_user_content = prompt
    if image_context:
        guest_user_content = f"<image_context>\n{image_context}\n</image_context>\n\n{prompt}"
    guest_user_msg: dict = {"role": "user", "content": guest_user_content}
    if images:
        guest_user_msg["images"] = images
    messages.append(guest_user_msg)

    if _guest_search_data and _guest_search_data.get("results"):
        _guest_search_block = "\n\n".join(
            f"**{r['title']}** ({r['url']})\n{r['snippet']}"
            for i, r in enumerate(_guest_search_data["results"])
        )
        messages[-1]["content"] = (
            f"[Live web search results fetched right now — today's date is {datetime.now(timezone.utc).strftime('%Y-%m-%d')}. "
            f"Use these results to answer directly and specifically. Do not say you cannot find information if it is present below.]\n\n"
            f"{_guest_search_block}\n\n"
            f"User question: {messages[-1]['content']}"
        )

    async def generate():
        try:
            async for chunk in _ollama_stream(messages, model, body.temperature or 0.7):
                token = chunk.get("message", {}).get("content", "")
                if token:
                    yield f"data: {json.dumps({'type': 'token', 'token': token})}\n\n"
                if chunk.get("done"):
                    yield f"data: {json.dumps({'type': 'done'})}\n\n"
                    break
        except Exception as e:
            logger.error('guest_stream_error model=%s error=%s', model, str(e))
            msg = str(e) if not IS_PRODUCTION else "An error occurred"
            yield f"data: {json.dumps({'type': 'error', 'error': msg})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
