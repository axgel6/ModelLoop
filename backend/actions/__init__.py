import re
from . import get_time as _get_time

# Register action modules here when adding new tools
_ACTIONS = [_get_time]

TOOL_DEFINITIONS = [mod.DEFINITION for mod in _ACTIONS]

_REGISTRY = {mod.DEFINITION["function"]["name"]: mod for mod in _ACTIONS}


async def execute_tool(name: str, arguments: dict) -> str:
    mod = _REGISTRY.get(name)
    if mod is None:
        raise ValueError(f"Unknown tool: {name}")
    return mod.execute(arguments)


def get_active_tools(text: str) -> "list | None":
    words = set(re.sub(r"[^\w\s]", "", text.lower()).split())
    matched = [mod.DEFINITION for mod in _ACTIONS if words & mod.KEYWORDS]
    return matched or None
