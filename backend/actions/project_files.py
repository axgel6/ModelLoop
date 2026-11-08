"""The web studio's file tools: list, read, write, edit and delete a project's files.

Unlike the other actions these act on one project, so they are not in the registry.
The stream gives the model a Workspace, a copy of the project's files in memory. The
tools change only that copy, and the stream saves it with the reply when the turn
succeeds, so a turn that fails part way leaves the project as it was.
"""
import json
import re
from typing import Optional

MAX_FILES = 40
MAX_FILE_CHARS = 200_000
# An edit that misses sends a file this small back whole, to retry from
RETURN_FILE_CHARS = 8_000
# What the preview can show: no images or fonts yet, since files are text
_ALLOWED_EXT = {".html", ".css", ".js", ".mjs", ".json", ".svg", ".txt", ".md"}
_PATH_RE = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9_.\-]*(/[A-Za-z0-9_][A-Za-z0-9_.\-]*)*$")

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


def _error(message: str) -> str:
    return json.dumps({"error": message})


class Workspace:
    """A project's files during one turn, and what the turn did to them."""

    def __init__(self, files: dict[str, str]):
        self.files: dict[str, str] = dict(files)
        self._original = dict(files)

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

    def execute(self, name: str, args: dict) -> str:
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
        ok = "error" not in parsed
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
                return self._no_match(path, content)
            if len(spans) > 1:
                return _error(f"old_text matches {len(spans)} places in {path}. Include more surrounding lines so it is unique.")
            start, end = _widen(content, old_text, *spans[0])
            note = "old_text matched once the spacing was ignored."
        else:
            return _error(f"old_text appears {count} times in {path}. Include more surrounding lines so it is unique.")
        updated = content[:start] + new_text + content[end:]
        if len(updated) > MAX_FILE_CHARS:
            return _error(f"That edit makes {path} too large (the limit is {MAX_FILE_CHARS} characters).")
        self.files[path] = updated
        return json.dumps({"ok": True, "path": path, **({"note": note} if note else {})})

    def _no_match(self, path: str, content: str) -> str:
        """The error for an edit that matched nothing. A small file comes back whole,
        so the model can copy the text exactly or rewrite the file without another call."""
        if len(content) <= RETURN_FILE_CHARS:
            return json.dumps({
                "error": (
                    f"old_text was not found in {path}. Here is the file as it is now: copy the text exactly "
                    "and try again, or use write_file to replace the whole file."
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
