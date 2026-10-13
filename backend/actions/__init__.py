import re
from . import weather as _weather
from . import web_search as _web_search

# Register action modules here when adding new tools
_ACTIONS = [_web_search, _weather]

_REGISTRY = {mod.DEFINITION["function"]["name"]: mod for mod in _ACTIONS}


def is_known_tool(name: str) -> bool:
    return name in _REGISTRY


async def execute_tool(name: str, arguments: dict) -> str:
    mod = _REGISTRY.get(name)
    if mod is None:
        raise ValueError(f"Unknown tool: {name}")
    return await mod.async_execute(arguments)


def get_active_tools(text: str) -> "list | None":
    words = set(re.sub(r"[^\w\s]", "", text.lower()).split())
    matched = []
    for mod in _ACTIONS:
        activate = mod.should_activate(text, words) if hasattr(mod, "should_activate") else bool(words & mod.KEYWORDS)
        if activate:
            matched.append(mod.DEFINITION)
    return matched or None
