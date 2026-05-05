import json
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


def execute(arguments: dict) -> str:
    now = datetime.now(timezone.utc)
    return json.dumps({
        "utc_datetime": now.strftime("%Y-%m-%d %H:%M:%S UTC"),
        "iso8601": now.isoformat(),
        "unix_timestamp": int(now.timestamp()),
        "day_of_week": now.strftime("%A"),
    })
