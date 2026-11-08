"""Currency conversion at the European Central Bank's daily reference rates, from
Frankfurter (free, no API key). The model cannot know today's rate, so it gets it here.

Reads "$100 in euros", "100 usd to eur", "50 pounds in yen", "usd to eur exchange rate".
"""
import json
import re
from datetime import datetime
from typing import Optional

from ._shared import MISSING, TTLCache, http_client
from .calculator import format_number

DEFINITION = {
    "type": "function",
    "function": {
        "name": "convert_currency",
        "description": (
            "Convert money between currencies at today's exchange rate. Use it for any question about "
            "exchange rates or what an amount is worth in another currency."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "amount": {"type": "number", "description": "The amount of money, 1 for just the rate"},
                "from_currency": {"type": "string", "description": "Currency code or name, e.g. 'USD' or 'dollars'"},
                "to_currency": {"type": "string", "description": "Currency code or name, e.g. 'EUR' or 'yen'"},
            },
            "required": ["amount", "from_currency", "to_currency"],
        },
    },
}

SOURCE_URL = "https://frankfurter.dev/"
_RATES_URL = "https://api.frankfurter.dev/v1/latest"

# The currencies the European Central Bank publishes rates for
_CODES = {
    "AUD", "BRL", "CAD", "CHF", "CNY", "CZK", "DKK", "EUR", "GBP", "HKD", "HUF", "IDR", "ILS", "INR", "ISK",
    "JPY", "KRW", "MXN", "MYR", "NOK", "NZD", "PHP", "PLN", "RON", "SEK", "SGD", "THB", "TRY", "USD", "ZAR",
}
_NAMES = {
    "USD": ["$", "dollar", "dollars", "buck", "bucks", "us dollar", "us dollars", "american dollars"],
    "EUR": ["€", "euro", "euros"],
    "GBP": ["£", "pound", "pounds", "british pound", "british pounds", "quid", "sterling", "pounds sterling"],
    "JPY": ["¥", "yen", "japanese yen"],
    "CNY": ["yuan", "rmb", "renminbi", "chinese yuan"],
    "INR": ["₹", "rupee", "rupees", "indian rupee", "indian rupees"],
    "MXN": ["peso", "pesos", "mexican peso", "mexican pesos"],
    "CAD": ["canadian dollar", "canadian dollars"],
    "AUD": ["australian dollar", "australian dollars", "aussie dollar", "aussie dollars"],
    "NZD": ["new zealand dollar", "new zealand dollars"],
    "HKD": ["hong kong dollar", "hong kong dollars"],
    "SGD": ["singapore dollar", "singapore dollars"],
    "CHF": ["franc", "francs", "swiss franc", "swiss francs"],
    "KRW": ["won", "korean won", "south korean won"],
    "BRL": ["real", "reais", "brazilian real", "brazilian reais"],
    "ZAR": ["rand", "south african rand"],
    "TRY": ["lira", "turkish lira"],
    "SEK": ["krona", "kronor", "swedish krona", "swedish kronor"],
    "NOK": ["krone", "norwegian krone", "norwegian kroner"],
    "DKK": ["danish krone", "danish kroner"],
    "PLN": ["zloty", "złoty", "zlotys", "polish zloty"],
    "THB": ["baht", "thai baht"],
    "ILS": ["shekel", "shekels", "israeli shekel", "israeli shekels"],
    "HUF": ["forint", "forints", "hungarian forint"],
    "CZK": ["koruna", "czech koruna"],
    "MYR": ["ringgit", "malaysian ringgit"],
    "IDR": ["rupiah", "indonesian rupiah"],
    "RON": ["leu", "lei", "romanian leu"],
    "PHP": ["philippine peso", "philippine pesos"],
    "ISK": ["icelandic krona", "icelandic króna"],
}
# What the card calls each currency
_TITLES = {
    "AUD": "Australian Dollar", "BRL": "Brazilian Real", "CAD": "Canadian Dollar", "CHF": "Swiss Franc",
    "CNY": "Chinese Yuan", "CZK": "Czech Koruna", "DKK": "Danish Krone", "EUR": "Euro", "GBP": "British Pound",
    "HKD": "Hong Kong Dollar", "HUF": "Hungarian Forint", "IDR": "Indonesian Rupiah", "ILS": "Israeli Shekel",
    "INR": "Indian Rupee", "ISK": "Icelandic Krona", "JPY": "Japanese Yen", "KRW": "South Korean Won",
    "MXN": "Mexican Peso", "MYR": "Malaysian Ringgit", "NOK": "Norwegian Krone", "NZD": "New Zealand Dollar",
    "PHP": "Philippine Peso", "PLN": "Polish Zloty", "RON": "Romanian Leu", "SEK": "Swedish Krona",
    "SGD": "Singapore Dollar", "THB": "Thai Baht", "TRY": "Turkish Lira", "USD": "US Dollar",
    "ZAR": "South African Rand",
}
_ALIASES = {code.lower(): code for code in _CODES}
for _code, _names in _NAMES.items():
    for _name in _names:
        _ALIASES[_name] = _code
_LONGEST = max(len(a.split()) for a in _ALIASES)
# Currencies counted in whole units, with no cents
_NO_CENTS = {"JPY", "KRW", "HUF", "IDR", "ISK"}

_TOKEN_RE = re.compile(r"\d+(?:\.\d+)?|[$€£¥₹]|[a-zł]+")
_RATE_RE = re.compile(r"\bexchange rates?\b|\bcurrency conver", re.IGNORECASE)

# The reference rates change once a day
_cache = TTLCache(ttl=3600.0)


def _tokens(text: str) -> list[str]:
    return _TOKEN_RE.findall(re.sub(r"(?<=\d),(?=\d{3}\b)", "", text.lower()))


def _currency_at(tokens: list[str], i: int) -> tuple[Optional[str], int]:
    for size in range(min(_LONGEST, len(tokens) - i), 0, -1):
        code = _ALIASES.get(" ".join(tokens[i:i + size]))
        if code:
            return code, i + size
    return None, i


def _is_number(token: str) -> bool:
    return bool(re.fullmatch(r"\d+(?:\.\d+)?", token))


def parse(text: str) -> Optional[tuple[float, str, str]]:
    """(amount, from code, to code) from "$100 in euros" or "usd to eur exchange rate", or None."""
    tokens = _tokens(text)
    for i, token in enumerate(tokens):
        if not _is_number(token):
            continue
        amount = float(token)
        # "$100", or "100 dollars"
        source = _ALIASES.get(tokens[i - 1]) if i > 0 and tokens[i - 1] in "$€£¥₹" else None
        j = i + 1
        if not source:
            source, j = _currency_at(tokens, i + 1)
        if not source:
            continue
        if j < len(tokens) and tokens[j] in {"is", "are"}:
            j += 1
            if tokens[j:j + 2] == ["how", "much"]:
                j += 2
        if j >= len(tokens) or tokens[j] not in {"to", "in", "into", "as"}:
            continue
        target, _ = _currency_at(tokens, j + 1)
        if target and target != source:
            return amount, source, target
    # No amount: "usd to eur exchange rate", "exchange rate from dollars to yen"
    if _RATE_RE.search(text):
        found = [code for k in range(len(tokens)) if (code := _currency_at(tokens, k)[0])]
        unique = list(dict.fromkeys(found))
        if len(unique) >= 2:
            return 1.0, unique[0], unique[1]
    return None


async def rate(source: str, target: str) -> tuple[float, str]:
    """The rate from one currency to another and the date it was published."""
    data = _cache.get(source)
    if data is MISSING:
        resp = await http_client().get(_RATES_URL, params={"base": source})
        resp.raise_for_status()
        data = resp.json()
        _cache.set(source, data)
    return float(data["rates"][target]), data["date"]


def _figure(amount: float, code: str) -> str:
    return f"{round(amount):,}" if code in _NO_CENTS else f"{amount:,.2f}"


def _money(amount: float, code: str) -> str:
    return f"{_figure(amount, code)} {code}"


async def describe(amount: float, source: str, target: str) -> tuple[str, dict]:
    """The conversion for the model, and the card the chat shows above the reply."""
    per_unit, published = await rate(source, target)
    each = format_number(float(f"{per_unit:.6g}"))
    line = (
        f"{_money(amount, source)} = {_money(amount * per_unit, target)} "
        f"(1 {source} = {each} {target}, European Central Bank reference rate published {published})"
    )
    try:
        day = datetime.strptime(published, "%Y-%m-%d")
        when = f"{day:%b} {day.day}, {day.year}"
    except ValueError:
        when = published
    widget = {
        "kind": "conversion",
        "title": f"{_TITLES.get(source, source)} to {_TITLES.get(target, target)}",
        "from": _money(amount, source),
        "value": _figure(amount * per_unit, target),
        "unit": target,
        "note": f"1 {source} = {each} {target} · Rate from {when}",
    }
    return line, widget


def should_activate(text: str, words: set) -> bool:
    return parse(text) is not None or bool(_RATE_RE.search(text))


async def proactive(text: str, ctx: dict) -> Optional[tuple[str, dict]]:
    found = parse(text)
    if not found:
        return None
    try:
        line, widget = await describe(*found)
    except Exception:
        return None
    return "Currency conversion: " + line, widget


async def async_execute(arguments: dict) -> str:
    try:
        amount = float(arguments.get("amount") or 1)
    except (TypeError, ValueError):
        amount = 1.0
    source, _ = _currency_at(_tokens(str(arguments.get("from_currency") or "")), 0)
    target, _ = _currency_at(_tokens(str(arguments.get("to_currency") or "")), 0)
    if not source or not target:
        return json.dumps({"error": "Unknown currency. Rates are available for: " + ", ".join(sorted(_CODES))})
    if source == target:
        return json.dumps({"result": _money(amount, source)})
    try:
        line, _ = await describe(amount, source, target)
        return json.dumps({"result": line, "source": SOURCE_URL})
    except Exception as e:
        return json.dumps({"error": f"Exchange rate lookup failed: {e}. Do not invent a rate."})
