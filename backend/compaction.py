"""Keeps long chats coherent past the history window.

Only the last HISTORY_WINDOW messages are sent to the model. Messages that scroll out of
that window are folded into a short running summary on the chat (Chat.summary), which goes
into the system prompt so the model still knows what came earlier: the user's name, what
they're working on, decisions made.

The summary is updated in the background after a reply is saved, a batch at a time, so no
one waits for it. Messages are never deleted from a chat, so "summarized through this
timestamp" (Chat.summary_through) marks exactly which messages it covers.
"""
import asyncio
import logging
from datetime import datetime
from typing import Optional

from sqlalchemy import select, update

import ollama_caps
import ollama_http
from config import NGROK_HEADERS
from database import AsyncSessionLocal
from models import Chat, Message

logger = logging.getLogger(__name__)

# How many of the latest messages are sent to the model as they are
HISTORY_WINDOW = 20
# Wait until this many messages have left the window before summarizing, so it runs every
# few turns rather than every turn
BATCH_MIN = 10
# The most messages folded in at once; a long chat that predates this catches up over a few turns
BATCH_MAX = 40
# Each message is cut to this many characters in the summarizer's input
MESSAGE_CHARS = 1500
SUMMARY_TOKENS = 500
TIMEOUT_SECONDS = 120

SUMMARY_PROMPT = """You keep a running summary of a long chat between a user and Olly, an AI assistant, so Olly can remember what came earlier once those messages are gone.

You are given the summary so far (it may be empty) and the next older messages. Write the updated summary:
- Keep what Olly would need later: facts the user shared about themselves, what they're working on, decisions and conclusions reached, preferences they stated, and open questions.
- Drop small talk, greetings, and details that no longer matter.
- Write short plain bullet points, at most about 250 words in all. Refer to the user as "the user".
- Output only the summary, with no heading or introduction."""

# Chats being summarized right now, so two quick turns don't summarize the same messages twice
_running: set = set()
# Keeps the background tasks referenced until they finish
_tasks: set = set()


def summary_block(chat: Optional[Chat]) -> str:
    """The text added to the system prompt for a chat that has a summary, or ""."""
    if chat is None or not chat.summary:
        return ""
    return (
        "\n\n<earlier_conversation>\n"
        "A summary of the earlier part of this chat, whose messages are no longer shown to you. "
        "Use it as background; the latest messages take priority.\n"
        f"{chat.summary}\n"
        "</earlier_conversation>"
    )


def schedule(chat_id, base_url: str, model: str) -> None:
    """Update the chat's summary in the background, if enough messages have left the window."""
    if chat_id in _running:
        return
    _running.add(chat_id)
    task = asyncio.create_task(_compact(chat_id, base_url, model))
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)


async def _compact(chat_id, base_url: str, model: str) -> None:
    try:
        async with AsyncSessionLocal() as db:
            chat = (await db.execute(select(Chat).where(Chat.id == chat_id))).scalar_one_or_none()
            if chat is None:
                return
            # A turn's two messages are saved together and share a timestamp. The newest message
            # that has left the window; everything at or before its time is summarized. When its
            # pair is still in the window, that one message is in both, which does no harm.
            left_at = (await db.execute(
                select(Message.created_at).where(Message.chat_id == chat_id)
                .order_by(Message.created_at.desc()).offset(HISTORY_WINDOW).limit(1)
            )).scalar_one_or_none()
            if left_at is None:
                return
            query = select(Message).where(Message.chat_id == chat_id, Message.created_at <= left_at)
            if chat.summary_through is not None:
                query = query.where(Message.created_at > chat.summary_through)
            pending = list((await db.execute(
                query.order_by(Message.created_at.asc(), Message.role.desc()).limit(BATCH_MAX + 1)
            )).scalars().all())
            if len(pending) > BATCH_MAX:
                # Never end a batch between a turn's two messages: the second would be skipped
                cut_at = pending[BATCH_MAX].created_at
                pending = pending[:BATCH_MAX]
                while pending and pending[-1].created_at == cut_at:
                    pending.pop()
            if len(pending) < BATCH_MIN:
                return

            summary = await _summarize(base_url, model, chat.summary, pending)
            if not summary:
                return
            through: datetime = pending[-1].created_at
            # Only if no one else moved it meanwhile
            condition = (
                Chat.summary_through.is_(None) if chat.summary_through is None
                else Chat.summary_through == chat.summary_through
            )
            await db.execute(
                update(Chat).where(Chat.id == chat_id, condition)
                # updated_at kept as it was: summarizing is not activity in the chat, and
                # would otherwise move it to the top of the history list
                .values(summary=summary, summary_through=through, updated_at=Chat.updated_at),
            )
            await db.commit()
            logger.info("chat_compacted chat_id=%s messages=%d", chat_id, len(pending))
    except Exception as e:
        logger.warning("chat_compact_failed chat_id=%s error=%r", chat_id, e)
    finally:
        _running.discard(chat_id)


async def _summarize(base_url: str, model: str, previous: Optional[str], messages) -> str:
    lines = []
    for m in messages:
        speaker = "User" if m.role == "user" else "Olly"
        text = m.content.strip()
        if len(text) > MESSAGE_CHARS:
            text = text[:MESSAGE_CHARS] + " [...]"
        lines.append(f"{speaker}: {text}")
    content = (
        f"Summary so far:\n{previous.strip() if previous else '(none yet)'}\n\n"
        "Next older messages:\n" + "\n\n".join(lines)
    )
    # The chat's own model: it is already loaded, so no other model has to be swapped in
    payload: dict = {
        "model": model,
        "messages": [
            {"role": "system", "content": SUMMARY_PROMPT},
            {"role": "user", "content": content},
        ],
        "stream": False,
        "keep_alive": -1,
        "options": await ollama_caps.with_num_ctx({"temperature": 0.2, "num_predict": SUMMARY_TOKENS}, base_url, model),
    }
    if await ollama_caps.can_think(base_url, model):
        payload["think"] = False
    resp = await ollama_http.client().post(
        f"{base_url}/api/chat", json=payload, headers=NGROK_HEADERS, timeout=TIMEOUT_SECONDS,
    )
    resp.raise_for_status()
    return (resp.json().get("message", {}).get("content") or "").strip()
