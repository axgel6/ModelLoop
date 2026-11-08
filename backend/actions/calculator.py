"""Exact arithmetic, worked out here instead of by the model.

Small local models get sums like "18% of 2,340" or "37 x 412" wrong often enough to
matter. The expression is pulled out of the message, parsed with Python's own
parser, and only numbers, arithmetic and a few functions are allowed to run.
"""
import ast
import json
import math
import operator
import re
from typing import Optional

DEFINITION = {
    "type": "function",
    "function": {
        "name": "calculate",
        "description": (
            "Work out an arithmetic expression exactly. Use it for any calculation instead of doing it yourself. "
            "Supports + - * / % ** parentheses, sqrt() and cbrt()."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "expression": {"type": "string", "description": "The expression, e.g. '0.18 * 2340' or '(12 + 7) / 3'"},
            },
            "required": ["expression"],
        },
    },
}

# A number, then an operator, then another number: "37 x 412", "18% of 2340", "2 to the power of 10"
_EXPRESSION_RE = re.compile(
    r"\d\s*(?:\*\*|[+*/×÷^]|\s[x-]\s|\s(?:times|plus|minus|divided by|multiplied by|over|to the power of|mod)\s)\s*[\d(.]"
    r"|\d\s*(?:%|percent) of\s*\$?\d"
    r"|\b(?:square|cube) root of\s*\d"
    r"|\d\s*(?:squared|cubed)\b"
    r"|\b(?:sqrt|cbrt)\s*\(?\s*\d",
    re.IGNORECASE,
)
# Words that say a calculation is wanted. Without one, "1/2 cup of flour" or "24/7" is not a sum.
_CUE_RE = re.compile(r"\b(calculate|calc|compute|what'?s|what is|how much is|solve|evaluate|equals?)\b|=\s*\??\s*$", re.IGNORECASE)
_NOT_MATH_RE = re.compile(r"[^\d\s.,+\-*/x×÷^()%=?]")

_WORDS = [
    (r"\bsquare root of\s*(-?[\d.]+)", r"sqrt(\1)"),
    (r"\bcube root of\s*(-?[\d.]+)", r"cbrt(\1)"),
    (r"(\d+(?:\.\d+)?)\s*(?:%|percent) of\s*", r"(\1/100)*"),
    (r"(\d+(?:\.\d+)?)\s*(?:%|percent)", r"(\1/100)"),
    (r"\bmultiplied by\b|\btimes\b", "*"),
    (r"\bdivided by\b|\bover\b", "/"),
    (r"\bplus\b", "+"),
    (r"\bminus\b", "-"),
    (r"\bto the power of\b", "**"),
    (r"\s*\bsquared\b", "**2"),
    (r"\s*\bcubed\b", "**3"),
    (r"\bmod(?:ulo)?\b", "%"),
    (r"(?<=[\d)])\s*[x×]\s*(?=[\d(])", "*"),
    (r"÷", "/"),
    (r"\^", "**"),
]
_CANDIDATE_RE = re.compile(r"(?:sqrt|cbrt|[\d.(-])(?:sqrt|cbrt|[\d.\s+\-*/%()])*")
_OPERATOR_RE = re.compile(r"[+\-*/%]|sqrt|cbrt")
# "2026-11-08" and "555-1234" are dates and phone numbers, not subtraction
_DATE_OR_PHONE_RE = re.compile(r"^\d{1,4}-\d{1,4}(-\d{1,4})?$")

_BINARY = {
    ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul,
    ast.Div: operator.truediv, ast.FloorDiv: operator.floordiv, ast.Mod: operator.mod, ast.Pow: operator.pow,
}
_UNARY = {ast.UAdd: operator.pos, ast.USub: operator.neg}
_FUNCTIONS = {"sqrt": math.sqrt, "cbrt": lambda x: math.copysign(abs(x) ** (1 / 3), x), "abs": abs}


def _evaluate(node: ast.AST):
    if isinstance(node, ast.Expression):
        return _evaluate(node.body)
    if isinstance(node, ast.Constant) and type(node.value) in (int, float):
        return node.value
    if isinstance(node, ast.BinOp) and type(node.op) in _BINARY:
        left, right = _evaluate(node.left), _evaluate(node.right)
        # Keep powers small enough to answer instantly
        if isinstance(node.op, ast.Pow) and (abs(right) > 1000 or abs(left) > 1e6 and abs(right) > 50):
            raise ValueError("exponent too large")
        return _BINARY[type(node.op)](left, right)
    if isinstance(node, ast.UnaryOp) and type(node.op) in _UNARY:
        return _UNARY[type(node.op)](_evaluate(node.operand))
    if (isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in _FUNCTIONS
            and len(node.args) == 1 and not node.keywords):
        return _FUNCTIONS[node.func.id](_evaluate(node.args[0]))
    raise ValueError("not arithmetic")


class DivisionByZero(ValueError):
    pass


def evaluate(expression: str):
    """The value of a plain arithmetic expression. Raises ValueError for anything else."""
    expression = expression.strip()
    if not expression or len(expression) > 200:
        raise ValueError("empty or too long")
    try:
        value = _evaluate(ast.parse(expression, mode="eval"))
    except ZeroDivisionError as e:
        raise DivisionByZero() from e
    except (SyntaxError, OverflowError, TypeError) as e:
        raise ValueError(str(e)) from e
    if isinstance(value, complex) or (isinstance(value, float) and not math.isfinite(value)):
        raise ValueError("no real result")
    return value


def format_number(value) -> str:
    if isinstance(value, float):
        value = float(f"{value:.12g}")
        if value.is_integer() and abs(value) < 1e15:
            value = int(value)
    if isinstance(value, int):
        return f"{value:,}" if abs(value) < 10**21 else f"{value:.6e}"
    return f"{value:,.12g}" if 1e-6 <= abs(value) < 1e15 else f"{value:.6e}"


def _normalize(text: str) -> str:
    text = text.lower().replace("$", "")
    text = re.sub(r"(?<=\d),(?=\d{3}\b)", "", text)
    for pattern, replacement in _WORDS:
        text = re.sub(pattern, replacement, text)
    return text


def extract(text: str) -> Optional[tuple[str, str]]:
    """The expression in a message and its result, or None when there is no sum to do."""
    if "```" in text:
        return None
    candidates = sorted(
        (m.group(0).strip(" .") for m in _CANDIDATE_RE.finditer(_normalize(text))),
        key=len, reverse=True,
    )
    for expr in candidates:
        expr = expr.rstrip("+-*/% ")
        # Drop unmatched closing parentheses left by the surrounding sentence
        while expr.count(")") > expr.count("(") and expr.endswith(")"):
            expr = expr[:-1].rstrip()
        if not _OPERATOR_RE.search(expr) or len(re.findall(r"\d+(?:\.\d+)?", expr)) < 1:
            continue
        if _DATE_OR_PHONE_RE.match(expr):
            continue
        shown = expr.replace("**", "^").replace("*", " × ").replace("/", " / ")
        shown = re.sub(r"\s+", " ", shown).strip()
        try:
            return shown, format_number(evaluate(expr))
        except DivisionByZero:
            return shown, "undefined (division by zero)"
        except ValueError:
            continue
    return None


def should_activate(text: str, words: set) -> bool:
    if "```" in text or not _EXPRESSION_RE.search(text):
        return False
    # A calculation is asked for, or the message is nothing but the sum ("10 minus 3", "square root of 144")
    if _CUE_RE.search(text):
        return True
    return len(_NOT_MATH_RE.findall(re.sub(r"sqrt|cbrt", "", _normalize(text)))) <= 3


async def proactive(text: str, ctx: dict) -> Optional[str]:
    found = extract(text)
    if not found:
        return None
    expr, result = found
    return f"Calculator: {expr} = {result}"


async def async_execute(arguments: dict) -> str:
    expression = str(arguments.get("expression") or "")
    try:
        value = evaluate(_normalize(expression))
    except ValueError as e:
        return json.dumps({"error": f"Could not calculate '{expression}': {e}. Check the expression."})
    return json.dumps({"expression": expression, "result": format_number(value)})
