"""The time in a place, converting a time between places, and the difference between two.

The system prompt gives the model the user's date, but not the clock in Tokyo or what
3pm EST is in London. Places resolve offline first (abbreviations, countries and the
cities in the timezone database), then through Open-Meteo's geocoder, which the
weather action already uses and which returns each place's timezone.
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from typing import Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError, available_timezones

from . import weather as _weather
from ._shared import http_client

DEFINITION = {
    "type": "function",
    "function": {
        "name": "get_time",
        "description": (
            "Get the current time in a place, or convert a time from one place to another. "
            "Use it for any question about what time it is somewhere or about time zones."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "location": {"type": "string", "description": "City, country or time zone, e.g. 'Tokyo' or 'PST'"},
                "time": {"type": "string", "description": "Optional time to convert, e.g. '3pm' or '15:30'"},
                "from_location": {"type": "string", "description": "Where that time is. Leave out for the user's own time."},
            },
            "required": ["location"],
        },
    },
}

_ZONES = {
    # abbreviations and regions
    "est": "America/New_York", "edt": "America/New_York", "et": "America/New_York", "eastern": "America/New_York",
    "cst": "America/Chicago", "cdt": "America/Chicago", "ct": "America/Chicago", "central": "America/Chicago",
    "mst": "America/Denver", "mdt": "America/Denver", "mt": "America/Denver", "mountain": "America/Denver",
    "pst": "America/Los_Angeles", "pdt": "America/Los_Angeles", "pt": "America/Los_Angeles", "pacific": "America/Los_Angeles",
    "akst": "America/Anchorage", "hst": "Pacific/Honolulu",
    "gmt": "UTC", "utc": "UTC", "zulu": "UTC",
    "bst": "Europe/London", "cet": "Europe/Paris", "cest": "Europe/Paris", "eet": "Europe/Athens",
    "ist": "Asia/Kolkata", "jst": "Asia/Tokyo", "kst": "Asia/Seoul", "sgt": "Asia/Singapore", "hkt": "Asia/Hong_Kong",
    "aest": "Australia/Sydney", "aedt": "Australia/Sydney", "awst": "Australia/Perth",
    "nzst": "Pacific/Auckland", "nzdt": "Pacific/Auckland",
    # countries and states, by their capital or largest city
    "uk": "Europe/London", "england": "Europe/London", "britain": "Europe/London", "great britain": "Europe/London",
    "united kingdom": "Europe/London", "scotland": "Europe/London", "wales": "Europe/London", "ireland": "Europe/Dublin",
    "france": "Europe/Paris", "germany": "Europe/Berlin", "spain": "Europe/Madrid", "italy": "Europe/Rome",
    "netherlands": "Europe/Amsterdam", "holland": "Europe/Amsterdam", "belgium": "Europe/Brussels",
    "switzerland": "Europe/Zurich", "austria": "Europe/Vienna", "sweden": "Europe/Stockholm", "norway": "Europe/Oslo",
    "denmark": "Europe/Copenhagen", "finland": "Europe/Helsinki", "poland": "Europe/Warsaw", "portugal": "Europe/Lisbon",
    "greece": "Europe/Athens", "turkey": "Europe/Istanbul", "russia": "Europe/Moscow", "ukraine": "Europe/Kyiv",
    "egypt": "Africa/Cairo", "nigeria": "Africa/Lagos", "kenya": "Africa/Nairobi", "south africa": "Africa/Johannesburg",
    "uae": "Asia/Dubai", "united arab emirates": "Asia/Dubai", "saudi arabia": "Asia/Riyadh", "israel": "Asia/Jerusalem",
    "india": "Asia/Kolkata", "pakistan": "Asia/Karachi", "bangladesh": "Asia/Dhaka", "china": "Asia/Shanghai",
    "beijing": "Asia/Shanghai", "japan": "Asia/Tokyo", "korea": "Asia/Seoul", "south korea": "Asia/Seoul",
    "philippines": "Asia/Manila", "vietnam": "Asia/Ho_Chi_Minh", "thailand": "Asia/Bangkok", "indonesia": "Asia/Jakarta",
    "malaysia": "Asia/Kuala_Lumpur", "taiwan": "Asia/Taipei", "australia": "Australia/Sydney",
    "new zealand": "Pacific/Auckland", "canada": "America/Toronto", "mexico": "America/Mexico_City",
    "brazil": "America/Sao_Paulo", "argentina": "America/Argentina/Buenos_Aires", "colombia": "America/Bogota",
    "peru": "America/Lima", "chile": "America/Santiago", "hawaii": "Pacific/Honolulu", "alaska": "America/Anchorage",
    "california": "America/Los_Angeles", "texas": "America/Chicago", "florida": "America/New_York",
}
# "Tokyo", "New York", "Los Angeles": the last part of every zone name in the database
_CITIES = {
    zone.rsplit("/", 1)[-1].replace("_", " ").lower(): zone
    for zone in sorted(available_timezones())
    if "/" in zone and not zone.startswith(("Etc/", "SystemV/", "US/"))
}
_USER_WORDS = {"here", "me", "my time", "my timezone", "my time zone", "local", "local time", "my place"}

_TIME = r"(?P<time>\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)|\d{1,2}:\d{2}|noon|midnight)"
_PLACE = r"[a-z][a-z .'-]{0,40}?"
_NOW_RE = re.compile(
    rf"\btime(?: is it)?(?: right now| now| currently)? (?:in|at) (?P<place>{_PLACE})(?: right now| now| currently)?$"
)
_CONVERT_RE = re.compile(
    rf"{_TIME}\s+(?:(?:in|from)\s+)?(?P<src>{_PLACE})??\s*(?:time\s+)?(?:to|in|into)\s+(?P<dst>{_PLACE})(?:\s+time)?$"
)
_DIFFERENCE_RE = re.compile(rf"\btime difference between (?P<a>{_PLACE}) and (?P<b>{_PLACE})$")
_ZONE_OF_RE = re.compile(rf"\b(?:what|which) time ?zone (?:is|does) (?P<place>{_PLACE})(?: in| use| on)?$")
# A converted time is only worked out when it is asked about, not for "I leave at 7am to go to school"
_ABBREVIATION = r"\b(?:est|edt|cst|cdt|mst|mdt|pst|pdt|gmt|utc|bst|cet|ist|jst)\b"
_CONVERT_CUE_RE = re.compile(rf"\btime\b|\bconvert\b|^(?:what|when|whats)\b|{_ABBREVIATION}")

_INTENT_RE = re.compile(
    r"\btime (?:is it )?(?:right now |now )?(?:in|at)\b|\btime ?zones?\b|\btime difference\b"
    rf"|\b(?:\d{{1,2}}(?::\d{{2}})?\s*(?:am|pm)|noon|midnight)\s+{_ABBREVIATION}",
    re.IGNORECASE,
)


def _clean(text: str) -> str:
    text = text.lower().replace("’", "'").strip()
    return re.sub(r"[?!.\s]+$", "", text)


def _clean_place(place: str) -> str:
    place = re.sub(r"^(?:the|in)\s+", "", place.strip(" ,.'"))
    return re.sub(r"\s+(?:time|right now|now)$", "", place).strip()


def _user_zone(ctx: dict) -> tuple[str, ZoneInfo | timezone]:
    try:
        return "the user's location", ZoneInfo(ctx.get("user_tz") or "UTC")
    except (ZoneInfoNotFoundError, ValueError, OSError):
        return "the user's location", timezone.utc


async def resolve(place: str, ctx: dict) -> Optional[tuple[str, ZoneInfo | timezone]]:
    """(display name, zone) for a place, abbreviation or country, or None if unknown."""
    key = _clean_place(place)
    if not key:
        return None
    if key in _USER_WORDS:
        return _user_zone(ctx)
    zone = _ZONES.get(key) or _CITIES.get(key)
    if zone:
        name = key.upper() if len(key) <= 4 and key in _ZONES else key.title()
        return name, ZoneInfo(zone)
    # The geocoder needs "paris, france", not "paris france": try each split as city, then region
    words = key.replace(",", " ").split()
    tries = [key] + [f"{' '.join(words[:i])}, {' '.join(words[i:])}" for i in range(len(words) - 1, 0, -1)]
    found = None
    for attempt in tries if "," not in key else [key]:
        try:
            found = await _weather._geocode(http_client(), attempt)
        except Exception:
            return None
        if found and found.get("timezone"):
            break
    if not found or not found.get("timezone"):
        return None
    city, region = found.get("name"), found.get("admin1")
    # "Berlin, Germany", not "Berlin, State of Berlin, Germany"
    if region and city and city.lower() in region.lower():
        region = None
    name = ", ".join(p for p in (city, region, found.get("country")) if p)
    try:
        return name, ZoneInfo(found["timezone"])
    except (ZoneInfoNotFoundError, ValueError, OSError):
        return None


def _clock(dt: datetime) -> str:
    return f"{dt.hour % 12 or 12}:{dt.minute:02d} {'AM' if dt.hour < 12 else 'PM'} on {dt:%A}, {dt:%B} {dt.day}"


def _offset(dt: datetime) -> str:
    minutes = int(dt.utcoffset().total_seconds() // 60)
    sign = "+" if minutes >= 0 else "-"
    hours, rest = divmod(abs(minutes), 60)
    return f"UTC{sign}{hours}" + (f":{rest:02d}" if rest else "")


def _where(name: str, dt: datetime) -> str:
    """ "Tokyo (JST, UTC+9)", or "EST (UTC-5)" when the place is the abbreviation itself."""
    abbr = dt.tzname() or ""
    offset = _offset(dt)
    named = abbr and not abbr.startswith(("+", "-")) and abbr != "UTC" and abbr.lower() != name.lower()
    return f"{name} ({abbr}, {offset})" if named else f"{name} ({offset})"


def _gap(a: datetime, b: datetime, a_name: str, b_name: str) -> str:
    """How far b's clock is from a's: "Tokyo is 14 hours ahead of London"."""
    minutes = int((b.utcoffset() - a.utcoffset()).total_seconds() // 60)
    if minutes == 0:
        return f"{b_name} and {a_name} are on the same time."
    hours, rest = divmod(abs(minutes), 60)
    amount = f"{hours} hour{'s' if hours != 1 else ''}" + (f" {rest} minutes" if rest else "")
    return f"{b_name} is {amount} {'ahead of' if minutes > 0 else 'behind'} {a_name}."


def _parse_time(text: str) -> Optional[tuple[int, int]]:
    text = text.replace(".", "").replace(" ", "")
    if text == "noon":
        return 12, 0
    if text == "midnight":
        return 0, 0
    match = re.fullmatch(r"(\d{1,2})(?::(\d{2}))?(am|pm)?", text)
    if not match:
        return None
    hour, minute, half = int(match.group(1)), int(match.group(2) or 0), match.group(3)
    if half:
        if not 1 <= hour <= 12:
            return None
        hour = hour % 12 + (12 if half == "pm" else 0)
    if hour > 23 or minute > 59:
        return None
    return hour, minute


def _intent(text: str) -> Optional[tuple]:
    """Which question this is and the places in it, without looking anything up."""
    text = _clean(text)
    if match := _DIFFERENCE_RE.search(text):
        return "difference", match.group("a"), match.group("b")
    if match := _ZONE_OF_RE.search(text):
        return "now", match.group("place")
    if (match := _CONVERT_RE.search(text)) and _CONVERT_CUE_RE.search(text):
        return "convert", match.group("time"), match.group("src") or "", match.group("dst")
    if match := _NOW_RE.search(text):
        return "now", match.group("place")
    return None


def _part_of_day(dt: datetime) -> str:
    hour = dt.hour
    if 5 <= hour < 8:
        return "early morning"
    if 8 <= hour < 12:
        return "morning"
    if 12 <= hour < 17:
        return "afternoon"
    if 17 <= hour < 21:
        return "evening"
    return "night"


async def _now_in(place: str, ctx: dict, card: bool = False) -> Optional[tuple[str, dict]]:
    """The time in a place for the model, and the clock card the chat shows above the reply.

    With the card on screen the model gets the part of the day, not the minutes: the card
    keeps ticking, and a reply that says "It's 1:39 PM" is wrong a minute later.
    """
    found = await resolve(place, ctx)
    if not found:
        return None
    name, zone = found
    there = datetime.now(zone)
    user_name, user_zone = _user_zone(ctx)
    here = datetime.now(user_zone)
    if card:
        line = (
            f"In {_where(name, there)} it is {_part_of_day(there)} on {there:%A}, {there:%B} {there.day}. "
            "A live clock card above your reply shows the exact time, so never state a clock time yourself."
        )
    else:
        line = f"Current time in {_where(name, there)}: {_clock(there)}."
    if name != user_name:
        line += (" " if card else f" The user's own time is {_clock(here)}. ") + _gap(here, there, "the user", name)
    if card:
        # Small models copy an example far better than they follow a rule
        example = f"It's {_part_of_day(there)} on {there:%A}"
        if name != user_name:
            same = here.utcoffset() == there.utcoffset()
            gap = "the same time as you" if same else _gap(here, there, "you", "it").removeprefix("it is ").rstrip(".")
            example += f" in {name.split(',')[0]}, {gap}"
        line += f' A good reply: "{example}."'
    # The card keeps time in the browser from the zone name, so it is right whenever the chat is opened
    widget = {
        "kind": "clock",
        "place": "Your time" if name == user_name else name,
        "tz": getattr(zone, "key", "UTC"),
    }
    return line, widget


async def _convert(time_text: str, src: str, dst: str, ctx: dict) -> Optional[str]:
    parsed = _parse_time(time_text)
    to = await resolve(dst, ctx)
    origin = await resolve(src, ctx) if src.strip() else _user_zone(ctx)
    if not parsed or not to or not origin:
        return None
    (src_name, src_zone), (dst_name, dst_zone) = origin, to
    today = datetime.now(src_zone)
    start = today.replace(hour=parsed[0], minute=parsed[1], second=0, microsecond=0)
    end = start.astimezone(dst_zone)
    return (
        f"Time conversion: {_clock(start)} in {_where(src_name, start)} is "
        f"{_clock(end)} in {_where(dst_name, end)}."
    )


async def _difference(a: str, b: str, ctx: dict) -> Optional[str]:
    first, second = await resolve(a, ctx), await resolve(b, ctx)
    if not first or not second:
        return None
    now = datetime.now(timezone.utc)
    return "Time difference: " + _gap(now.astimezone(first[1]), now.astimezone(second[1]), first[0], second[0])


def should_activate(text: str, words: set) -> bool:
    return bool(_INTENT_RE.search(text)) or _intent(text) is not None


async def proactive(text: str, ctx: dict) -> Optional[str | tuple[str, dict]]:
    found = _intent(text)
    if not found:
        return None
    kind, *parts = found
    if kind == "now":
        return await _now_in(parts[0], ctx, card=True)
    if kind == "convert":
        return await _convert(*parts, ctx)
    return await _difference(*parts, ctx)


async def async_execute(arguments: dict) -> str:
    ctx = {"user_tz": arguments.get("_user_tz")}
    location = str(arguments.get("location") or "").strip()
    if not location:
        return json.dumps({"error": "No place given. Ask the user which city or time zone they mean."})
    time_text = str(arguments.get("time") or "").strip().lower()
    if time_text:
        line = await _convert(time_text, str(arguments.get("from_location") or ""), location, ctx)
    else:
        now = await _now_in(location, ctx)
        line = now[0] if now else None
    if not line:
        return json.dumps({"error": f"Could not find the time zone for '{location}'. Ask the user to clarify."})
    return json.dumps({"result": line})
