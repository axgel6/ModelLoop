import ast
import json
import operator
import re

DEFINITION = {
    "type": "function",
    "function": {
        "name": "calculate",
        "description": (
            "Evaluates a mathematical expression and returns the exact result. "
            "Use this for arithmetic, percentages, and numeric calculations where precision matters. "
            "Only accepts numeric expressions — no code, variables, or function calls."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "expression": {
                    "type": "string",
                    "description": "A mathematical expression, e.g. '(12 * 8) + 4' or '15 % of 200'",
                }
            },
            "required": ["expression"],
        },
    },
}

KEYWORDS = {
    "calculate", "compute", "math", "plus", "minus", "times", "divided",
    "multiply", "divide", "percent", "percentage", "sum", "total", "equals",
    "squared", "cubed", "power", "sqrt", "root",
}

_MATH_EXPR = re.compile(r"\d+\.?\d*\s*[+\-*/^%]\s*\d")


def should_activate(text: str, words: set) -> bool:
    return bool(words & KEYWORDS) or bool(_MATH_EXPR.search(text))


_SAFE_OPS = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.FloorDiv: operator.floordiv,
    ast.Mod: operator.mod,
    ast.Pow: operator.pow,
    ast.USub: operator.neg,
    ast.UAdd: operator.pos,
}

_MAX_POW = 1_000


def _get_op(node_op):
    op = _SAFE_OPS.get(type(node_op))
    if op is None:
        raise ValueError(f"Unsupported operator: {type(node_op).__name__}")
    return op


def _eval(node):
    if isinstance(node, ast.Expression):
        return _eval(node.body)
    if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
        return node.value
    if isinstance(node, ast.BinOp):
        left, right = _eval(node.left), _eval(node.right)
        if isinstance(node.op, ast.Pow) and abs(right) > _MAX_POW:
            raise ValueError("Exponent too large")
        return _get_op(node.op)(left, right)
    if isinstance(node, ast.UnaryOp):
        return _get_op(node.op)(_eval(node.operand))
    raise ValueError(f"Unsupported expression: {ast.dump(node)}")


def execute(arguments: dict) -> str:
    expr = arguments.get("expression", "").strip()
    expr = re.sub(r"(\d+\.?\d*)\s*%\s*of\s*(\d+\.?\d*)", r"(\1/100)*\2", expr, flags=re.IGNORECASE)
    try:
        tree = ast.parse(expr, mode="eval")
        result = _eval(tree)
        if isinstance(result, float) and result.is_integer():
            result = int(result)
        return json.dumps({"expression": expr, "result": result})
    except ZeroDivisionError:
        return json.dumps({"error": "Division by zero"})
    except Exception as e:
        return json.dumps({"error": str(e)})
