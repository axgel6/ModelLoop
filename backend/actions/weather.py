"""Live weather from Open-Meteo, with MET Norway as the backup (both free, no API key).

Web search results for a weather question are only page titles and blurbs, with
no numbers in them, so the model had nothing to answer from and filled the gaps
with placeholders. This looks the place up and returns real conditions instead.

Open-Meteo limits requests per IP address, and a cloud host's shared IP can run
out for reasons that have nothing to do with us. When it refuses, the forecast
comes from MET Norway instead, reshaped to look like an Open-Meteo answer.
"""
import json
import logging
import re
import time
from datetime import datetime, timedelta, timezone
from typing import Optional
from zoneinfo import ZoneInfo

import httpx

from ._shared import MISSING, TTLCache, http_client

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
MET_SOURCE_URL = "https://www.met.no/en"

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
_MET_URL = "https://api.met.no/weatherapi/locationforecast/2.0/complete"
# MET Norway turns away requests that do not say who is asking
_MET_HEADERS = {"User-Agent": "ModelLoop/1.0 (+https://github.com/axgel6/ModelLoop)"}

logger = logging.getLogger(__name__)

# After Open-Meteo says "too many requests", it is left alone this long
_REST_AFTER_429 = 600.0
_open_meteo_resting_until = 0.0

# MET Norway symbol codes (with _day/_night left off) as WMO codes, which the card's icons use
_MET_SYMBOLS = {
    "clearsky": 0, "fair": 1, "partlycloudy": 2, "cloudy": 3, "fog": 45,
    "lightrain": 61, "rain": 63, "heavyrain": 65,
    "lightrainshowers": 80, "rainshowers": 81, "heavyrainshowers": 82,
    "lightsleet": 66, "sleet": 67, "heavysleet": 67,
    "lightsleetshowers": 66, "sleetshowers": 67, "heavysleetshowers": 67,
    "lightsnow": 71, "snow": 73, "heavysnow": 75,
    "lightsnowshowers": 85, "snowshowers": 85, "heavysnowshowers": 86,
}

# Conditions are refreshed every 15 minutes upstream
_cache = TTLCache(ttl=600.0, max_size=100)


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


_US_STATES = {
    "al": "alabama", "ak": "alaska", "az": "arizona", "ar": "arkansas", "ca": "california",
    "co": "colorado", "ct": "connecticut", "de": "delaware", "fl": "florida", "ga": "georgia",
    "hi": "hawaii", "id": "idaho", "il": "illinois", "in": "indiana", "ia": "iowa",
    "ks": "kansas", "ky": "kentucky", "la": "louisiana", "me": "maine", "md": "maryland",
    "ma": "massachusetts", "mi": "michigan", "mn": "minnesota", "ms": "mississippi",
    "mo": "missouri", "mt": "montana", "ne": "nebraska", "nv": "nevada", "nh": "new hampshire",
    "nj": "new jersey", "nm": "new mexico", "ny": "new york", "nc": "north carolina",
    "nd": "north dakota", "oh": "ohio", "ok": "oklahoma", "or": "oregon", "pa": "pennsylvania",
    "ri": "rhode island", "sc": "south carolina", "sd": "south dakota", "tn": "tennessee",
    "tx": "texas", "ut": "utah", "vt": "vermont", "va": "virginia", "wa": "washington",
    "wv": "west virginia", "wi": "wisconsin", "wy": "wyoming", "dc": "district of columbia",
}


async def _get_json(client: httpx.AsyncClient, url: str, params: dict, headers: Optional[dict] = None) -> dict:
    # One retry: a kept-open connection can be dead (after the machine sleeps, say),
    # and one dropped request should not cost the user their answer.
    for attempt in (1, 2):
        try:
            resp = await client.get(url, params=params, headers=headers)
            resp.raise_for_status()
            return resp.json()
        except (httpx.TransportError, httpx.HTTPStatusError) as e:
            retryable = isinstance(e, httpx.TransportError) or e.response.status_code >= 500
            if attempt == 2 or not retryable:
                raise


async def _search_places(client: httpx.AsyncClient, name: str) -> list:
    data = await _get_json(client, _GEOCODE_URL, {"name": name, "count": 10, "language": "en"})
    return data.get("results") or []


def _pick(places: list, hint: str) -> dict:
    hint = hint.strip(" .,").lower()
    hint = _US_STATES.get(hint, hint)
    if hint:
        for place in places:
            fields = (place.get("admin1"), place.get("country"), place.get("country_code"))
            if any(f and f.lower() == hint for f in fields):
                return place
    return places[0]


async def _geocode(client: httpx.AsyncClient, location: str) -> Optional[dict]:
    # The geocoder matches on the city name alone, so "Atlanta, Georgia" has to be
    # searched as "Atlanta" and the rest used to pick among the matches.
    name, comma, rest = location.partition(",")
    name = name.strip()
    places = await _search_places(client, name)
    if places:
        return _pick(places, rest)
    # "Mount Vernon wa", "Paris France": no comma, so the region is the last word or two
    if not comma:
        words = name.split()
        for cut in (1, 2):
            if len(words) <= cut:
                break
            places = await _search_places(client, " ".join(words[:-cut]))
            if places:
                return _pick(places, " ".join(words[-cut:]))
    return None


def _met_code(symbol: Optional[str]) -> Optional[int]:
    if not symbol:
        return None
    if "thunder" in symbol:
        return 95
    return _MET_SYMBOLS.get(symbol.split("_")[0])


async def _met_forecast(client: httpx.AsyncClient, place: dict, imperial: bool) -> dict:
    """MET Norway's forecast in the shape of an Open-Meteo answer, so the rest reads it the same way."""
    data = await _get_json(client, _MET_URL, {
        # More than four decimals is refused
        "lat": round(place["latitude"], 4),
        "lon": round(place["longitude"], 4),
    }, headers=_MET_HEADERS)
    series = data["properties"]["timeseries"]
    tz_name = place.get("timezone") or "UTC"
    try:
        tz = ZoneInfo(tz_name)
    except Exception:
        tz, tz_name = ZoneInfo("UTC"), "UTC"

    def temp(c: float) -> float:
        return c * 9 / 5 + 32 if imperial else c

    def symbol_of(entry: dict, *spans: str) -> Optional[str]:
        for span in spans:
            symbol = (entry["data"].get(span) or {}).get("summary", {}).get("symbol_code")
            if symbol:
                return symbol
        return None

    # MET lists the hour now under way first
    first = series[0]
    at = datetime.fromisoformat(first["time"].replace("Z", "+00:00")).astimezone(tz)
    details = first["data"]["instant"]["details"]
    symbol = symbol_of(first, "next_1_hours", "next_6_hours")
    if symbol and symbol.endswith("_night"):
        is_day = 0
    elif symbol and "_" in symbol:
        is_day = 1
    else:
        # Cloud and rain symbols do not say, so go by the local hour
        is_day = int(6 <= at.hour < 18)
    wind_ms = details.get("wind_speed", 0.0)

    # Group the hours by local date. Today only has the hours still to come, so its
    # low can read a little high late in the day.
    days: dict[str, dict] = {}
    for entry in series:
        when = datetime.fromisoformat(entry["time"].replace("Z", "+00:00")).astimezone(tz)
        day = days.setdefault(when.date().isoformat(), {"temps": [], "symbols": [], "rain": []})
        if len(days) > 3:
            del days[when.date().isoformat()]
            break
        instant = entry["data"]["instant"]["details"]
        if "air_temperature" in instant:
            day["temps"].append(instant["air_temperature"])
        six = (entry["data"].get("next_6_hours") or {}).get("details", {})
        day["temps"] += [six[k] for k in ("air_temperature_max", "air_temperature_min") if k in six]
        code = _met_code(symbol_of(entry, "next_6_hours", "next_1_hours"))
        if code is not None:
            # The one nearest midday stands for the day
            day["symbols"].append((abs(when.hour - 12), code))
        if "probability_of_precipitation" in six:
            day["rain"].append(six["probability_of_precipitation"])

    dates = [d for d, v in days.items() if v["temps"]]
    return {
        # Their terms ask for credit, so the answer links to them, not to Open-Meteo
        "source": MET_SOURCE_URL,
        "timezone": tz_name,
        "utc_offset_seconds": int(at.utcoffset().total_seconds()),
        "current": {
            "time": at.strftime("%Y-%m-%dT%H:%M"),
            "temperature_2m": temp(details["air_temperature"]),
            "apparent_temperature": temp(details.get("apparent_air_temperature", details["air_temperature"])),
            "relative_humidity_2m": details.get("relative_humidity", 0.0),
            "weather_code": _met_code(symbol) if _met_code(symbol) is not None else 3,
            "wind_speed_10m": wind_ms * (2.23694 if imperial else 3.6),
            "is_day": is_day,
        },
        "daily": {
            "time": dates,
            "temperature_2m_max": [temp(max(days[d]["temps"])) for d in dates],
            "temperature_2m_min": [temp(min(days[d]["temps"])) for d in dates],
            "weather_code": [min(days[d]["symbols"])[1] if days[d]["symbols"] else 3 for d in dates],
            # Only given for some regions, mostly the Nordic countries
            "precipitation_probability_max": [max(days[d]["rain"]) if days[d]["rain"] else None for d in dates],
        },
    }


async def _forecast(client: httpx.AsyncClient, place: dict, imperial: bool) -> dict:
    """Open-Meteo's forecast, or MET Norway's when Open-Meteo is refusing or down."""
    global _open_meteo_resting_until
    if time.monotonic() >= _open_meteo_resting_until:
        try:
            return await _get_json(client, _FORECAST_URL, {
                "latitude": place["latitude"],
                "longitude": place["longitude"],
                "current": "temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day",
                "daily": "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
                "temperature_unit": "fahrenheit" if imperial else "celsius",
                "wind_speed_unit": "mph" if imperial else "kmh",
                "timezone": "auto",
                "forecast_days": 3,
            })
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 429:
                _open_meteo_resting_until = time.monotonic() + _REST_AFTER_429
            logger.warning("open_meteo_failed status=%s, using MET Norway", e.response.status_code)
        except httpx.TransportError as e:
            logger.warning("open_meteo_failed error=%s, using MET Norway", e)
    return await _met_forecast(client, place, imperial)


async def lookup(location: str, region: str = "us-en") -> Optional[dict]:
    """Return {"place": ..., "report": ...} for a place, or None if it cannot be found."""
    location = location.strip()
    if not location:
        return None
    key = f"{location.lower()}:{region}"
    cached = _cache.get(key)
    if cached is not MISSING:
        return cached

    client = http_client()
    place = await _geocode(client, location)
    if not place:
        return None

    imperial = place.get("country_code") in _FAHRENHEIT_COUNTRIES
    data = await _forecast(client, place, imperial)
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

    # The card above the reply. Unlike the clock it is a snapshot, so it carries the time it was read.
    offset = timedelta(seconds=data.get("utc_offset_seconds") or 0)
    observed = datetime.fromisoformat(now["time"]).replace(tzinfo=timezone(offset))
    widget = {
        "kind": "weather",
        "place": place.get("name") or place_name,
        # "Tokyo, Tokyo" reads as a mistake, so a region named like the city is left out
        "region": next((r for r in (place.get("admin1"), place.get("country")) if r and r != place.get("name")), ""),
        "unit": "F" if imperial else "C",
        "temp": round(now["temperature_2m"]),
        "feels": round(now["apparent_temperature"]),
        "code": now["weather_code"],
        "condition": _describe(now["weather_code"]).capitalize(),
        "day": bool(now.get("is_day", 1)),
        "humidity": round(now["relative_humidity_2m"]),
        "wind": f"{round(now['wind_speed_10m'])} {wind}",
        "observed": observed.isoformat(),
        "tz": data.get("timezone") or "UTC",
        "days": [
            {
                "date": day,
                "high": round(daily["temperature_2m_max"][i]),
                "low": round(daily["temperature_2m_min"][i]),
                "code": daily["weather_code"][i],
                "rain": None if daily["precipitation_probability_max"][i] is None
                else round(daily["precipitation_probability_max"][i]),
            }
            for i, day in enumerate(daily["time"])
        ],
    }

    result = {
        "place": place_name, "report": "\n".join(lines), "widget": widget,
        "source": data.get("source", SOURCE_URL),
    }
    _cache.set(key, result)
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
    return json.dumps({"place": result["place"], "report": result["report"], "source": result["source"]})
