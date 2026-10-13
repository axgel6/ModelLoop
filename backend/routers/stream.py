import asyncio
import httpx
import json
import logging
import re
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional

from database import get_db, AsyncSessionLocal
from models import User, Chat, Message
from schemas import ChatRequest, GuestChatRequest
from dependencies import get_user
from rag import retrieve_rag_context
from features import get_features
import config as _config
from config import (
    IS_PRODUCTION, NGROK_HEADERS,
    SYSTEM_PROMPT_WITH_TOOLS, SYSTEM_PROMPT_NO_TOOLS, PROPRIETARY_INSTRUCTIONS,
    THINKING_MODELS, TOOL_CAPABLE_MODELS, NO_SYSTEM_PROMPT_MODELS, API_KEY,
    ENABLE_GUEST_CHAT, CHAT_RATE_LIMIT, GUEST_CHAT_RATE_LIMIT, GUEST_CHAT_DAILY_LIMIT,
    fix_math_delimiters,
)
from ollama_target import effective_ollama_url
from rate_limit import limiter
from actions import execute_tool, get_active_tools, is_known_tool
from actions.web_search import (
    async_execute as _run_web_search_async,
    should_activate as _web_search_should_activate,
    accept_language_to_region as _accept_language_to_region,
)

logger = logging.getLogger(__name__)
router = APIRouter(tags=["stream"])

_ollama_http = httpx.AsyncClient(
    timeout=httpx.Timeout(None, connect=5.0),
    limits=httpx.Limits(max_connections=20, max_keepalive_connections=10),
)


async def close_ollama_client():
    await _ollama_http.aclose()


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
        if msg["role"] != "user" or _PRONOUN_RE.search(msg["content"]):
            continue
        names = [n for n in _PROPER_NOUN_RE.findall(msg["content"])
                 if n.lower() not in _QUESTION_WORDS]
        if names:
            return _PRONOUN_RE.sub(names[-1], prompt)
    # Second pass: assistant messages, better capitalized, often name the subject clearly
    for msg in recent_history:
        if msg["role"] != "assistant":
            continue
        names = [n for n in _PROPER_NOUN_RE.findall(msg["content"])
                 if n.lower() not in _QUESTION_WORDS and len(n) > 3]
        if names:
            return _PRONOUN_RE.sub(names[0], prompt)
    return prompt


async def _describe_images(images: list[str], base_url: str) -> str:
    n = len(images)
    prompt = (
        f"Describe {'this image' if n == 1 else f'these {n} images'} in full detail. "
        "If there is text, equations, or code, transcribe it exactly word-for-word. "
        "If it is a photo or diagram, describe every visible element, object, color, and layout. "
        "Output only the description. Do not add any commentary, offers, or follow-up questions."
    )
    payload = {
        "model": _config.VISION_MODEL,
        "messages": [{"role": "user", "content": prompt, "images": images}],
        "stream": False,
        "keep_alive": -1,
        "options": {"temperature": 0.1},
    }
    try:
        resp = await _ollama_http.post(
            f"{base_url}/api/chat",
            json=payload,
            headers=NGROK_HEADERS,
        )
        resp.raise_for_status()
        return resp.json().get("message", {}).get("content", "").strip()
    except Exception as e:
        logger.warning("image_description_failed error=%s", str(e))
        return ""


async def _ollama_stream(messages: list, model: str, temperature: float, base_url: str, top_p: float = 0.9, num_predict: int = -1, tools: Optional[list] = None):
    options: dict = {"temperature": temperature, "top_p": top_p}
    if num_predict != -1:
        options["num_predict"] = num_predict
    payload: dict = {
        "model":      model,
        "messages":   messages,
        "stream":     True,
        "keep_alive": -1,
        "options":    options,
    }
    if tools and not _is_thinking_model(model) and _supports_tools(model):
        payload["tools"] = tools
    if _is_thinking_model(model):
        payload["think"] = True
    async with _ollama_http.stream(
        "POST",
        f"{base_url}/api/chat",
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




# ---------------------------------------------------------------------------
# Shared streaming core.
#
# Both the authenticated and the guest endpoint funnel through this. The only
# differences are carried by `user` and `chat`: when they are None the caller is
# a guest, which means history comes from the request body instead of the
# database, RAG is unavailable, operator instructions are not appended, and
# nothing is persisted when the stream finishes.
# ---------------------------------------------------------------------------
async def _chat_stream_response(
    *,
    prompt: str,
    model: str,
    history: list[dict],
    system_prompt: Optional[str],
    temperature: float,
    top_p: float,
    num_predict: int,
    images: list[str],
    features: dict[str, bool],
    force_search: bool,
    search_region: str,
    base_url: str,
    db: AsyncSession,
    user: Optional[User] = None,
    chat: Optional[Chat] = None,
) -> StreamingResponse:
    is_guest = user is None

    actions_enabled = features["actions"]
    photo_enabled   = features["photo_upload"]
    rag_enabled     = features["rag"] and not is_guest

    if images and not photo_enabled:
        raise HTTPException(status_code=403, detail="Image upload is disabled")

    system_prompt = system_prompt or (SYSTEM_PROMPT_WITH_TOOLS if actions_enabled else SYSTEM_PROMPT_NO_TOOLS)

    if actions_enabled:
        active_tools = get_active_tools(prompt)
        _search_words = set(re.sub(r"[^\w\s]", "", prompt.lower()).split())
        proactive_search_enabled = bool(
            force_search or (_web_search_should_activate(prompt, _search_words) and bool(active_tools))
        )
    else:
        active_tools = []
        proactive_search_enabled = False

    async def _image_description():
        return await _describe_images(images, base_url) if images else ""

    async def _web_search_task():
        if not proactive_search_enabled:
            return None
        try:
            return json.loads(await _run_web_search_async(
                {"query": _resolve_search_query(prompt, history), "max_results": 5, "_region": search_region}
            ))
        except Exception as _e:
            logger.warning("proactive_web_search_failed error=%s", str(_e))
            return None

    async def _rag_task():
        if not rag_enabled:
            return ""
        return await retrieve_rag_context(str(chat.id), str(user.id), prompt, db, base_url)

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

    if user and user.personal_context:
        effective_system += f"\n\n<user_context>\n{user.personal_context}\n</user_context>"

    if not is_guest and PROPRIETARY_INSTRUCTIONS and not _is_thinking_model(model):
        effective_system += f"\n{PROPRIETARY_INSTRUCTIONS}"

    full_name = user.full_name if user else None
    if full_name:
        effective_system += f"\n\nThe user's name is {full_name}. Address them as {full_name.split()[0]}, and only when it feels natural."

    messages = []
    if not _skip_system_prompt(model):
        messages.append({"role": "system", "content": effective_system})
    for m in history:
        content = m["content"]
        if m["role"] == "user" and m.get("image_context"):
            content = f"<image_context>\n{m['image_context']}\n</image_context>\n\n{content}"
        if m["role"] == "user" and m.get("search_context"):
            content = f"<search_results>\n{m['search_context']}\n</search_results>\n\n{content}"
        messages.append({"role": m["role"], "content": content})

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
        # Search was triggered but returned no results; tell the model explicitly so it
        # doesn't fabricate results or claim to have retrieved live data.
        last_msg = messages[-1]
        last_msg["content"] = (
            f"[Web search returned no results. Do not invent URLs or claim to have retrieved live data.]\n\n"
            f"{last_msg['content']}"
        )

    chat_id    = str(chat.id) if chat else None
    chat_title = chat.title if chat else None

    # Everything read from the request session is in plain values by now. Release its
    # connection here: the session otherwise stays open until the stream ends, and a
    # handful of long generations would drain the pool.
    await db.close()

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
                # With no tools offered there is nothing to hold back for: JSON in the
                # reply is just the answer, and must never be run as a tool call.
                streaming_live = not active_tools

                tool_use_announced = False
                async for chunk in _ollama_stream(current_messages, model, temperature, base_url, top_p=top_p, num_predict=num_predict, tools=active_tools or None):
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
                                elif not tool_use_announced:
                                    name_match = re.search(r'"name"\s*:\s*"([^"]+)"', round_content)
                                    if name_match:
                                        tool_use_announced = True
                                        yield f"data: {json.dumps({'type': 'tool_use', 'tool': name_match.group(1)})}\n\n"
                    if msg.get("tool_calls") and not tool_use_announced:
                        tool_use_announced = True
                        first = msg["tool_calls"][0]
                        yield f"data: {json.dumps({'type': 'tool_use', 'tool': first.get('function', {}).get('name', '')})}\n\n"
                        tool_calls.extend(msg["tool_calls"])
                    elif msg.get("tool_calls"):
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

                    # JSON that merely has a "name" key (an answer the user asked for in
                    # JSON, say) is not a tool call. Release it as the reply instead.
                    if tool_calls and not all(is_known_tool(tc["function"]["name"]) for tc in tool_calls):
                        tool_calls = []
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
            # from the last round is the final answer; full_response was never assigned.
            if success and not full_response:
                full_response = round_content

            if success and full_response.strip():
                processed = fix_math_delimiters(_strip_embedded_tool_calls(full_response.strip()))
                if image_context:
                    yield f"data: {json.dumps({'type': 'image_context', 'context': image_context})}\n\n"
                if _search_ctx:
                    yield f"data: {json.dumps({'type': 'search_context', 'context': _search_ctx})}\n\n"

                # Persist before announcing 'done': the client reloads the chat list on
                # 'done', and a tab closed right after it must not lose the turn.
                # Guests have no chat record, so their turns are never persisted.
                if chat_id:
                    try:
                        async with AsyncSessionLocal() as write_db:
                            # Insert both messages in the same flush as the chat UPDATE;
                            # avoids a redundant SELECT to re-fetch a row we already own.
                            write_db.add(Message(
                                chat_id=chat_id, role="user", content=prompt,
                                images=images or None, image_context=image_context or None,
                                search_context=_search_ctx,
                            ))
                            write_db.add(Message(chat_id=chat_id, role="assistant", content=processed, model=model))
                            chat_update: dict = {"updated_at": datetime.now(timezone.utc)}
                            if chat_title == "New Chat":
                                chat_update["title"] = prompt[:60]
                            await write_db.execute(
                                update(Chat).where(Chat.id == chat_id).values(**chat_update)
                            )
                            await write_db.commit()
                    except Exception as db_err:
                        logger.error('db_save_error chat_id=%s error=%s', chat_id, str(db_err))

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


@router.post("/api/v1/chat/stream")
@limiter.limit(CHAT_RATE_LIMIT)
async def chat_stream(
    request: Request,
    body: ChatRequest,
    user: User = Depends(get_user),
    db: AsyncSession = Depends(get_db),
):
    chat_result = await db.execute(select(Chat).where(Chat.id == body.chat_id, Chat.user_id == str(user.id)))
    chat = chat_result.scalar_one_or_none()
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")

    msgs_result = await db.execute(
        select(Message)
        .where(Message.chat_id == body.chat_id)
        .order_by(Message.created_at.desc(), Message.role.asc())
        .limit(20)
    )
    history = [
        {
            "role":           m.role,
            "content":        m.content,
            "image_context":  m.image_context,
            "search_context": m.search_context,
        }
        for m in reversed(msgs_result.scalars().all())
    ]

    return await _chat_stream_response(
        prompt=body.prompt.strip(),
        model=(body.model or _config.DEFAULT_MODEL).strip(),
        history=history,
        system_prompt=body.system_prompt,
        temperature=body.temperature if body.temperature is not None else 0.7,
        top_p=body.top_p if body.top_p is not None else 0.9,
        num_predict=body.num_predict if body.num_predict is not None else -1,
        images=body.images or [],
        features=get_features(guest=False),
        force_search=bool(body.force_search),
        search_region=_accept_language_to_region(request.headers.get("accept-language", "")),
        base_url=await effective_ollama_url(user),
        db=db,
        user=user,
        chat=chat,
    )


@router.post("/api/v1/chat/guest/stream")
@limiter.limit(GUEST_CHAT_RATE_LIMIT)
@limiter.limit(GUEST_CHAT_DAILY_LIMIT, error_message="Daily guest limit reached")
async def guest_chat_stream(
    request: Request,
    body: GuestChatRequest,
    x_api_key: str = Header(None),
    db: AsyncSession = Depends(get_db),
):
    if not ENABLE_GUEST_CHAT:
        raise HTTPException(status_code=403, detail="Guest chat is disabled")
    if API_KEY and x_api_key != API_KEY:
        raise HTTPException(status_code=401, detail="Unauthorized access")

    return await _chat_stream_response(
        prompt=body.prompt.strip(),
        model=(body.model or _config.DEFAULT_MODEL).strip(),
        history=[{"role": m.role, "content": m.content} for m in body.messages],
        system_prompt=body.system_prompt,
        temperature=body.temperature if body.temperature is not None else 0.7,
        top_p=body.top_p if body.top_p is not None else 0.9,
        num_predict=body.num_predict if body.num_predict is not None else -1,
        images=body.images or [],
        features=get_features(guest=True),
        force_search=False,
        search_region=_accept_language_to_region(request.headers.get("accept-language", "")),
        base_url=await effective_ollama_url(None),
        db=db,
    )
