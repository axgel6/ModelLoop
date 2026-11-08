"""Unit conversion from a fixed table: length, weight, volume, temperature, speed, area,
data, time and pressure. No network, no guessing.

Reads "5 miles to km", "70 f in c", "180 cm in feet", "how many ounces in a pound".
"""
import json
import math
import re
from typing import Optional

from .calculator import format_number

DEFINITION = {
    "type": "function",
    "function": {
        "name": "convert_units",
        "description": (
            "Convert a measurement between units of length, weight, volume, temperature, speed, area, "
            "data size, time or pressure. Use it instead of converting yourself."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "value": {"type": "number", "description": "The amount to convert"},
                "from_unit": {"type": "string", "description": "The unit it is in, e.g. 'miles'"},
                "to_unit": {"type": "string", "description": "The unit wanted, e.g. 'km'"},
            },
            "required": ["value", "from_unit", "to_unit"],
        },
    },
}

# key: (kind, size in the kind's base unit, singular, plural, other names)
_UNITS = {
    # length, in meters
    "mm": ("length", 0.001, "millimeter", "millimeters", ["mm", "millimetre", "millimetres"]),
    "cm": ("length", 0.01, "centimeter", "centimeters", ["cm", "centimetre", "centimetres"]),
    "m": ("length", 1.0, "meter", "meters", ["m", "metre", "metres"]),
    "km": ("length", 1000.0, "kilometer", "kilometers", ["km", "kms", "kilometre", "kilometres", "k"]),
    "in": ("length", 0.0254, "inch", "inches", ["in", "inch", '"']),
    "ft": ("length", 0.3048, "foot", "feet", ["ft", "foot", "'"]),
    "yd": ("length", 0.9144, "yard", "yards", ["yd", "yds"]),
    "mi": ("length", 1609.344, "mile", "miles", ["mi"]),
    "nmi": ("length", 1852.0, "nautical mile", "nautical miles", ["nmi"]),
    # weight, in kilograms
    "mg": ("weight", 1e-6, "milligram", "milligrams", ["mg"]),
    "g": ("weight", 0.001, "gram", "grams", ["g", "gr", "gramme", "grammes"]),
    "kg": ("weight", 1.0, "kilogram", "kilograms", ["kg", "kgs", "kilo", "kilos"]),
    "tonne": ("weight", 1000.0, "metric ton", "metric tons", ["tonne", "tonnes", "metric ton"]),
    "oz": ("weight", 0.028349523125, "ounce", "ounces", ["oz"]),
    "lb": ("weight", 0.45359237, "pound", "pounds", ["lb", "lbs"]),
    "st": ("weight", 6.35029318, "stone", "stone", ["st", "stones"]),
    "ton": ("weight", 907.18474, "ton", "tons", ["short ton", "short tons"]),
    # volume, in liters
    "ml": ("volume", 0.001, "milliliter", "milliliters", ["ml", "millilitre", "millilitres"]),
    "l": ("volume", 1.0, "liter", "liters", ["l", "litre", "litres", "ltr"]),
    "tsp": ("volume", 0.00492892159375, "teaspoon", "teaspoons", ["tsp", "tsps"]),
    "tbsp": ("volume", 0.01478676478125, "tablespoon", "tablespoons", ["tbsp", "tbsps", "tbs"]),
    "floz": ("volume", 0.0295735295625, "fluid ounce", "fluid ounces", ["fl oz", "floz"]),
    "cup": ("volume", 0.2365882365, "cup", "cups", []),
    "pt": ("volume", 0.473176473, "pint", "pints", ["pt"]),
    "qt": ("volume", 0.946352946, "quart", "quarts", ["qt"]),
    "gal": ("volume", 3.785411784, "gallon", "gallons", ["gal", "gals"]),
    "m3": ("volume", 1000.0, "cubic meter", "cubic meters", ["m3", "m³", "cubic metre", "cubic metres"]),
    # speed, in meters per second
    "mps": ("speed", 1.0, "meter per second", "meters per second", ["m/s"]),
    "kph": ("speed", 1 / 3.6, "kilometer per hour", "kilometers per hour", ["kph", "km/h", "kmh", "kmph", "kilometres per hour"]),
    "mph": ("speed", 0.44704, "mile per hour", "miles per hour", ["mph"]),
    "knot": ("speed", 1852 / 3600, "knot", "knots", ["kn", "kt", "kts"]),
    # area, in square meters
    "m2": ("area", 1.0, "square meter", "square meters", ["m2", "m²", "sq m", "square metre", "square metres"]),
    "km2": ("area", 1e6, "square kilometer", "square kilometers", ["km2", "km²", "sq km", "square kilometre", "square kilometres"]),
    "ft2": ("area", 0.09290304, "square foot", "square feet", ["ft2", "ft²", "sq ft", "sqft"]),
    "mi2": ("area", 2589988.110336, "square mile", "square miles", ["mi2", "mi²", "sq mi"]),
    "acre": ("area", 4046.8564224, "acre", "acres", ["ac"]),
    "ha": ("area", 10000.0, "hectare", "hectares", ["ha"]),
    # data, in bytes (decimal, as drives and networks count)
    "byte": ("data", 1.0, "byte", "bytes", []),
    "kb": ("data", 1e3, "kilobyte", "kilobytes", ["kb"]),
    "mb": ("data", 1e6, "megabyte", "megabytes", ["mb"]),
    "gb": ("data", 1e9, "gigabyte", "gigabytes", ["gb", "gig", "gigs"]),
    "tb": ("data", 1e12, "terabyte", "terabytes", ["tb"]),
    # time, in seconds
    "s": ("time", 1.0, "second", "seconds", ["sec", "secs"]),
    "min": ("time", 60.0, "minute", "minutes", ["min", "mins"]),
    "h": ("time", 3600.0, "hour", "hours", ["hr", "hrs"]),
    "day": ("time", 86400.0, "day", "days", []),
    "week": ("time", 604800.0, "week", "weeks", ["wk", "wks"]),
    "year": ("time", 31557600.0, "year", "years", ["yr", "yrs"]),
    # pressure, in pascals
    "psi": ("pressure", 6894.757293168, "psi", "psi", []),
    "bar": ("pressure", 100000.0, "bar", "bar", []),
    "kpa": ("pressure", 1000.0, "kilopascal", "kilopascals", ["kpa"]),
    "atm": ("pressure", 101325.0, "atmosphere", "atmospheres", ["atm"]),
    # temperature, converted by formula
    "c": ("temperature", None, "°C", "°C", ["c", "°c", "celsius", "centigrade"]),
    "f": ("temperature", None, "°F", "°F", ["f", "°f", "fahrenheit"]),
    "k_temp": ("temperature", None, "kelvin", "kelvin", ["kelvin", "kelvins"]),
}

_ALIASES: dict[str, str] = {}
for _key, (_kind, _size, _one, _many, _others) in _UNITS.items():
    for _name in [_one, _many, *_others]:
        _ALIASES.setdefault(_name.lower(), _key)
# "k" alone means kilometers in "5k", not kelvin
_ALIASES["k"] = "km"

_LONGEST_ALIAS = max(len(a.split()) for a in _ALIASES)
_CONNECTORS = {"to", "in", "into", "as"}
_FILLER = {"degree", "degrees", "a", "an", "one", "the"}
_NUMBER = r"-?\d+(?:\.\d+)?(?:\s*/\s*\d+)?"
_TOKEN_RE = re.compile(rf"{_NUMBER}|[a-z°²³/\"']+")

_TO_BASE = {"c": lambda v: v, "f": lambda v: (v - 32) * 5 / 9, "k_temp": lambda v: v - 273.15}
_FROM_BASE = {"c": lambda v: v, "f": lambda v: v * 9 / 5 + 32, "k_temp": lambda v: v + 273.15}


def _number(token: str) -> Optional[float]:
    if "/" in token:
        top, _, bottom = token.partition("/")
        return float(top) / float(bottom) if float(bottom) else None
    try:
        return float(token)
    except ValueError:
        return None


def _unit_at(tokens: list[str], i: int) -> tuple[Optional[str], int]:
    """The unit named at tokens[i], trying the longest names first, and the index after it."""
    while i < len(tokens) and tokens[i] in _FILLER:
        i += 1
    for size in range(min(_LONGEST_ALIAS, len(tokens) - i), 0, -1):
        key = _ALIASES.get(" ".join(tokens[i:i + size]))
        if key:
            return key, i + size
    return None, i


def convert(value: float, from_key: str, to_key: str) -> Optional[float]:
    kind, size, *_ = _UNITS[from_key]
    to_kind, to_size, *_ = _UNITS[to_key]
    if kind != to_kind or from_key == to_key:
        return None
    if kind == "temperature":
        return _FROM_BASE[to_key](_TO_BASE[from_key](value))
    return value * size / to_size


def _amount(value: float, key: str) -> str:
    """"5 miles", "1 mile", or "70°F" with the degree sign against the number."""
    _, _, one, many, _ = _UNITS[key]
    name = one if abs(value) == 1 else many
    return f"{format_number(value)}{'' if name.startswith('°') else ' '}{name}"


def describe(value: float, from_key: str, to_key: str) -> Optional[tuple[str, dict]]:
    """The conversion for the model, and the card the chat shows above the reply."""
    result = convert(value, from_key, to_key)
    if result is None:
        return None
    result = float(f"{result:.6g}")
    line = f"{_amount(value, from_key)} = {_amount(result, to_key)}"
    note = ""
    # Heights read better in feet and inches
    if to_key == "ft" and 0 < result < 10:
        feet = math.floor(result)
        inches = round((result - feet) * 12, 1)
        if inches == 12:
            feet, inches = feet + 1, 0
        note = f"{feet} ft {format_number(inches)} in"
        line += f" ({note})"
    kind, _, one, many, _ = _UNITS[to_key]
    widget = {
        "kind": "conversion",
        "title": kind.capitalize(),
        "from": _amount(value, from_key),
        # Two decimals on the card: the reply and the model have the full figure
        "value": format_number(round(result, 2) if abs(result) >= 1 else float(f"{result:.3g}")),
        "unit": one if abs(result) == 1 else many,
        "note": note,
    }
    return line, widget


def _tokens(text: str) -> list[str]:
    text = text.lower().replace(",", "")
    # "5km", "70°f": split the number from the unit
    text = re.sub(rf"({_NUMBER})(?=[a-z°])", r"\1 ", text)
    return _TOKEN_RE.findall(text)


def parse(text: str) -> Optional[tuple[float, str, str]]:
    """(value, from unit, to unit) from "5 miles to km" or "how many ounces in a pound", or None."""
    tokens = _tokens(text)
    for i, token in enumerate(tokens):
        value = _number(token) if re.fullmatch(_NUMBER, token) else None
        if value is None:
            continue
        from_key, j = _unit_at(tokens, i + 1)
        if not from_key:
            continue
        # "5 km is how many miles"
        if j < len(tokens) and tokens[j] in {"is", "are", "equals"}:
            j += 1
            if tokens[j:j + 2] == ["how", "many"]:
                j += 2
        elif j < len(tokens) and tokens[j] in _CONNECTORS:
            j += 1
        else:
            continue
        to_key, _ = _unit_at(tokens, j)
        if to_key and convert(value, from_key, to_key) is not None:
            return value, from_key, to_key
    # "how many ounces in a pound", "how many cups are in 2 quarts"
    for i in range(len(tokens) - 1):
        if tokens[i:i + 2] != ["how", "many"]:
            continue
        to_key, j = _unit_at(tokens, i + 2)
        if not to_key:
            continue
        if j < len(tokens) and tokens[j] in {"are", "is"}:
            j += 1
        if j >= len(tokens) or tokens[j] not in {"in", "per"}:
            continue
        j += 1
        value = 1.0
        if j < len(tokens) and re.fullmatch(_NUMBER, tokens[j]):
            value = _number(tokens[j]) or 1.0
            j += 1
        from_key, _ = _unit_at(tokens, j)
        if from_key and convert(value, from_key, to_key) is not None:
            return value, from_key, to_key
    return None


def should_activate(text: str, words: set) -> bool:
    return parse(text) is not None


async def proactive(text: str, ctx: dict) -> Optional[tuple[str, dict]]:
    found = parse(text)
    if not found:
        return None
    described = describe(*found)
    if not described:
        return None
    line, widget = described
    return f"Unit conversion: {line}", widget


async def async_execute(arguments: dict) -> str:
    try:
        value = float(arguments.get("value"))
    except (TypeError, ValueError):
        return json.dumps({"error": "No number given to convert."})
    from_key, _ = _unit_at(_tokens(str(arguments.get("from_unit") or "")), 0)
    to_key, _ = _unit_at(_tokens(str(arguments.get("to_unit") or "")), 0)
    described = describe(value, from_key, to_key) if from_key and to_key else None
    if not described:
        return json.dumps({"error": "Those units are unknown or cannot be converted into each other."})
    return json.dumps({"result": described[0]})
