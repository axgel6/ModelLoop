import json
import re
from datetime import datetime, timezone

DEFINITION = {
    "type": "function",
    "function": {
        "name": "get_current_time",
        "description": (
            "Returns the current UTC date, time, and day of week. "
            "Only call this when the user explicitly asks what the current time or date is. "
            "Do not call it for general conversation, greetings, or anything unrelated to knowing the actual current time."
        ),
        "parameters": {
            "type": "object",
            "properties": {},
            "required": [],
        },
    },
}

KEYWORDS = {"time", "date", "day", "today", "now", "current", "clock", "hour", "minute", "when"}

_TIME_TRIGGERS = re.compile(
    r"\b("
    r"what (time|day|date) is it\b|"
    r"what'?s (the )?(time|date|day)\b|"
    r"(current|today'?s) (time|date|day)\b|"
    r"tell me (the )?(time|date|day)\b|"
    r"(what|which) day (is it|is today)\b|"
    r"(what|which) (month|year) is it\b|"
    r"(check|get) (the )?(time|date|clock)\b|"
    r"do you know (the )?(time|date)\b"
    r")",
    re.IGNORECASE,
)


def should_activate(text: str, words: set) -> bool:
    return bool(_TIME_TRIGGERS.search(text))


def execute(arguments: dict) -> str:
    now = datetime.now(timezone.utc)
    return json.dumps({
        "utc_datetime": now.strftime("%Y-%m-%d %H:%M:%S UTC"),
        "iso8601": now.isoformat(),
        "unix_timestamp": int(now.timestamp()),
        "day_of_week": now.strftime("%A"),
    })
