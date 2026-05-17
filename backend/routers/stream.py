import asyncio
import httpx
import json
import logging
import re
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.responses import StreamingResponse
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional

from database import get_db, AsyncSessionLocal
from models import User, Chat, Message
from schemas import ChatRequest, GuestChatRequest
from dependencies import get_active_user
from rag import retrieve_rag_context
from feature_flags import is_feature_enabled
from config import (
    DEFAULT_MODEL, IS_PRODUCTION, NGROK_HEADERS, OLLAMA_BASE_URL,
    PRO_SYSTEM_PROMPT, FREE_SYSTEM_PROMPT, PROPRIETARY_INSTRUCTIONS,
    THINKING_MODELS, TOOL_CAPABLE_MODELS, NO_SYSTEM_PROMPT_MODELS, API_KEY,
    fix_math_delimiters,
)
from actions import execute_tool, get_active_tools
from actions.web_search import (
    async_execute as _run_web_search_async,
    should_activate as _web_search_should_activate,
    accept_language_to_region as _accept_language_to_region,
)
from auth import decode_token_role

logger = logging.getLogger(__name__)
router = APIRouter(tags=["stream"])
def _chat_key(request: Request) -> str:
    return (request.headers.get("Authorization") or "").removeprefix("Bearer ").strip() or get_remote_address(request)

limiter = Limiter(key_func=_chat_key)

_RATE_LIMITS = {"pro": "30/minute", "admin": "30/minute"}

def _chat_rate_limit(key: str) -> str:
    role = decode_token_role(key) if key else "free"
    return _RATE_LIMITS.get(role, "10/minute")

_PRONOUN_RE = re.compile(r'\b(his|her|their|he|she|they|him|them|its|it)\b', re.IGNORECASE)
_PROPER_NOUN_RE = re.compile(r'\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b')
_QUESTION_WORDS = {"what", "who", "where", "when", "why", "how", "which", "is", "are", "was",
                   "were", "do", "does", "did", "can", "could", "would", "will", "should",
                   "tell", "give", "show", "list", "name"}

# Strips embedded tool-call JSON that some models append to their text output
# instead of using the structured tool_calls field.
_EMBEDDED_TOOL_RE = re.compile(
    r'\s*[\[{]\s*"name"\s*:\s*"[^"]+"\s*,\s*"arguments"\s*:.*?[\]}]\s*$',
    re.DOTALL,
)

def _strip_embedded_tool_calls(text: str) -> str:
    return _EMBEDDED_TOOL_RE.sub("", text).rstrip()

def _is_thinking_model(model: str) -> bool:
    return any(p in model.lower() for p in THINKING_MODELS)

def _supports_tools(model: str) -> bool:
    return any(p in model.lower() for p in TOOL_CAPABLE_MODELS)

def _skip_system_prompt(model: str) -> bool:
    return any(p in model.lower() for p in NO_SYSTEM_PROMPT_MODELS)


def _resolve_search_query(prompt: str, history) -> str:
    if not _PRONOUN_RE.search(prompt):
        return prompt
    recent_history = list(reversed(history[-10:]))
    # First pass: user messages without pronouns
    for msg in recent_history:
        if msg.role != "user" or _PRONOUN_RE.search(msg.content):
            continue
        names = [n for n in _PROPER_NOUN_RE.findall(msg.content)
                 if n.lower() not in _QUESTION_WORDS]
        if names:
            return _PRONOUN_RE.sub(names[-1], prompt)
    # Second pass: assistant messages — better capitalized, often name the subject clearly
    for msg in recent_history:
        if msg.role != "assistant":
            continue
        names = [n for n in _PROPER_NOUN_RE.findall(msg.content)
                 if n.lower() not in _QUESTION_WORDS and len(n) > 3]
        if names:
            return _PRONOUN_RE.sub(names[0], prompt)
    return prompt


async def _describe_images(images: list[str]) -> str:
    from config import VISION_MODEL
    n = len(images)
    prompt = (
        f"Describe {'this image' if n == 1 else f'these {n} images'} in full detail. "
        "If there is text, equations, or code, transcribe it exactly word-for-word. "
        "If it is a photo or diagram, describe every visible element, object, color, and layout. "
        "Output only the description. Do not add any commentary, offers, or follow-up questions."
    )
    payload = {
        "model": VISION_MODEL,
        "messages": [{"role": "user", "content": prompt, "images": images}],
        "stream": False,
        "keep_alive": -1,
        "options": {"temperature": 0.1},
    }
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(
                f"{OLLAMA_BASE_URL}/api/chat",
                json=payload,
                headers=NGROK_HEADERS,
            )
            resp.raise_for_status()
            return resp.json().get("message", {}).get("content", "").strip()
    except Exception as e:
        logger.warning("image_description_failed error=%s", str(e))
        return ""


async def _ollama_stream(messages: list, model: str, temperature: float, tools: Optional[list] = None):
    payload: dict = {
        "model":      model,
        "messages":   messages,
        "stream":     True,
        "keep_alive": -1,
        "options":    {"temperature": temperature},
    }
    if tools and not _is_thinking_model(model) and _supports_tools(model):
        payload["tools"] = tools
    if _is_thinking_model(model):
        payload["think"] = True
    async with httpx.AsyncClient(timeout=120) as client:
        async with client.stream(
            "POST",
            f"{OLLAMA_BASE_URL}/api/chat",
            json=payload,
            headers=NGROK_HEADERS,
        ) as resp:
            resp.raise_for_status()
            async for line in resp.aiter_lines():
                if line:
                    try:
                        chunk = json.loads(line)
                        thinking = chunk.get("message", {}).get("thinking", "")
                        if thinking:
                            yield {"_thinking": thinking}
                        yield chunk
                    except json.JSONDecodeError:
                        continue


@router.post("/api/v1/chat/stream")
@limiter.limit(_chat_rate_limit)
async def chat_stream(
    request: Request,
    body: ChatRequest,
    user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_db),
):
    prompt   = body.prompt.strip()
    model    = (body.model or DEFAULT_MODEL).strip()
    user_id  = str(user.id)
    role     = user.role

    result = await db.execute(select(Chat).where(Chat.id == body.chat_id, Chat.user_id == user_id))
    chat = result.scalar_one_or_none()
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")

    msgs_result = await db.execute(
        select(Message)
        .where(Message.chat_id == body.chat_id)
        .order_by(Message.created_at.desc(), Message.role.asc())
        .limit(20)
    )
    db_history = list(reversed(msgs_result.scalars().all()))

    # Determine capabilities based on feature flags
    actions_enabled = await is_feature_enabled("actions", role, db)
    photo_enabled   = await is_feature_enabled("photo_upload", role, db)
    rag_enabled     = await is_feature_enabled("rag", role, db)

    system_prompt_default = PRO_SYSTEM_PROMPT if actions_enabled else FREE_SYSTEM_PROMPT
    system_prompt = body.system_prompt or system_prompt_default

    images = body.images or []
    if images and not photo_enabled:
        raise HTTPException(status_code=403, detail="Image upload is not available on your plan")

    search_region = _accept_language_to_region(request.headers.get("accept-language", ""))

    if actions_enabled:
        active_tools = get_active_tools(prompt)
        _search_words = set(re.sub(r"[^\w\s]", "", prompt.lower()).split())
        _run_search = body.force_search or (_web_search_should_activate(prompt, _search_words) and bool(active_tools))
        proactive_search_enabled = bool(_run_search)
    else:
        active_tools = []
        proactive_search_enabled = False

    async def _image_description():
        return await _describe_images(images) if images else ""

    async def _web_search_task():
        if not proactive_search_enabled:
            return None
        try:
            return json.loads(await _run_web_search_async(
                {"query": _resolve_search_query(prompt, db_history), "max_results": 8, "_region": search_region}
            ))
        except Exception as _e:
            logger.warning("proactive_web_search_failed error=%s", str(_e))
            return None

    async def _rag_task():
        if not rag_enabled:
            return ""
        return await retrieve_rag_context(body.chat_id, user_id, prompt, db)

    image_context, rag_context, _search_data = await asyncio.gather(
        _image_description(),
        _rag_task(),
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

    if user.personal_context:
        effective_system += f"\n\n<user_context>\n{user.personal_context}\n</user_context>"

    if PROPRIETARY_INSTRUCTIONS and not _is_thinking_model(model):
        effective_system += f"\n{PROPRIETARY_INSTRUCTIONS}"

    messages = []
    if not _skip_system_prompt(model):
        messages.append({"role": "system", "content": effective_system})
        if user.full_name:
            messages.append({"role": "user", "content": f"My name is {user.full_name}."})
            messages.append({"role": "assistant", "content": f"Hello, {user.full_name.split()[0]}! How can I help you today?"})
        else:
            messages.append({"role": "assistant", "content": "Hello! How can I help you today?"})
        messages.append({"role": "user", "content": "qwzxqwzxqwzxqwzx"})
        messages.append({"role": "assistant", "content": "I'm not sure what you meant — could you rephrase that?"})
    for m in db_history:
        content = m.content
        if m.role == "user" and m.image_context:
            content = f"<image_context>\n{m.image_context}\n</image_context>\n\n{content}"
        if m.role == "user" and m.search_context:
            content = f"<search_results>\n{m.search_context}\n</search_results>\n\n{content}"
        messages.append({"role": m.role, "content": content})

    user_content = prompt
    if image_context:
        user_content = f"<image_context>\n{image_context}\n</image_context>\n\n{prompt}"
    user_msg: dict = {"role": "user", "content": user_content}
    if images:
        user_msg["images"] = images
    messages.append(user_msg)

    _search_block: Optional[str] = None
    if _search_data and _search_data.get("results"):
        _search_block = "\n\n".join(
            f"**{r['title']}** ({r['url']})\n{r['snippet']}"
            for r in _search_data["results"]
        )
        last_msg = messages[-1]
        last_msg["content"] = (
            f"<search_results date=\"{datetime.now(timezone.utc).strftime('%Y-%m-%d')}\">\n"
            f"{_search_block}\n"
            f"</search_results>\n\n"
            f"{last_msg['content']}"
        )
    elif proactive_search_enabled:
        # Search was triggered but returned no results — tell the model explicitly so it
        # doesn't fabricate results or claim to have retrieved live data.
        last_msg = messages[-1]
        last_msg["content"] = (
            f"[Web search returned no results. Do not invent URLs or claim to have retrieved live data.]\n\n"
            f"{last_msg['content']}"
        )

    chat_id    = body.chat_id
    chat_title = chat.title
    temperature = body.temperature or 0.7

    async def generate():
        full_response = ""
        success       = False
        current_messages: list[dict] = list(messages)
        reactive_search_blocks: list[str] = []

        try:
            round_content = ""
            for _round in range(5):
                round_content  = ""
                tool_calls:   list = []
                peek_buf:     list[str] = []
                streaming_live = False

                async for chunk in _ollama_stream(current_messages, model, temperature, tools=active_tools or None):
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
                            stripped = round_content.lstrip()
                            if len(stripped) >= 2:
                                # Hold back content that looks like a tool call:
                                # { ... }  standard JSON tool call
                                # [{ ...   JSON array of tool calls
                                # [TOOL_CALLS] ...  Mistral-style prefix
                                is_tool_like = (
                                    stripped.startswith("{")
                                    or stripped.startswith("[{")
                                    or stripped.upper().startswith("[TOOL_CALLS]")
                                )
                                if not is_tool_like:
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
                        raw = round_content.strip()
                        # Strip Mistral-style [TOOL_CALLS] prefix
                        if raw.upper().startswith("[TOOL_CALLS]"):
                            raw = raw[len("[TOOL_CALLS]"):].strip()
                        # Fix common model output issue: unclosed braces
                        open_count = raw.count('{')
                        close_count = raw.count('}')
                        if open_count > close_count:
                            raw += '}' * (open_count - close_count)
                        parsed = json.loads(raw)
                        if isinstance(parsed, list):
                            for item in parsed:
                                name = item.get("name") or item.get("function", {}).get("name", "")
                                args = item.get("parameters") or item.get("arguments") or {}
                                if name:
                                    tool_calls.append({"function": {"name": name, "arguments": args}})
                            if not tool_calls:
                                raise ValueError("no name field in list")
                        else:
                            name = parsed.get("name") or parsed.get("function", {}).get("name", "")
                            args = parsed.get("parameters") or parsed.get("arguments") or {}
                            if name:
                                tool_calls = [{"function": {"name": name, "arguments": args}}]
                            else:
                                raise ValueError("no name field")
                    except Exception:
                        # Regex fallback: extract name and query even from malformed JSON
                        name_match = re.search(r'"name"\s*:\s*"([^"]+)"', round_content)
                        query_match = re.search(r'"query"\s*:\s*"([^"]+)"', round_content)
                        if name_match and query_match:
                            tool_calls = [{"function": {"name": name_match.group(1), "arguments": {"query": query_match.group(1)}}}]
                        else:
                            for t in peek_buf:
                                yield f"data: {json.dumps({'type': 'token', 'token': t})}\n\n"

                if not tool_calls:
                    full_response = round_content
                    break

                # Actions are only reachable here when actions_enabled=True (active_tools is non-empty)
                current_messages.append({
                    "role": "assistant",
                    "content": round_content,
                    "tool_calls": tool_calls,
                })
                for tc in tool_calls:
                    fn        = tc.get("function", {})
                    tool_name = fn.get("name", "")
                    tool_args = fn.get("arguments") or {}
                    if isinstance(tool_args, str):
                        try:
                            tool_args = json.loads(tool_args)
                        except (json.JSONDecodeError, ValueError):
                            tool_args = {}
                    yield f"data: {json.dumps({'type': 'tool_use', 'tool': tool_name})}\n\n"
                    if tool_name == "web_search":
                        tool_args["_region"] = search_region
                    try:
                        tool_result = await execute_tool(tool_name, tool_args)
                    except Exception:
                        tool_result = json.dumps({"error": f"Tool '{tool_name}' failed. Do NOT fabricate results. Answer from training knowledge and be transparent that live data could not be retrieved."})
                    current_messages.append({"role": "tool", "content": tool_result})
                    # Collect web_search results so they can be persisted with the message
                    if tool_name == "web_search":
                        try:
                            parsed_result = json.loads(tool_result)
                            if parsed_result.get("results"):
                                reactive_search_blocks.append("\n\n".join(
                                    f"**{r['title']}** ({r['url']})\n{r['snippet']}"
                                    for r in parsed_result["results"]
                                ))
                        except Exception:
                            pass

            # Build combined search context: proactive results + any reactive tool results.
            # dict.fromkeys preserves insertion order while dropping identical duplicate blocks.
            _all_search = list(dict.fromkeys(([_search_block] if _search_block else []) + reactive_search_blocks))
            _search_ctx = "\n\n---\n\n".join(_all_search) if _all_search else None

            # If all 5 rounds were tool calls (loop exhausted without break), round_content
            # from the last round is the final answer — full_response was never assigned.
            if success and not full_response:
                full_response = round_content

            if success and full_response.strip():
                processed = fix_math_delimiters(_strip_embedded_tool_calls(full_response.strip()))
                if image_context:
                    yield f"data: {json.dumps({'type': 'image_context', 'context': image_context})}\n\n"
                if _search_ctx:
                    yield f"data: {json.dumps({'type': 'search_context', 'context': _search_ctx})}\n\n"

                async with AsyncSessionLocal() as write_db:
                    chat_result = await write_db.execute(select(Chat).where(Chat.id == chat_id))
                    chat_row = chat_result.scalar_one_or_none()
                    if chat_row:
                        write_db.add(Message(
                            chat_id=chat_id, role="user", content=prompt,
                            images=images or None, image_context=image_context or None,
                            search_context=_search_ctx,
                        ))
                        write_db.add(Message(chat_id=chat_id, role="assistant", content=processed))
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
@limiter.limit("5/minute")
@limiter.limit("50/day", error_message="Daily guest limit reached")
async def guest_chat_stream(
    request: Request,
    body: GuestChatRequest,
    x_api_key: str = Header(None),
    db: AsyncSession = Depends(get_db),
):
    if API_KEY and x_api_key != API_KEY:
        raise HTTPException(status_code=401, detail="Unauthorized access")

    prompt = body.prompt.strip()
    model  = (body.model or DEFAULT_MODEL).strip()
    
    actions_enabled = await is_feature_enabled("actions", "guest", db)
    photo_enabled   = await is_feature_enabled("photo_upload", "guest", db)
    system_prompt_default = PRO_SYSTEM_PROMPT if actions_enabled else FREE_SYSTEM_PROMPT
    system_prompt = body.system_prompt or system_prompt_default
    images = body.images or []
    if images and not photo_enabled:
        raise HTTPException(status_code=403, detail="Image upload is not available")

    _guest_search_region = _accept_language_to_region(request.headers.get("accept-language", ""))
    _guest_search_words  = set(re.sub(r"[^\w\s]", "", prompt.lower()).split())
    _guest_run_search    = _web_search_should_activate(prompt, _guest_search_words) if actions_enabled else False

    async def _guest_image_description():
        return await _describe_images(images) if images else ""

    async def _guest_web_search_task():
        if not _guest_run_search:
            return None
        try:
            return json.loads(await _run_web_search_async(
                {"query": _resolve_search_query(prompt, body.messages), "max_results": 8, "_region": _guest_search_region}
            ))
        except Exception as _e:
            logger.warning("guest_proactive_web_search_failed error=%s", str(_e))
            return None

    image_context, _guest_search_data = await asyncio.gather(
        _guest_image_description(),
        _guest_web_search_task(),
    )

    messages = []
    if not _skip_system_prompt(model):
        messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "assistant", "content": "Hello! How can I help you today?"})
        messages.append({"role": "user", "content": "qwzxqwzxqwzxqwzx"})
        messages.append({"role": "assistant", "content": "I'm not sure what you meant — could you rephrase that?"})
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
            for r in _guest_search_data["results"]
        )
        messages[-1]["content"] = (
            f"<search_results date=\"{datetime.now(timezone.utc).strftime('%Y-%m-%d')}\">\n"
            f"{_guest_search_block}\n"
            f"</search_results>\n\n"
            f"{messages[-1]['content']}"
        )
    elif _guest_run_search:
        messages[-1]["content"] = (
            f"[Web search returned no results. Do not invent URLs or claim to have retrieved live data.]\n\n"
            f"{messages[-1]['content']}"
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
