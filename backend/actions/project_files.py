"""The web studio's file tools: list, read, write, edit and delete a project's files.

Unlike the other actions these act on one project, so they are not in the registry.
The stream gives the model a Workspace, a copy of the project's files in memory. The
tools change only that copy, and the stream saves it with the reply when the turn
succeeds, so a turn that fails part way leaves the project as it was.
"""
import difflib
import json
import re
from typing import Optional

MAX_FILES = 40
MAX_FILE_CHARS = 200_000
# Repeated calls before the turn ends
MAX_REPEATS = 3
_CHANGING_TOOLS = {"write_file", "edit_file", "delete_file"}
# An edit that misses sends a file this small back whole, to retry from
RETURN_FILE_CHARS = 8_000
# How alike (0 to 1) lines must be to old_text to be offered as what the model meant
CLOSE_MATCH = 0.6
# What the preview can show: no images or fonts yet, since files are text
_ALLOWED_EXT = {".html", ".css", ".js", ".mjs", ".json", ".svg", ".txt", ".md"}
_PATH_RE = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9_.\-]*(/[A-Za-z0-9_][A-Za-z0-9_.\-]*)*$")
# Stylesheet and script links. Relative ones only: a URL with a scheme or // isn't the project's.
_LINK_RE = re.compile(r'<(?:link|script)\b[^>]*?\b(?:href|src)\s*=\s*["\'](?![a-z][a-z0-9+.-]*:|//)([^"\'?#]+)', re.I)

_PATH_PARAM = {"type": "string", "description": "File path in the project, e.g. 'index.html' or 'js/app.js'"}

DEFINITIONS = [
    {
        "type": "function",
        "function": {
            "name": "list_files",
            "description": "List the project's files with their sizes.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_file",
            "description": "Read one file's full contents. Use it before editing a file you have not seen.",
            "parameters": {"type": "object", "properties": {"path": _PATH_PARAM}, "required": ["path"]},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "write_file",
            "description": "Create a file, or replace a file's whole contents. For a small change to an existing file, use edit_file instead.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": _PATH_PARAM,
                    "content": {"type": "string", "description": "The complete file contents"},
                },
                "required": ["path", "content"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "edit_file",
            "description": (
                "Change part of a file: replace old_text, copied exactly from the file, with new_text. "
                "old_text must appear once, so include enough surrounding lines to make it unique."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "path": _PATH_PARAM,
                    "old_text": {"type": "string", "description": "The exact text to replace"},
                    "new_text": {"type": "string", "description": "The text to put in its place"},
                },
                "required": ["path", "old_text", "new_text"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "delete_file",
            "description": "Delete a file from the project.",
            "parameters": {"type": "object", "properties": {"path": _PATH_PARAM}, "required": ["path"]},
        },
    },
]

TOOL_NAMES = {d["function"]["name"] for d in DEFINITIONS}


def clean_path(raw) -> Optional[str]:
    """The path as stored, or None when it is not a safe relative path to a text file."""
    if not isinstance(raw, str):
        return None
    path = raw.strip().replace("\\", "/")
    while path.startswith("./"):
        path = path[2:]
    if len(path) > 200 or not _PATH_RE.match(path) or ".." in path.split("/"):
        return None
    dot = path.rfind(".")
    if dot == -1 or path[dot:].lower() not in _ALLOWED_EXT:
        return None
    return path


_CALL_START = re.compile(r'\{\s*"name"\s*:')
# \' is not a JSON escape, but models write it in file contents ("today\'s")
_BAD_QUOTE_ESCAPE = re.compile(r"(?<!\\)\\'")


def calls_in_text(text: str) -> list[dict]:
    """The file tool calls a model wrote as JSON in its reply instead of as tool calls, in order.

    Some models (the Qwen coders among them) do this, often several in one reply and with small
    JSON mistakes, so each {"name": ...} object is read on its own and forgivingly."""
    text = _BAD_QUOTE_ESCAPE.sub("'", text)
    decoder = json.JSONDecoder(strict=False)  # strict=False allows raw line breaks in strings
    calls, pos = [], 0
    while match := _CALL_START.search(text, pos):
        obj, end = _decode(decoder, text, match.start())
        pos = end if obj is not None else match.end()
        if not isinstance(obj, dict) or obj.get("name") not in TOOL_NAMES:
            continue
        args = obj.get("arguments", obj.get("parameters", {}))
        if isinstance(args, str):
            try:
                args = json.loads(args)
            except ValueError:
                args = {}
        calls.append({"function": {"name": obj["name"], "arguments": args if isinstance(args, dict) else {}}})
    return calls


def _decode(decoder: json.JSONDecoder, text: str, start: int):
    """(object, end) for the JSON object at `start`, or (None, start) when there isn't one.
    An object a model left unclosed is closed with up to three braces, where it stops: at the
    next call, a code fence or the end of the text."""
    try:
        return decoder.raw_decode(text, start)
    except ValueError:
        pass
    stops = [i for i in (text.find("```", start), _next_call(text, start)) if i != -1]
    stop = min(stops, default=len(text))
    piece = text[start:stop].rstrip()
    for missing in range(1, 4):
        try:
            obj, _ = decoder.raw_decode(piece + "}" * missing)
            return obj, stop
        except ValueError:
            continue
    return None, start


def _next_call(text: str, start: int) -> int:
    match = _CALL_START.search(text, start + 1)
    return match.start() if match else -1


def _loose_matches(content: str, old_text: str) -> list[tuple[int, int]]:
    """Where old_text appears in content when whitespace is ignored, as (start, end) spans
    of content, each running from the first to the last non-space character matched."""
    kept = [i for i, ch in enumerate(content) if not ch.isspace()]
    squeezed = "".join(content[i] for i in kept)
    needle = "".join(old_text.split())
    spans, at = [], squeezed.find(needle)
    while at != -1:
        spans.append((kept[at], kept[at + len(needle) - 1] + 1))
        at = squeezed.find(needle, at + 1)
    return spans


def _widen(content: str, old_text: str, start: int, end: int) -> tuple[int, int]:
    """A loose match's span, taking in the indentation before it and the line end after it
    when old_text has them, so new_text's own spacing replaces them instead of adding to it."""
    if old_text[:1].isspace():
        while start > 0 and content[start - 1] in " \t":
            start -= 1
    if old_text.endswith("\n"):
        while end < len(content) and content[end] in " \t\r":
            end += 1
        if end < len(content) and content[end] == "\n":
            end += 1
    return start, end


def _closest_lines(content: str, old_text: str) -> Optional[str]:
    """The run of lines in content most like old_text, with a line either side, or None when
    nothing is close enough to be the text the model meant."""
    lines = content.splitlines()
    want = [l.strip() for l in old_text.strip().splitlines()] or [""]
    size = len(want)
    if not lines or size > len(lines):
        return None
    target = "\n".join(want)
    matcher = difflib.SequenceMatcher(autojunk=False)
    matcher.set_seq2(target)
    best, best_at = 0.0, 0
    for i in range(len(lines) - size + 1):
        matcher.set_seq1("\n".join(l.strip() for l in lines[i:i + size]))
        if matcher.real_quick_ratio() <= best or matcher.quick_ratio() <= best:
            continue
        ratio = matcher.ratio()
        if ratio > best:
            best, best_at = ratio, i
    if best < CLOSE_MATCH:
        return None
    start, end = max(0, best_at - 1), min(len(lines), best_at + size + 1)
    return "\n".join(lines[start:end])


def _linked(html: str) -> list[str]:
    """The project paths an HTML file links as stylesheets and scripts, in order, once each."""
    return list(dict.fromkeys(p for p in map(clean_path, _LINK_RE.findall(html)) if p))


def _failed(result: str) -> bool:
    return '"error"' in result


def _braces(text: str) -> int:
    return text.count("{") - text.count("}")


def _error(message: str) -> str:
    return json.dumps({"error": message})


class Workspace:
    """A project's files during one turn, and what the turn did to them."""

    def __init__(self, files: dict[str, str]):
        self.files: dict[str, str] = dict(files)
        self._original = dict(files)
        # Each call so far, with its result. Small models loop on one call: an edit that
        # failed, or one that worked and would add the same text again each time.
        self._seen: dict[str, str] = {}
        self.repeats = 0
        # Files a write, edit or delete failed on, and how many failed in a row
        self.failed: list[str] = []
        self.misses = 0
        # Set by execute: the last call was one already made, so nothing happened
        self.last_was_repeat = False

    @property
    def stuck(self) -> bool:
        """More rounds won't help: the model keeps repeating itself, or it has made changes and
        is now failing at extras nobody asked for."""
        return self.repeats >= MAX_REPEATS or (self.misses >= MAX_REPEATS and bool(self.changes()))

    def changes(self) -> list[dict]:
        """[{"action": "created" | "edited" | "deleted", "path": ...}], in path order.
        A file written back to what it was, or created and then deleted, is no change."""
        out = []
        for path in sorted(set(self.files) | set(self._original)):
            before, after = self._original.get(path), self.files.get(path)
            if before == after:
                continue
            action = "created" if before is None else "deleted" if after is None else "edited"
            out.append({"action": action, "path": path})
        return out

    def _drops_links(self, path: str, html: str) -> Optional[str]:
        """An error when a change to index.html removes its link to a stylesheet or script the
        project has. Small models swap style.css for a new file and lose every style."""
        if path != "index.html":
            return None
        lost = sorted(set(_linked(self.files.get(path, ""))) & set(self.files) - set(_linked(html)))
        if not lost:
            return None
        return _error(
            f"That change removes index.html's link to {', '.join(lost)}, and the site needs "
            f"{'it' if len(lost) == 1 else 'them'}. Keep the links. Make style changes in the existing "
            "stylesheet instead of a new file."
        )

    def missing_links(self) -> list[str]:
        """Stylesheets and scripts index.html links that the project doesn't have. Small models
        often write index.html and stop, leaving the site without its CSS and JavaScript."""
        return [
            p for p in _linked(self.files.get("index.html", ""))
            if p.endswith((".css", ".js", ".mjs")) and p not in self.files
        ]

    def execute(self, name: str, args: dict) -> str:
        key = json.dumps([name, args], sort_keys=True, default=str)
        earlier = self._seen.get(key)
        self.last_was_repeat = earlier is not None and name in _CHANGING_TOOLS
        if self.last_was_repeat:
            self.repeats += 1
            if _failed(earlier):
                return _error(
                    "You already made this exact call and it failed the same way. Don't repeat it: "
                    "read the file, then use old_text copied from it, or rewrite the file with write_file."
                )
            return json.dumps({
                "ok": True, "path": args.get("path"),
                "note": "You already made this change, so nothing was done this time. Don't repeat it. "
                        "Make the next change the request needs, or if it is finished, tell the user in one or two "
                        "sentences what you changed.",
            })
        result = self._run(name, args)
        self._seen[key] = result
        if name in _CHANGING_TOOLS:
            failed = _failed(result)
            self.misses = self.misses + 1 if failed else 0
            path = clean_path(args.get("path"))
            if failed and path and path not in self.failed:
                self.failed.append(path)
        return result

    def fallback_reply(self) -> str:
        """What the reply says when the model ended the turn without one."""
        changed = [c["path"] for c in self.changes()]
        missed = [p for p in self.failed if p not in changed]
        if changed and missed:
            return f"Some of it is done, but I couldn't change {', '.join(missed)}. The rest is in the preview."
        if changed:
            return "Done. The changes are in the preview."
        return "I couldn't make that change. Try describing it another way."

    def _run(self, name: str, args: dict) -> str:
        try:
            if name == "list_files":
                return self._list()
            path = clean_path(args.get("path"))
            if path is None:
                return _error(
                    "That is not a valid file path. Use a relative path such as 'index.html' or 'js/app.js', "
                    f"ending in one of: {', '.join(sorted(_ALLOWED_EXT))}."
                )
            if name == "read_file":
                return self._read(path)
            if name == "write_file":
                return self._write(path, args.get("content"))
            if name == "edit_file":
                return self._edit(path, args.get("old_text"), args.get("new_text"))
            if name == "delete_file":
                return self._delete(path)
        except Exception as e:  # a tool must answer, never end the turn
            return _error(f"{name} failed: {e}")
        return _error(f"Unknown tool: {name}")

    @staticmethod
    def step(name: str, args: dict, result: str) -> dict:
        """What a finished tool call did, for the progress list the chat shows while a turn runs:
        {"verb": "created" | "replaced" | "edited" | "deleted" | "read" | "listed", "path", "ok"}."""
        try:
            parsed = json.loads(result)
        except ValueError:
            parsed = {}
        ok = not _failed(result)
        verb = {
            "list_files": "listed", "read_file": "read", "edit_file": "edited", "delete_file": "deleted",
            "write_file": "replaced" if parsed.get("action") == "replaced" else "created",
        }.get(name, "listed")
        return {"verb": verb, "path": clean_path(args.get("path")) or args.get("path"), "ok": ok}

    def _list(self) -> str:
        if not self.files:
            return json.dumps({"files": [], "note": "The project is empty. Start with index.html."})
        return json.dumps({"files": [{"path": p, "chars": len(c)} for p, c in sorted(self.files.items())]})

    def _read(self, path: str) -> str:
        if path not in self.files:
            return _error(f"{path} does not exist. Files: {', '.join(sorted(self.files)) or 'none'}.")
        return json.dumps({"path": path, "content": self.files[path]})

    def _write(self, path: str, content) -> str:
        if not isinstance(content, str):
            return _error("write_file needs the file's contents as text in 'content'.")
        if len(content) > MAX_FILE_CHARS:
            return _error(f"That file is too large ({len(content)} characters, the limit is {MAX_FILE_CHARS}).")
        if path not in self.files and len(self.files) >= MAX_FILES:
            return _error(f"The project already has {MAX_FILES} files, the most it can hold.")
        existed = path in self.files
        broken = self._drops_links(path, content)
        if broken:
            return broken
        self.files[path] = content
        return json.dumps({"ok": True, "path": path, "action": "replaced" if existed else "created"})

    def _edit(self, path: str, old_text, new_text) -> str:
        if path not in self.files:
            return _error(f"{path} does not exist. Use write_file to create it.")
        if not isinstance(old_text, str) or not old_text.strip():
            return _error("edit_file needs the exact text to replace in 'old_text'.")
        if not isinstance(new_text, str):
            return _error("edit_file needs the replacement in 'new_text' (it can be empty).")
        content = self.files[path]
        count = content.count(old_text)
        note = None
        if count == 1:
            start = content.index(old_text)
            end = start + len(old_text)
        elif count == 0:
            # Local models often get indentation or line breaks wrong, so try again ignoring spacing
            spans = _loose_matches(content, old_text)
            if not spans:
                return self._no_match(path, content, old_text)
            if len(spans) > 1:
                return _error(f"old_text matches {len(spans)} places in {path}. Include more surrounding lines so it is unique.")
            start, end = _widen(content, old_text, *spans[0])
            note = "old_text matched once the spacing was ignored."
        else:
            return _error(f"old_text appears {count} times in {path}. Include more surrounding lines so it is unique.")
        updated = content[:start] + new_text + content[end:]
        if path.endswith((".css", ".js", ".mjs")) and _braces(new_text) != _braces(content[start:end]):
            return _error(
                f"That edit would break {path}: new_text must open and close as many {{ and }} as the text it "
                "replaces. To change a rule, edit the lines inside it. For example, to make the nav red, "
                "use old_text '.navbar {' and new_text '.navbar {\n    background-color: red;'."
            )
        broken = self._drops_links(path, updated)
        if broken:
            return broken
        if len(updated) > MAX_FILE_CHARS:
            return _error(f"That edit makes {path} too large (the limit is {MAX_FILE_CHARS} characters).")
        self.files[path] = updated
        return json.dumps({"ok": True, "path": path, **({"note": note} if note else {})})

    def _no_match(self, path: str, content: str, old_text: str) -> str:
        """The error for an edit that matched nothing. It points at the lines that come closest,
        since small models fix a near miss far more often when shown the exact spot. Without a
        close match, a small file comes back whole so the model can retry without another call."""
        closest = _closest_lines(content, old_text)
        if closest:
            return json.dumps({
                "error": (
                    f"old_text was not found in {path}. The closest lines in the file are below. Copy old_text "
                    "exactly from them, with the same spaces and line breaks, and try again."
                ),
                "closest": closest,
            })
        if len(content) <= RETURN_FILE_CHARS:
            return json.dumps({
                "error": (
                    f"old_text was not found in {path}. Here is the file as it is now: copy old_text exactly "
                    "from it, or use write_file to replace the whole file. To add something new, such as a "
                    "CSS rule the file doesn't have yet, use old_text from where it should go and repeat "
                    "that text at the start of new_text."
                ),
                "content": content,
            })
        return _error(
            f"old_text was not found in {path}. Call read_file to see the file as it is now and copy the text "
            "exactly, or use write_file to replace the whole file."
        )

    def _delete(self, path: str) -> str:
        if path not in self.files:
            return _error(f"{path} does not exist.")
        del self.files[path]
        return json.dumps({"ok": True, "path": path, "action": "deleted"})
