import asyncio
import logging
import re

from . import calculator as _calculator
from . import clock as _clock
from . import currency as _currency
from . import dictionary as _dictionary
from . import units as _units
from . import weather as _weather
from . import web_search as _web_search

logger = logging.getLogger(__name__)

# Register action modules here when adding new tools
_ACTIONS = [_web_search, _weather, _calculator, _units, _clock, _currency, _dictionary]

# Tools that can answer from the message alone, before the model replies. Small models
# often skip a tool they are offered, so these do not wait to be called.
_PROACTIVE = [_calculator, _units, _clock, _currency, _dictionary]

_REGISTRY = {mod.DEFINITION["function"]["name"]: mod for mod in _ACTIONS}


def is_known_tool(name: str) -> bool:
    return name in _REGISTRY


async def execute_tool(name: str, arguments: dict) -> str:
    mod = _REGISTRY.get(name)
    if mod is None:
        raise ValueError(f"Unknown tool: {name}")
    return await mod.async_execute(arguments)


def _words(text: str) -> set:
    return set(re.sub(r"[^\w\s]", "", text.lower()).split())


def get_active_tools(text: str) -> "list | None":
    words = _words(text)
    matched = []
    for mod in _ACTIONS:
        activate = mod.should_activate(text, words) if hasattr(mod, "should_activate") else bool(words & mod.KEYWORDS)
        if activate:
            matched.append(mod.DEFINITION)
    return matched or None


async def run_proactive(text: str, ctx: dict) -> tuple[dict[str, str], list[dict]]:
    """Answers the tools could work out from the message itself, by tool name, and the
    widgets (cards such as a clock) the chat shows above the reply.

    ctx carries "user_tz", the browser's timezone. A tool that cannot read the message, or
    whose lookup fails, gives nothing, and the model can still call it with arguments.
    A tool returns its answer, or (answer, widget) when it has a card to show.
    """
    words = _words(text)
    mods = [m for m in _PROACTIVE if m.should_activate(text, words)]
    if not mods:
        return {}, []
    results = await asyncio.gather(*(m.proactive(text, ctx) for m in mods), return_exceptions=True)
    answers: dict[str, str] = {}
    widgets: list[dict] = []
    for mod, result in zip(mods, results):
        name = mod.DEFINITION["function"]["name"]
        if isinstance(result, Exception):
            logger.warning("proactive_tool_failed tool=%s error=%s", name, result)
            continue
        if isinstance(result, tuple):
            result, widget = result
            widgets.append(widget)
        if result:
            answers[name] = result
    return answers, widgets
