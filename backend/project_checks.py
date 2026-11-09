"""The web studio's checker: looks for problems in a project after the model builds or edits it.

Two kinds of problems are found, both from real signals rather than a model's guess:
- Static ones, read from the files here: a missing linked file, a JavaScript lookup of an
  id or class the page never has, a stylesheet styling names the page doesn't use, and
  brackets or strings that are never closed.
- Runtime ones, from the user's browser: the stream asks the chat to load the new files
  in a hidden preview, and the chat posts back what went wrong. A database row carries the
  answer, so it reaches the stream whichever server process took the post.

The checks are careful to report only what is surely wrong, since every problem sends
the model back to fix it, and a false one gets working code changed.
"""
import asyncio
import logging
import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import delete, select

from actions.project_files import _linked
from database import AsyncSessionLocal
from models import ProjectCheck

logger = logging.getLogger(__name__)

# The most problems sent to the model at once: more would bury the ones that matter
MAX_PROBLEMS = 8
# How long the stream waits for the browser's runtime errors
RUNTIME_WAIT_SECONDS = 10.0
_POLL_SECONDS = 0.5

# Lookups of one id or class, with the name quoted plainly (no template parts)
_ID_LOOKUP = re.compile(
    r"""getElementById\(\s*(['"])([A-Za-z][\w-]*)\1\s*\)|querySelector(?:All)?\(\s*(['"])#([A-Za-z][\w-]*)\3\s*\)"""
)
_CLASS_LOOKUP = re.compile(
    r"""getElementsByClassName\(\s*(['"])([A-Za-z_][\w-]*)\1\s*\)|querySelector(?:All)?\(\s*(['"])\.([A-Za-z_][\w-]*)\3\s*\)"""
)
# Ids made at runtime from parts, which a lookup of a plain name might mean
_DYNAMIC_ID = re.compile(r"""\bid\s*=\s*["']?\$\{|\.id\s*=\s*(?!["'][\w-]+["'])""")
_CSS_COMMENT = re.compile(r"/\*.*?\*/", re.S)
_CSS_STRING = re.compile(r"""(["'])(?:\\.|(?!\1).)*\1""")
_CSS_NAME = re.compile(r"([#.])([A-Za-z_][\w-]*)")
# What can come before a / that starts a regular expression rather than a division
_REGEX_AFTER_CHARS = set("(,=:[!&|?{}};+-*%<>~^")
_REGEX_AFTER_WORDS = {
    "return", "typeof", "case", "do", "else", "in", "of", "new", "delete", "void", "throw",
    "instanceof", "yield", "await",
}
_CLOSERS = {")": "(", "]": "[", "}": "{"}


def _word_count(name: str, text: str) -> int:
    return len(re.findall(rf"(?<![\w-]){re.escape(name)}(?![\w-])", text))


def _undefined_lookups(files: dict[str, str]) -> list[str]:
    """Ids and classes the JavaScript looks up that no HTML or JavaScript ever gives an element.
    A name counts as given when it appears anywhere else in those files, so only a name the
    page surely lacks is reported."""
    scripts = {p: c for p, c in files.items() if p.endswith((".js", ".mjs"))}
    page = "\n".join(c for p, c in files.items() if p.endswith((".html", ".js", ".mjs", ".svg")))
    dynamic_ids = bool(_DYNAMIC_ID.search(page))
    problems = []
    for path, js in sorted(scripts.items()):
        seen: set[str] = set()
        for kind, pattern in (("id", _ID_LOOKUP), ("class", _CLASS_LOOKUP)):
            if kind == "id" and dynamic_ids:
                continue
            found = [m.group(2) or m.group(4) for m in pattern.finditer(js)]
            for name in dict.fromkeys(found):
                if (kind, name) in seen:
                    continue
                seen.add((kind, name))
                lookups = sum(1 for m in pattern.finditer(page) if (m.group(2) or m.group(4)) == name)
                if _word_count(name, page) <= lookups:
                    sign = "#" if kind == "id" else "."
                    problems.append(
                        f"{path} looks up {sign}{name}, but no element has the {kind} \"{name}\". "
                        f"Add it to index.html, or use the {kind} the page already has."
                    )
    return problems


def _unused_styles(files: dict[str, str]) -> list[str]:
    """A stylesheet that styles mostly names the page doesn't have, the sign that it was
    written for different HTML. A few unused rules are normal, so only most going unused counts."""
    page = "\n".join(c for p, c in files.items() if p.endswith((".html", ".js", ".mjs", ".svg")))
    problems = []
    for path, css in sorted(files.items()):
        if not path.endswith(".css"):
            continue
        selectors = _CSS_STRING.sub("", _CSS_COMMENT.sub("", css))
        # Selectors only: drop what is inside { }
        selectors = re.sub(r"\{[^{}]*\}", "{}", selectors)
        names = list(dict.fromkeys(f"{s}{n}" for s, n in _CSS_NAME.findall(selectors)))
        # Hex colors and numbers never get here, since a name starts with a letter or _
        unused = [n for n in names if _word_count(n[1:], page) == 0]
        if len(unused) >= 3 and len(unused) * 2 >= len(names):
            shown = ", ".join(unused[:6]) + (" and more" if len(unused) > 6 else "")
            problems.append(
                f"{path} styles {shown}, which the page doesn't have, so those styles do nothing. "
                "Change the selectors to the ids and classes in index.html."
            )
    return problems


def _unclosed_css(path: str, css: str) -> Optional[str]:
    css = _CSS_COMMENT.sub(lambda m: "\n" * m.group(0).count("\n"), css)
    depth, opened_at, line = 0, [], 1
    for ch in css:
        if ch == "\n":
            line += 1
        elif ch == "{":
            depth += 1
            opened_at.append(line)
        elif ch == "}":
            if depth == 0:
                return f"{path} line {line}: this }} closes nothing, which breaks the rules after it."
            depth -= 1
            opened_at.pop()
    if depth:
        return f"{path} line {opened_at[-1]}: this {{ is never closed, which breaks the rules after it."
    return None


def _unclosed_js(path: str, js: str) -> Optional[str]:
    """The first bracket, string or comment that is never closed (or closes nothing), or None.
    It reads strings, template literals, comments and regular expressions as JavaScript does,
    so brackets inside them don't count."""
    stack: list[tuple[str, int]] = []  # an open bracket, or "${" inside a template, and its line
    i, n, line = 0, len(js), 1
    prev = ""  # the last token, to tell a regular expression from a division

    def problem(at_line: int, what: str) -> str:
        return f"{path} line {at_line}: {what}, so the script stops with a syntax error."

    def template(i: int, line: int):
        """Reads a template literal from just after its opening ` (or a ${...}'s closing }).
        Returns (index, line, opened_expression)."""
        while i < n:
            ch = js[i]
            if ch == "\\":
                i += 2
                continue
            if ch == "\n":
                line += 1
            if ch == "`":
                return i + 1, line, False
            if js.startswith("${", i):
                return i + 2, line, True
            i += 1
        return None, line, False

    while i < n:
        ch = js[i]
        if ch == "\n":
            line += 1
            i += 1
            continue
        if ch in " \t\r":
            i += 1
            continue
        if js.startswith("//", i):
            end = js.find("\n", i)
            i = n if end == -1 else end
            continue
        if js.startswith("/*", i):
            end = js.find("*/", i + 2)
            if end == -1:
                return problem(line, "this /* comment is never closed")
            line += js.count("\n", i, end)
            i = end + 2
            continue
        if ch in "'\"":
            start_line, j = line, i + 1
            while j < n and js[j] != ch:
                if js[j] == "\\":
                    if j + 1 < n and js[j + 1] == "\n":
                        line += 1
                    j += 2
                    continue
                if js[j] == "\n":
                    return problem(start_line, f"this {ch}string{ch} is never closed")
                j += 1
            if j >= n:
                return problem(start_line, f"this {ch}string{ch} is never closed")
            i, prev = j + 1, "a"
            continue
        if ch == "`":
            start_line = line
            i, line, opened = template(i + 1, line)
            if i is None:
                return problem(start_line, "this `template` is never closed")
            if opened:
                stack.append(("${", start_line))
            prev = "a" if not opened else "{"
            continue
        if ch == "/" and (prev == "" or prev in _REGEX_AFTER_CHARS or prev in _REGEX_AFTER_WORDS):
            j, in_class = i + 1, False
            while j < n and js[j] != "\n":
                if js[j] == "\\":
                    j += 2
                    continue
                if js[j] == "[":
                    in_class = True
                elif js[j] == "]":
                    in_class = False
                elif js[j] == "/" and not in_class:
                    break
                j += 1
            if j < n and js[j] == "/":
                i = j + 1
                while i < n and js[i].isalpha():
                    i += 1
                prev = "a"
                continue
            # Not a regular expression after all: read the / as a division
        if ch in "([{":
            stack.append((ch, line))
            prev = ch
            i += 1
            continue
        if ch in ")]}":
            if ch == "}" and stack and stack[-1][0] == "${":
                start_line = stack.pop()[1]
                i, line, opened = template(i + 1, line)
                if i is None:
                    return problem(start_line, "this `template` is never closed")
                if opened:
                    stack.append(("${", start_line))
                prev = "a"
                continue
            if not stack or stack[-1][0] != _CLOSERS[ch]:
                return problem(line, f"this {ch} closes nothing")
            stack.pop()
            prev = ch
            i += 1
            continue
        if ch.isalnum() or ch in "_$":
            j = i
            while j < n and (js[j].isalnum() or js[j] in "_$"):
                j += 1
            prev = js[i:j] if js[i:j] in _REGEX_AFTER_WORDS else "a"
            i = j
            continue
        prev = ch
        i += 1
    if stack:
        opener, at_line = stack[-1]
        what = "this ${ in a template is never closed" if opener == "${" else f"this {opener} is never closed"
        return problem(at_line, what)
    return None


def _uses_jsx(files: dict[str, str]) -> bool:
    """The project's scripts are compiled in the browser (JSX through Babel), so they aren't
    plain JavaScript and the syntax check would misread them."""
    return any("babel" in c.lower() for p, c in files.items() if p.endswith(".html"))


def static_problems(files: dict[str, str]) -> list[str]:
    """Problems found by reading the project's files, most serious first."""
    if "index.html" not in files:
        return ["The project has no index.html, so the preview shows nothing. Create it."]
    problems = []
    for path in _linked(files["index.html"]):
        if path.endswith((".css", ".js", ".mjs")) and path not in files:
            problems.append(f"index.html loads {path}, which doesn't exist. Create it.")
    jsx = _uses_jsx(files)
    for path, content in sorted(files.items()):
        if path.endswith(".css"):
            found = _unclosed_css(path, content)
        elif path.endswith((".js", ".mjs")) and not jsx:
            found = _unclosed_js(path, content)
        else:
            found = None
        if found:
            problems.append(found)
    problems += _undefined_lookups(files)
    problems += _unused_styles(files)
    return problems


def runtime_problems(errors: list[str]) -> list[str]:
    """The browser's errors worth fixing, from what it reported."""
    out = []
    for text in errors:
        if not isinstance(text, str) or not text.strip():
            continue
        # console.error is often the site reporting something on purpose, and a file from
        # another site that fails to load is the network, not the code
        if text.startswith("console.error") or (text.startswith("Couldn't load") and "://" in text):
            continue
        out.append(f"In the browser: {text.strip()[:300]}")
    return list(dict.fromkeys(out))


def combine(static: list[str], runtime: list[str]) -> list[str]:
    return list(dict.fromkeys([*static, *runtime]))[:MAX_PROBLEMS]


def fix_request(problems: list[str]) -> str:
    """The message that sends the model back to fix what the checker found."""
    listed = "\n".join(f"- {p}" for p in problems)
    return (
        f"I checked the site and found {'this problem' if len(problems) == 1 else 'these problems'}:\n{listed}\n\n"
        "Fix them now with edit_file, or write_file for a file that is badly broken. Change only what the "
        "fix needs, keep everything else as it is, and use the names in the spec. Then say in one short "
        "sentence what you fixed."
    )


def reply(build_reply: str, found: int, left: list[str]) -> str:
    """The turn's reply: what the model said it built, and how the checks went when they found
    something. A clean check adds nothing, since the site simply works."""
    if not found:
        return build_reply
    if not left:
        fixed = "a problem" if found == 1 else f"{found} problems"
        return f"{build_reply}\n\nI checked the site and fixed {fixed} I found."
    listed = "\n".join(f"- {p}" for p in left[:3])
    return (
        f"{build_reply}\n\nI checked the site, and {'this is' if len(left) == 1 else 'these are'} still wrong:\n"
        f"{listed}\n\nAsk me to fix {'it' if len(left) == 1 else 'them'} and I'll try again."
    )


# ---------------------------------------------------------------------------
# Runtime checks: the stream opens one, the chat answers it, the stream reads the answer
# ---------------------------------------------------------------------------

async def open_check(chat_id: str) -> Optional[uuid.UUID]:
    """A new check for the chat's browser to answer, or None when it can't be stored."""
    try:
        async with AsyncSessionLocal() as db:
            # Checks are deleted once read; this clears any a crash left behind
            await db.execute(delete(ProjectCheck).where(
                ProjectCheck.created_at < datetime.now(timezone.utc) - timedelta(hours=1)
            ))
            check = ProjectCheck(chat_id=chat_id)
            db.add(check)
            await db.commit()
            return check.id
    except Exception as e:
        logger.warning("project_check_open_failed chat_id=%s error=%s", chat_id, str(e))
        return None


async def wait_for_errors(check_id: uuid.UUID, timeout: float = RUNTIME_WAIT_SECONDS) -> Optional[list[str]]:
    """The errors the browser reported for the check, or None when it didn't answer in time
    (the tab was closed, or the browser couldn't run the preview). The check is then deleted."""
    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout
    errors: Optional[list[str]] = None
    try:
        while loop.time() < deadline:
            await asyncio.sleep(_POLL_SECONDS)
            async with AsyncSessionLocal() as db:
                found = (await db.execute(
                    select(ProjectCheck.errors).where(ProjectCheck.id == check_id)
                )).scalar_one_or_none()
            if found is not None:
                errors = [e for e in found if isinstance(e, str)]
                break
    finally:
        try:
            async with AsyncSessionLocal() as db:
                await db.execute(delete(ProjectCheck).where(ProjectCheck.id == check_id))
                await db.commit()
        except Exception as e:
            logger.warning("project_check_delete_failed check_id=%s error=%s", check_id, str(e))
    return errors
