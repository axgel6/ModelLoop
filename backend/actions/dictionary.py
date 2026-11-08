"""Word definitions from the Free Dictionary API (free, no API key): meanings, part of
speech, pronunciation, an example and synonyms, from a real source instead of memory.

Reads "define serendipity", "what does ephemeral mean", "meaning of ubiquitous",
"synonyms for happy".
"""
import json
import re
from typing import Optional
from urllib.parse import quote

from ._shared import MISSING, TTLCache, http_client

DEFINITION = {
    "type": "function",
    "function": {
        "name": "define_word",
        "description": "Look up an English word's definitions, pronunciation, examples and synonyms in a dictionary.",
        "parameters": {
            "type": "object",
            "properties": {"word": {"type": "string", "description": "The word to look up"}},
            "required": ["word"],
        },
    },
}

SOURCE_URL = "https://dictionaryapi.dev/"
_ENTRY_URL = "https://api.dictionaryapi.dev/api/v2/entries/en/"

_WORD = r"[\"'“‘]?(?P<word>[a-z][a-z'-]{0,30}(?: [a-z][a-z'-]{0,30}){0,2})[\"'”’]?"
_ONE_WORD = r"[\"'“‘]?(?P<word>[a-z][a-z'-]{0,30})[\"'”’]?"
# The whole message has to be the question, so "define a function in Python" is left alone
_PATTERNS = [
    # "define a variable" is about code: only a single word, with no article before it
    re.compile(rf"^(?:please |can you |could you )?define (?!a |an |the ){_ONE_WORD}$"),
    re.compile(rf"^(?:what(?:'s| is) )?(?:the )?(?:definition|meaning) of (?:the word )?{_WORD}$"),
    re.compile(rf"^what does (?:the word |the term )?{_WORD} mean$"),
    re.compile(rf"^(?:what are )?(?:some )?(?:synonyms?|other words?) (?:for|of) {_ONE_WORD}$"),
    re.compile(rf"^how (?:do you|do i|to) pronounce {_ONE_WORD}$"),
]
# "What does it mean", "what does that mean": about the conversation, not a word
_NOT_A_WORD = {
    "it", "that", "this", "these", "those", "he", "she", "they", "you", "i", "we", "me", "him", "her", "them",
    "life", "love", "a", "an", "the",
}

_cache = TTLCache(ttl=86400.0)


def parse(text: str) -> Optional[str]:
    """The word a message asks about, or None."""
    text = re.sub(r"[?!.\s]+$", "", text.lower().replace("’", "'").strip())
    for pattern in _PATTERNS:
        if match := pattern.match(text):
            word = match.group("word").strip("'-")
            if word and word not in _NOT_A_WORD:
                return word
    return None


def _summarize(entries: list) -> Optional[str]:
    """A few lines a model can read: pronunciation, two senses for each of up to three parts of speech."""
    if not entries:
        return None
    word = entries[0].get("word", "")
    phonetic = entries[0].get("phonetic") or next(
        (p.get("text") for e in entries for p in e.get("phonetics", []) if p.get("text")), ""
    )
    lines = [f"{word}" + (f" {phonetic}" if phonetic else "")]
    synonyms: list[str] = []
    seen_parts: set[str] = set()
    for entry in entries:
        for meaning in entry.get("meanings", []):
            part = meaning.get("partOfSpeech", "")
            if part in seen_parts or len(seen_parts) >= 3:
                continue
            seen_parts.add(part)
            for n, sense in enumerate(meaning.get("definitions", [])[:2], 1):
                line = f"{part} {n}. {sense.get('definition', '').strip()}"
                if sense.get("example"):
                    line += f' Example: "{sense["example"].strip()}"'
                lines.append(line)
            synonyms += meaning.get("synonyms", [])
    if synonyms:
        lines.append("Synonyms: " + ", ".join(list(dict.fromkeys(synonyms))[:8]))
    return "\n".join(lines) if len(lines) > 1 else None


async def lookup(word: str) -> Optional[str]:
    word = word.strip().lower()
    cached = _cache.get(word)
    if cached is not MISSING:
        return cached
    resp = await http_client().get(_ENTRY_URL + quote(word))
    # 404 means the dictionary has no such word, which is an answer worth keeping
    if resp.status_code == 404:
        summary = None
    else:
        resp.raise_for_status()
        summary = _summarize(resp.json())
    _cache.set(word, summary)
    return summary


def should_activate(text: str, words: set) -> bool:
    return parse(text) is not None


async def proactive(text: str, ctx: dict) -> Optional[str]:
    word = parse(text)
    if not word:
        return None
    try:
        summary = await lookup(word)
    except Exception:
        return None
    return f"Dictionary entry (Free Dictionary API):\n{summary}" if summary else None


async def async_execute(arguments: dict) -> str:
    word = str(arguments.get("word") or "").strip()
    if not word:
        return json.dumps({"error": "No word given."})
    try:
        summary = await lookup(word)
    except Exception as e:
        return json.dumps({"error": f"Dictionary lookup failed: {e}. Answer from what you know."})
    if not summary:
        return json.dumps({"error": f"'{word}' is not in the dictionary. It may be slang, a name or a phrase."})
    return json.dumps({"result": summary, "source": SOURCE_URL})
