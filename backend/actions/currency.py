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
# Spanish names, read in either language
_NAMES_ES = {
    "USD": ["dólar", "dolar", "dólares", "dolares", "dólar estadounidense", "dólares estadounidenses",
            "dólar americano", "dólares americanos", "dolares americanos"],
    "EUR": ["euro", "euros"],
    "GBP": ["libra", "libras", "libra esterlina", "libras esterlinas"],
    "JPY": ["yen", "yenes", "yen japonés", "yenes japoneses"],
    "CNY": ["yuan", "yuanes", "yuan chino", "yuanes chinos"],
    "INR": ["rupia", "rupias", "rupia india", "rupias indias"],
    "MXN": ["peso mexicano", "pesos mexicanos"],
    "CAD": ["dólar canadiense", "dólares canadienses", "dolares canadienses"],
    "AUD": ["dólar australiano", "dólares australianos", "dolares australianos"],
    "NZD": ["dólar neozelandés", "dólares neozelandeses"],
    "HKD": ["dólar de hong kong", "dólares de hong kong"],
    "SGD": ["dólar de singapur", "dólares de singapur"],
    "CHF": ["franco", "francos", "franco suizo", "francos suizos"],
    "KRW": ["won coreano", "wones"],
    "BRL": ["real brasileño", "reales", "reales brasileños"],
    "ZAR": ["rand sudafricano"],
    "TRY": ["lira turca", "liras turcas"],
    "SEK": ["corona sueca", "coronas suecas"],
    "NOK": ["corona noruega", "coronas noruegas"],
    "DKK": ["corona danesa", "coronas danesas"],
    "PLN": ["esloti", "zloty polaco"],
    "THB": ["baht tailandés"],
    "ILS": ["séquel", "shekel israelí"],
    "PHP": ["peso filipino", "pesos filipinos"],
}
# What the card calls each currency when the app is in Spanish
_TITLES_ES = {
    "AUD": "Dólar australiano", "BRL": "Real brasileño", "CAD": "Dólar canadiense", "CHF": "Franco suizo",
    "CNY": "Yuan chino", "CZK": "Corona checa", "DKK": "Corona danesa", "EUR": "Euro", "GBP": "Libra esterlina",
    "HKD": "Dólar de Hong Kong", "HUF": "Forinto húngaro", "IDR": "Rupia indonesia", "ILS": "Séquel israelí",
    "INR": "Rupia india", "ISK": "Corona islandesa", "JPY": "Yen japonés", "KRW": "Won surcoreano",
    "MXN": "Peso mexicano", "MYR": "Ringgit malayo", "NOK": "Corona noruega", "NZD": "Dólar neozelandés",
    "PHP": "Peso filipino", "PLN": "Esloti polaco", "RON": "Leu rumano", "SEK": "Corona sueca",
    "SGD": "Dólar de Singapur", "THB": "Baht tailandés", "TRY": "Lira turca", "USD": "Dólar estadounidense",
    "ZAR": "Rand sudafricano",
}
_MONTHS_ES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"]

_ALIASES = {code.lower(): code for code in _CODES}
for _code, _names in [*_NAMES.items(), *_NAMES_ES.items()]:
    for _name in _names:
        _ALIASES[_name] = _code
_LONGEST = max(len(a.split()) for a in _ALIASES)
# Currencies counted in whole units, with no cents
_NO_CENTS = {"JPY", "KRW", "HUF", "IDR", "ISK"}

_TOKEN_RE = re.compile(r"\d+(?:\.\d+)?|[$€£¥₹]|[a-zà-ÿñł]+")
_RATE_RE = re.compile(
    r"\bexchange rates?\b|\bcurrency conver|\btipo de cambio\b|\bconversi[oó]n de (divisas?|monedas?)\b",
    re.IGNORECASE,
)
# "100 dollars to euros", "100 dólares a/en pesos"; "100 dollars is how much in yen", "100 dólares son cuántos pesos"
_CONNECTORS = {"to", "in", "into", "as", "a", "en"}
_IS = {"is", "are", "es", "son", "equivale", "equivalen"}
_HOW_MANY = {"cuántos", "cuantos", "cuántas", "cuantas", "cuánto", "cuanto"}

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
        if j < len(tokens) and tokens[j] in _IS:
            j += 1
            if tokens[j:j + 2] == ["how", "much"]:
                j += 2
            elif j < len(tokens) and tokens[j] in _HOW_MANY:
                # "son cuántos pesos": the currency comes straight after
                j += 1
                target, _ = _currency_at(tokens, j)
                if target and target != source:
                    return amount, source, target
                continue
        if j >= len(tokens) or tokens[j] not in _CONNECTORS:
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


async def describe(amount: float, source: str, target: str, language: str = "en") -> tuple[str, dict]:
    """The conversion for the model, and the card the chat shows above the reply (in language)."""
    per_unit, published = await rate(source, target)
    each = format_number(float(f"{per_unit:.6g}"))
    line = (
        f"{_money(amount, source)} = {_money(amount * per_unit, target)} "
        f"(1 {source} = {each} {target}, European Central Bank reference rate published {published})"
    )
    spanish = language == "es"
    try:
        day = datetime.strptime(published, "%Y-%m-%d")
        when = f"{day.day} {_MONTHS_ES[day.month - 1]} {day.year}" if spanish else f"{day:%b} {day.day}, {day.year}"
    except ValueError:
        when = published
    titles = _TITLES_ES if spanish else _TITLES
    widget = {
        "kind": "conversion",
        "title": f"{titles.get(source, source)} {'a' if spanish else 'to'} {titles.get(target, target)}",
        "from": _money(amount, source),
        "value": _figure(amount * per_unit, target),
        "unit": target,
        "note": f"1 {source} = {each} {target} · {'Tipo de cambio del' if spanish else 'Rate from'} {when}",
    }
    return line, widget


def should_activate(text: str, words: set) -> bool:
    return parse(text) is not None or bool(_RATE_RE.search(text))


async def proactive(text: str, ctx: dict) -> Optional[tuple[str, dict]]:
    found = parse(text)
    if not found:
        return None
    try:
        line, widget = await describe(*found, ctx.get("language") or "en")
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
