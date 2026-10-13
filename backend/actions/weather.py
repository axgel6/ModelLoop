"""Live weather from Open-Meteo (free, no API key).

Web search results for a weather question are only page titles and blurbs, with
no numbers in them, so the model had nothing to answer from and filled the gaps
with placeholders. This looks the place up and returns real conditions instead.
"""
import json
import re
import time
from datetime import datetime
from typing import Optional

import httpx

DEFINITION = {
    "type": "function",
    "function": {
        "name": "get_weather",
        "description": (
            "Get the current weather and a 3-day forecast for a place. "
            "Use this for any question about weather, temperature, rain, or the forecast."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "location": {
                    "type": "string",
                    "description": "City name, optionally with region or country, e.g. 'Atlanta, Georgia'",
                },
            },
            "required": ["location"],
        },
    },
}

SOURCE_URL = "https://open-meteo.com/"

_WEATHER_RE = re.compile(
    r"\bweather\b"
    r"|\bforecast (for|in)\b"
    r"|\btemperature (in|outside|today|tonight|tomorrow|right now)\b"
    r"|\bhow (hot|cold|warm|humid|windy) is it\b"
    r"|\b(is it|will it|going to) (rain|snow|be sunny|be hot|be cold|storm)",
    re.IGNORECASE,
)

# "weather in Atlanta", "forecast for New York tomorrow"
_PLACE_AFTER_RE = re.compile(
    r"\b(?:in|for|at|near|around)\s+([A-Za-z][A-Za-z .,'-]{1,48}?)"
    r"(?=\s*(?:[?!.]|$|\b(?:right now|today|tonight|tomorrow|this|now|currently|please|like|going|gonna)\b))",
    re.IGNORECASE,
)
# "Atlanta weather", "New York forecast"
_PLACE_BEFORE_RE = re.compile(r"\b([A-Z][\w.'-]+(?:,? [A-Z][\w.'-]+){0,2}) (?:weather|forecast)\b")

# Things that follow "in" or "for" in a weather question without being a place.
_NOT_A_PLACE = re.compile(
    r"^(the|my|our|this|that|next|a|an|here|there|today|tonight|tomorrow|now|me|us|you|"
    r"celsius|fahrenheit|general|case|fact|advance|particular)\b",
    re.IGNORECASE,
)

_FAHRENHEIT_COUNTRIES = {"US", "BS", "KY", "LR", "PW", "FM", "MH"}

# WMO weather interpretation codes
_CONDITIONS = {
    0: "clear sky", 1: "mainly clear", 2: "partly cloudy", 3: "overcast",
    45: "fog", 48: "freezing fog",
    51: "light drizzle", 53: "drizzle", 55: "heavy drizzle",
    56: "light freezing drizzle", 57: "freezing drizzle",
    61: "light rain", 63: "rain", 65: "heavy rain",
    66: "light freezing rain", 67: "freezing rain",
    71: "light snow", 73: "snow", 75: "heavy snow", 77: "snow grains",
    80: "light rain showers", 81: "rain showers", 82: "violent rain showers",
    85: "light snow showers", 86: "heavy snow showers",
    95: "thunderstorm", 96: "thunderstorm with light hail", 99: "thunderstorm with heavy hail",
}

_GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search"
_FORECAST_URL = "https://api.open-meteo.com/v1/forecast"

_client: Optional[httpx.AsyncClient] = None
_cache: dict[str, tuple[dict, float]] = {}
_CACHE_TTL = 600.0   # conditions are refreshed every 15 minutes upstream
_CACHE_MAX = 100


def _get_client() -> httpx.AsyncClient:
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(timeout=6)
    return _client


def should_activate(text: str, words: set) -> bool:
    return bool(_WEATHER_RE.search(text))


def extract_location(text: str) -> Optional[str]:
    """Pull a place name out of a weather question, or None if it names none."""
    for match in _PLACE_AFTER_RE.finditer(text):
        place = match.group(1).strip(" .,'-")
        if place and not _NOT_A_PLACE.match(place):
            return place
    match = _PLACE_BEFORE_RE.search(text)
    if match and not _NOT_A_PLACE.match(match.group(1)):
        return match.group(1)
    return None


def _describe(code) -> str:
    return _CONDITIONS.get(code, "unknown conditions")


async def _geocode(client: httpx.AsyncClient, location: str) -> Optional[dict]:
    # The geocoder matches on the city name alone, so "Atlanta, Georgia" has to be
    # searched as "Atlanta" and the rest used to pick among the matches.
    name, _, rest = location.partition(",")
    resp = await client.get(_GEOCODE_URL, params={"name": name.strip(), "count": 5, "language": "en"})
    resp.raise_for_status()
    places = resp.json().get("results") or []
    if not places:
        return None
    hint = rest.strip().lower()
    if hint:
        for place in places:
            fields = (place.get("admin1"), place.get("country"), place.get("country_code"))
            if any(f and f.lower() == hint for f in fields):
                return place
    return places[0]


async def lookup(location: str, region: str = "us-en") -> Optional[dict]:
    """Return {"place": ..., "report": ...} for a place, or None if it cannot be found."""
    location = location.strip()
    if not location:
        return None
    key = f"{location.lower()}:{region}"
    cached = _cache.get(key)
    if cached and time.monotonic() - cached[1] < _CACHE_TTL:
        return cached[0]

    client = _get_client()
    place = await _geocode(client, location)
    if not place:
        return None

    imperial = place.get("country_code") in _FAHRENHEIT_COUNTRIES
    resp = await client.get(_FORECAST_URL, params={
        "latitude": place["latitude"],
        "longitude": place["longitude"],
        "current": "temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m",
        "daily": "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
        "temperature_unit": "fahrenheit" if imperial else "celsius",
        "wind_speed_unit": "mph" if imperial else "kmh",
        "timezone": "auto",
        "forecast_days": 3,
    })
    resp.raise_for_status()
    data = resp.json()
    now, daily = data["current"], data["daily"]
    deg = "°F" if imperial else "°C"
    wind = "mph" if imperial else "km/h"

    place_name = ", ".join(p for p in (place.get("name"), place.get("admin1"), place.get("country")) if p)
    lines = [
        f"Right now ({now['time'].replace('T', ' ')} local time): {round(now['temperature_2m'])}{deg}, "
        f"feels like {round(now['apparent_temperature'])}{deg}, {_describe(now['weather_code'])}, "
        f"humidity {round(now['relative_humidity_2m'])}%, wind {round(now['wind_speed_10m'])} {wind}."
    ]
    for i, day in enumerate(daily["time"]):
        label = ("Today", "Tomorrow")[i] if i < 2 else datetime.strptime(day, "%Y-%m-%d").strftime("%A")
        rain = daily["precipitation_probability_max"][i]
        lines.append(
            f"{label}: high {round(daily['temperature_2m_max'][i])}{deg}, "
            f"low {round(daily['temperature_2m_min'][i])}{deg}, {_describe(daily['weather_code'][i])}"
            + (f", {round(rain)}% chance of precipitation." if rain is not None else ".")
        )

    result = {"place": place_name, "report": "\n".join(lines)}
    if len(_cache) >= _CACHE_MAX:
        del _cache[next(iter(_cache))]
    _cache[key] = (result, time.monotonic())
    return result


async def async_execute(arguments: dict) -> str:
    location = str(arguments.get("location") or "").strip()
    if not location:
        return json.dumps({"error": "No location provided. Ask the user which city they mean."})
    try:
        result = await lookup(location, arguments.get("_region", "us-en"))
    except Exception as e:
        return json.dumps({"error": f"Weather lookup failed: {e}. Do not invent weather data."})
    if not result:
        return json.dumps({"error": f"No place found called '{location}'. Ask the user to clarify the location."})
    return json.dumps({**result, "source": SOURCE_URL})
