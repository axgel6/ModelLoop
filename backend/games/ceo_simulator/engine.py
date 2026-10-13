"""CEO Simulator rules.

The model narrates each week and proposes what changed (demand up 15%, hire
two people, reputation down 5). It never states revenue, profit or cash: those
are computed here from the proposed effects, after every value is clamped, so
the numbers stay consistent however the model behaves. No I/O in this file.
"""
import copy
import math
import random
import re
import uuid
from typing import Optional

GAME_TYPE = "ceo-simulator"

# A turn is one week, and every rate below is per week.
START_CASH = 100_000
START_EMPLOYEES = 5
START_REPUTATION = 50
START_MORALE = 70
# Opening weekly revenue is split evenly across the starting products, so a
# company selling $5 coffees and one selling $900 chairs begin on equal footing.
START_REVENUE_TARGET = 11_000
NEW_PRODUCT_REVENUE_TARGET = 2_000

SALARY = 1_200                 # per employee, per week
HIRING_COST = 2_000            # per hire
LAUNCH_COST = 3_000            # to develop and release a new product
SEVERANCE = 3_000              # per layoff
REVENUE_PER_EMPLOYEE = 3_000   # weekly sales one person can support
FIXED_OVERHEAD = 750
OVERHEAD_RATE = 0.03           # of revenue
PRICE_ELASTICITY = 1.2         # % demand lost per % price increase
WORD_OF_MOUTH = 4000           # higher is slower: weekly demand drift per reputation point

MAX_PRODUCTS = 8
MAX_START_PRODUCTS = 4
HISTORY_LIMIT = 60
LOG_LIMIT = 40

DEFAULT_OPTIONS = [
    "Launch a marketing campaign",
    "Hire two more people",
    "Raise prices by 10%",
]

# What the model must return. Passed to Ollama as the `format` schema, which
# constrains the reply to this shape.
REPLY_SCHEMA = {
    "type": "object",
    "properties": {
        "narrative": {"type": "string"},
        "reactions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "source": {"type": "string"},
                    "text": {"type": "string"},
                    "sentiment": {"type": "string", "enum": ["positive", "neutral", "negative"]},
                },
                "required": ["source", "text", "sentiment"],
            },
        },
        "effects": {
            "type": "object",
            "properties": {
                "product_changes": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "product": {"type": "string"},
                            "demand_change_pct": {"type": "number"},
                            "new_price": {"type": "number"},
                            "quality_change": {"type": "number"},
                        },
                        "required": ["product", "demand_change_pct"],
                    },
                },
                "new_products": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "name": {"type": "string"},
                            "price": {"type": "number"},
                            "unit_cost": {"type": "number"},
                        },
                        "required": ["name", "price"],
                    },
                },
                "discontinued_products": {"type": "array", "items": {"type": "string"}},
                "hires": {"type": "integer"},
                "reputation_change": {"type": "number"},
                "morale_change": {"type": "number"},
                "one_time_cost": {"type": "number"},
                "one_time_income": {"type": "number"},
            },
            "required": ["product_changes", "hires", "reputation_change", "morale_change", "one_time_cost"],
        },
        "options": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["narrative", "reactions", "effects", "options"],
}

SYSTEM_PROMPT = """You are the game master of a CEO simulator. Each turn is one week. The player is the CEO and tells you one decision; you decide what happens as a result and reply with JSON only.

How to judge a decision:
- Be realistic and fair. Good ideas help, careless or greedy ones backfire, and most things are a trade-off. Do not reward every decision.
- Keep effects proportionate. A normal week moves demand by a few percent; only a big, well-funded move shifts it by 20% or more.
- Launching a product costs $3,000, which the game charges itself. Do not add it to one_time_cost.
- Anything that costs money (campaigns, equipment, research, events, lawsuits) must appear in one_time_cost, in dollars. Money raised or won goes in one_time_income, and investors are hard to convince.
- Use the exact product names you are given in product_changes and discontinued_products.
- When the player changes a price, you MUST put the new price in new_price for every product affected. The game works out how price affects demand, so do not also change demand for it.
- Never write a specific price in the narrative. The game shows prices itself.
- Add to new_products only when the player launches something. hires is the number of people hired this week, negative for layoffs, 0 if staffing is untouched.
- reputation_change and morale_change are between -15 and 15.

What to write:
- narrative: 2 to 4 sentences on how the week went, in second person, plain and specific. Never state revenue, profit or cash figures; the game calculates those.
- reactions: 2 or 3 short posts from the public, each from a different kind of voice (a customer, a journalist, an employee, an investor, a competitor), with a sentiment.
- options: exactly 3 different decisions the player could make next, each under 12 words, fitting the company's current situation. Never suggest launching a product that is already on sale."""


def _num(value, default: float = 0.0) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    return number if math.isfinite(number) else default


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _text(value, limit: int) -> str:
    return " ".join(str(value or "").split())[:limit].strip()


def _money(amount: float) -> str:
    return f"${amount:,.2f}" if amount < 100 and amount != int(amount) else f"${amount:,.0f}"


# ---- Reading the player's decision ----
# Small models misreport the plain facts of a decision: they lay people off
# during an ad campaign, or skip a price change the player spelled out. So what
# the player said outright is read here, and the model's version of it is only
# trusted when the decision is at least about that subject.

_NUMBER_WORDS = {
    "a": 1, "an": 1, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6,
    "seven": 7, "eight": 8, "nine": 9, "ten": 10, "twelve": 12, "fifteen": 15, "twenty": 20,
}
_COUNT = r"(\d{1,3}|" + "|".join(_NUMBER_WORDS) + r")\b"
_HIRE_RE = re.compile(r"\b(?:hire|hiring|recruit|bring on|onboard|add)\s+(?:another\s+|about\s+)?" + _COUNT, re.I)
_FIRE_RE = re.compile(r"\b(?:lay ?off|fire|let go(?: of)?|cut|dismiss|sack)\s+(?:another\s+|about\s+)?" + _COUNT, re.I)
_STAFF_TOPIC = re.compile(
    r"\b(hir(e|es|ed|ing)|recruit\w*|staff\w*|employ\w*|lay ?offs?|fir(e|ed|ing)|headcount|"
    r"team|people|workers?|engineers?|sales ?(people|reps?)|downsiz\w*|let go)\b", re.I)
_PRICE_TOPIC = re.compile(r"\b(pric\w*|discount\w*|cheaper|sale|markup|mark up|charge|\$\s?\d)", re.I)
_PRICE_UP = re.compile(r"\b(rais\w*|increas\w*|hik\w*|bump\w*|up)\b", re.I)
_PRICE_DOWN = re.compile(r"\b(lower\w*|cut\w*|drop\w*|reduc\w*|decreas\w*|discount\w*|slash\w*|cheaper|down)\b", re.I)
_PRICE_RESTORE = re.compile(r"\b(original|restor\w*|revert\w*|back to (normal|before|what|where|the old|their old))\b", re.I)
# Used when the player changes prices without saying by how much ("reduce prices")
DEFAULT_PRICE_STEP = 0.10
_PERCENT = re.compile(r"(\d{1,3}(?:\.\d+)?)\s?(?:%|percent)", re.I)
_PRICE_TO = re.compile(r"\bto\s+\$?\s?(\d[\d,]*(?:\.\d{1,2})?)\b", re.I)
_INCOME_TOPIC = re.compile(
    r"\b(invest\w*|fund\w*|rais(e|ing) (money|capital|a round|\$)|loan|borrow\w*|grant|"
    r"sell (a stake|shares|equity|the)|licens\w*|sponsor\w*|crowdfund\w*|ipo|"
    r"(cash|capital) (infusion|injection)|partner\w*|backer\w*|donat\w*|inherit\w*|settlement|refund|"
    r"(got|get|receiv\w*|secur\w*|land\w*|won|win) .{0,30}\$?\d)\b", re.I)
_LAUNCH_TOPIC = re.compile(
    r"\b(launch\w*|introduc\w*|releas\w*|new (product|line|item|service|flavou?r|model|version)|"
    r"start selling|add (a|an|new)|develop\w*|creat\w*|build\w*|expand\w*|"
    r"announc\w*|unveil\w*|roll(ing)? out|debut\w*)\b", re.I)
# "Launch a new product called Cold Brew for $6" -> everything before the name, then the price
_LAUNCH_LEAD = re.compile(
    r"^.*?\b(?:launch\w*|introduc\w*|releas\w*|announc\w*|unveil\w*|roll(?:ing)? out|debut\w*|"
    r"start selling|sell|add|develop\w*|creat\w*|build\w*)\b"
    # then any run of filler: "an all new product, the ..."
    r"(?:[\s:!,.\-]*\b(?:a|an|the|our|my|all|brand|new|product|item|line|service|offering|called|named)\b)*"
    r"[\s:!,.\-]*", re.I)
_LAUNCH_PRICE = re.compile(
    r"[\s,]*(?:\b(?:only|just|priced|selling|sells|costing|costs)\b\s*)*(?:\b(?:for|at)\b\s*)?(?:only\s+|just\s+)?"
    r"\$\s?(\d[\d,]*(?:\.\d{1,2})?).*$", re.I | re.S)
# A "launch" with a price that is not a product
_NOT_A_PRODUCT = re.compile(
    r"\b(campaigns?|ads?|advert\w*|marketing|promo\w*|events?|programs?|sales?|partnerships?|surveys?|"
    r"training|contests?|giveaways?|websites?|budget|bonus\w*|raises?|offices?|stores?|locations?)\b", re.I)
_DISCONTINUE_TOPIC = re.compile(r"\b(discontinu\w*|drop\w*|kill\w*|retir\w*|stop (selling|making)|remov\w*|axe|scrap\w*)\b", re.I)


def _count(word: str) -> int:
    return int(word) if word.isdigit() else _NUMBER_WORDS.get(word.lower(), 0)


def _stated_hires(decision: str) -> Optional[int]:
    """Net hires the player spelled out ("hire 2", "lay off three"), else None."""
    hired = sum(_count(m.group(1)) for m in _HIRE_RE.finditer(decision))
    fired = sum(_count(m.group(1)) for m in _FIRE_RE.finditer(decision))
    return hired - fired if hired or fired else None


def _price_direction(decision: str) -> int:
    """+1 if the decision raises prices, -1 if it lowers them, 0 if neither or unclear."""
    if not _PRICE_TOPIC.search(decision):
        return 0
    up, down = bool(_PRICE_UP.search(decision)), bool(_PRICE_DOWN.search(decision))
    return 0 if up == down else (1 if up else -1)


def _stated_prices(decision: str, products: list[dict]) -> dict[str, float]:
    """New prices the player spelled out, by product id."""
    if not _PRICE_TOPIC.search(decision):
        return {}
    named = [p for p in products if p["name"].lower() in decision.lower()]
    if _PRICE_RESTORE.search(decision):
        return {p["id"]: p["start_price"] for p in (named or products) if p.get("start_price")}
    percent = _PERCENT.search(decision)
    if percent:
        direction = _price_direction(decision)
        if not direction:
            return {}  # no direction, or both: leave it to the model
        factor = 1 + float(percent.group(1)) / 100 * direction
        return {p["id"]: p["price"] * factor for p in (named or products)}
    target = _PRICE_TO.search(decision)
    targets = named or (products if len(products) == 1 else [])
    if target and len(targets) == 1:
        return {targets[0]["id"]: float(target.group(1).replace(",", ""))}
    return {}


# "Rename the company to X", "rebrand Donut as Glazed Ring", "change our name to X"
_RENAME_RE = re.compile(
    r"\b(?:renam\w*|rebrand\w*|chang\w*\s+(?:the\s+|our\s+|my\s+)?(?:(?:company|brand|business|product)(?:'s)?\s+)?name(?:\s+of)?)"
    r"\s*(?P<subject>.*?)\s*\b(?:to|as|into)\s+[\"“]?(?P<name>[^\"“”.!,;\n]{2,60}?)[\"”]?"
    r"\s*(?:$|[.!,;\n]|\s+(?:and|with|so|because|then)\b)", re.I)
_SUBJECT_FILLER = re.compile(r"\b(the|our|my|company|brand|business|product|name|whole|entire|us|it|ourselves)\b", re.I)


def _stated_rename(decision: str, company: str, products: list[dict]) -> Optional[tuple]:
    """("company", None, new_name) or ("product", product, new_name) if the player renamed something."""
    match = _RENAME_RE.search(decision)
    if not match:
        return None
    subject = match.group("subject").lower()
    name = _text(match.group("name"), 60).strip("'‘’ ")
    if len(name) < 2:
        return None
    # Longest name first, so "Dozen Donuts" is not mistaken for "Donut"
    for product in sorted(products, key=lambda p: -len(p["name"])):
        if product["name"].lower() in subject:
            return ("product", product, name[:40])
    leftover = _SUBJECT_FILLER.sub("", subject.replace(company.lower(), ""))
    if leftover.strip(" '’s"):
        return None  # renaming something the game does not track
    return ("company", None, name)


def _stated_launch(decision: str, taken: set) -> Optional[dict]:
    """A product the player launched by name and price, else None."""
    if not _LAUNCH_TOPIC.search(decision):
        return None
    price = _LAUNCH_PRICE.search(decision)
    if not price:
        return None
    name = _text(_LAUNCH_LEAD.sub("", decision[: price.start()], count=1), 40).strip(" .,!:-\"'")
    if len(name) < 2 or name.lower() in taken or _NOT_A_PRODUCT.search(name):
        return None
    return {"name": name, "price": float(price.group(1).replace(",", ""))}


def _product(name: str, price: float, unit_cost: float, revenue_target: float, quality: int) -> dict:
    return {
        "id": uuid.uuid4().hex[:8],
        "name": name,
        "price": round(price, 2),
        "start_price": round(price, 2),
        "unit_cost": round(unit_cost, 2),
        # Units a week at average reputation and quality
        "demand": max(1, round(revenue_target / price)),
        "quality": quality,
        "active": True,
        "units_sold": 0,
        "revenue": 0,
    }


def new_game(company: str, pitch: str, products: list[dict]) -> dict:
    share = START_REVENUE_TARGET / len(products)
    return {
        "company": {"name": company, "pitch": pitch},
        "period": "week",
        "start_cash": START_CASH,
        "status": "active",
        "turn": 0,
        "cash": START_CASH,
        "employees": START_EMPLOYEES,
        "reputation": START_REPUTATION,
        "morale": START_MORALE,
        "products": [_product(p["name"], p["price"], p["price"] * 0.4, share, 60) for p in products],
        "last": {"revenue": 0, "costs": 0, "profit": 0},
        "history": [],
        "reactions": [],
        "options": list(DEFAULT_OPTIONS),
        "log": [],
    }


def upgrade(state: dict) -> dict:
    """Bring a save from an older version of the rules up to date.

    Turns used to be months. A monthly save keeps its cash, staff and history,
    and its products' demand is scaled down to a week's worth.
    """
    if state.get("period") == "week":
        return state
    s = copy.deepcopy(state)
    for p in s["products"]:
        p["demand"] = max(1, round(p["demand"] * 12 / 52))
    s["period"] = "week"
    s["start_cash"] = 250_000
    return s


def _find_product(state: dict, product_id: str) -> Optional[dict]:
    return next((p for p in state["products"] if p["id"] == product_id and p["active"]), None)


def rename_product(state: dict, product_id: str, name: str) -> dict:
    """Fix or change a product's name from the dashboard. A label only: nothing reacts to it."""
    s = copy.deepcopy(state)
    product = _find_product(s, product_id)
    name = _text(name, 40)
    if not product or not name:
        raise ValueError("That product cannot be renamed.")
    if any(p["active"] and p["id"] != product_id and p["name"].lower() == name.lower() for p in s["products"]):
        raise ValueError("Another product already has that name.")
    product["name"] = name
    return s


def set_price(state: dict, product_id: str, price: float) -> dict:
    """Reprice a product from the dashboard, between turns.

    Demand shifts at once by the same rule a priced decision uses, and the change
    is noted so the coming week's story and public reaction can take it into account.
    """
    s = copy.deepcopy(state)
    product = _find_product(s, product_id)
    price = _num(price)
    if not product or price <= 0:
        raise ValueError("That price cannot be set.")
    old = product["price"]
    price = round(_clamp(price, max(0.01, product["unit_cost"] * 0.5), 1_000_000), 2)
    if abs(price - old) / old <= 0.005:
        return s
    demand_pct = _clamp(-PRICE_ELASTICITY * (price - old) / old * 100, -70, 80)
    product["price"] = price
    product["demand"] = max(0, round(product["demand"] * (1 + demand_pct / 100)))
    s["pending"] = (s.get("pending") or [])[-11:] + [
        f"{product['name']} price {_money(old)} to {_money(price)}",
    ]
    return s


def check_action(state: dict, action: dict) -> tuple:
    """Validate a dashboard action that is played as the week's decision.

    Returns (cleaned action, decision text for the story). Unlike a typed decision,
    nothing here has to be worked out from a sentence.
    """
    active = [p for p in state["products"] if p["active"]]
    kind = action.get("type")
    if kind == "launch":
        name = _text(action.get("name"), 40)
        price = _num(action.get("price"))
        if not name or price <= 0:
            raise ValueError("A new product needs a name and a price.")
        if len(active) >= MAX_PRODUCTS:
            raise ValueError(f"You can sell at most {MAX_PRODUCTS} products. Discontinue one first.")
        if any(p["name"].lower() == name.lower() for p in active):
            raise ValueError("You already sell a product with that name.")
        price = round(_clamp(price, 0.5, 1_000_000), 2)
        return {"type": "launch", "name": name, "price": price}, f"Launch a new product: {name} at {_money(price)}"
    if kind == "discontinue":
        product = _find_product(state, str(action.get("product_id")))
        if not product:
            raise ValueError("That product is not on sale.")
        if len(active) <= 1:
            raise ValueError("You need at least one product on sale.")
        return {"type": "discontinue", "product_id": product["id"]}, f"Discontinue {product['name']}"
    raise ValueError("Unknown action.")


def describe_for_model(state: dict, decision: str) -> str:
    """The turn's user message: everything the model needs, sent fresh each time."""
    lines = [
        f"Company: {state['company']['name']}",
        f"What it does: {state['company']['pitch'] or 'not stated'}",
        f"Week: {state['turn'] + 1}",
        f"Cash: ${state['cash']:,.0f}",
        f"Employees: {state['employees']}",
        f"Reputation: {state['reputation']}/100",
        f"Team morale: {state['morale']}/100",
        f"Last week: revenue ${state['last']['revenue']:,.0f}, profit ${state['last']['profit']:,.0f}",
        "Products:",
    ]
    for p in state["products"]:
        if p["active"]:
            lines.append(
                f"- {p['name']}: price {_money(p['price'])}, costs {_money(p['unit_cost'])} to make, "
                f"sold {p['units_sold']:,} last week, quality {p['quality']}/100"
            )
    if not any(p["active"] for p in state["products"]):
        lines.append("- none on sale")
    recent = state["log"][-3:]
    if recent:
        lines.append("Recent weeks:")
        for entry in recent:
            lines.append(f"- Week {entry['turn']}: the CEO chose \"{entry['decision']}\". {entry['narrative']}")
    if state.get("pending"):
        lines.append("Since last week the CEO also changed: " + "; ".join(state["pending"]) + ". Customers will have noticed.")
    lines.append(f"\nThis week the CEO decides: \"{decision}\"")
    return "\n".join(lines)


def apply_turn(
    state: dict,
    decision: str,
    reply: dict,
    rng: Optional[random.Random] = None,
    action: Optional[dict] = None,
) -> dict:
    """Apply the model's proposed effects, then play out one week. Returns the new state.

    `action` is a decision made with a dashboard form (see check_action): it is
    carried out exactly, whatever the model says about it.
    """
    action = action or {}
    rng = rng or random.Random()
    s = copy.deepcopy(state)
    effects = reply.get("effects") if isinstance(reply.get("effects"), dict) else {}
    # Changes made from the dashboard since last week lead this week's list.
    changes: list[str] = list(s.pop("pending", None) or [])
    active = {p["name"].lower(): p for p in s["products"] if p["active"]}

    stated_prices = _stated_prices(decision, list(active.values()))
    price_talk = bool(_PRICE_TOPIC.search(decision))
    proposed = {}
    for change in (effects.get("product_changes") or [])[:MAX_PRODUCTS]:
        if isinstance(change, dict):
            proposed.setdefault(_text(change.get("product"), 60).lower(), change)
    # The player changed prices without giving numbers ("reduce prices"). The model
    # tends to describe new prices in its story and leave them out of the effects,
    # so the change is made here: its figure if it gave a sensible one, else a step.
    direction = 0 if stated_prices else _price_direction(decision)
    named = [p for p in active.values() if p["name"].lower() in decision.lower()]
    repriced = {p["id"] for p in (named or active.values())} if direction else set()
    # A product whose price changes gets an entry even if the model left it out.
    for product in active.values():
        if product["id"] in stated_prices or product["id"] in repriced:
            proposed.setdefault(product["name"].lower(), {})

    for key, change in proposed.items():
        product = active.get(key)
        if not product:
            continue
        demand_pct = _clamp(_num(change.get("demand_change_pct")), -50, 60)
        new_price = stated_prices.get(product["id"]) or (_num(change.get("new_price")) if price_talk else 0)
        if product["id"] in repriced and (new_price <= 0 or (new_price - product["price"]) * direction <= 0):
            # Missing, unchanged, or moved the wrong way
            new_price = product["price"] * (1 + direction * DEFAULT_PRICE_STEP)
        if new_price > 0 and abs(new_price - product["price"]) / product["price"] > 0.005:
            new_price = round(_clamp(new_price, product["price"] * 0.4, product["price"] * 2.5), 2)
            price_pct = (new_price - product["price"]) / product["price"] * 100
            demand_pct = _clamp(demand_pct - PRICE_ELASTICITY * price_pct, -70, 80)
            changes.append(f"{product['name']} price {_money(product['price'])} to {_money(new_price)}")
            product["price"] = new_price
        quality = _clamp(_num(change.get("quality_change")), -20, 20)
        if quality:
            product["quality"] = round(_clamp(product["quality"] + quality, 0, 100))
        if abs(demand_pct) >= 0.5:
            product["demand"] = max(0, round(product["demand"] * (1 + demand_pct / 100)))
            changes.append(f"{product['name']} demand {demand_pct:+.0f}%")

    rename = _stated_rename(decision, s["company"]["name"], list(active.values()))
    if rename:
        kind, product, new_name = rename
        if kind == "company" and new_name != s["company"]["name"]:
            changes.append(f"Renamed the company to {new_name}")
            s["company"]["name"] = new_name
        elif kind == "product" and new_name.lower() not in active:
            changes.append(f"Renamed {product['name']} to {new_name}")
            del active[product["name"].lower()]
            product["name"] = new_name
            active[new_name.lower()] = product

    discontinued = effects.get("discontinued_products") if _DISCONTINUE_TOPIC.search(decision) else []
    if action.get("type"):
        dropped = _find_product(s, action.get("product_id", "")) if action["type"] == "discontinue" else None
        discontinued = [dropped["name"]] if dropped else []
    for name in (discontinued or [])[:MAX_PRODUCTS]:
        product = active.pop(_text(name, 60).lower(), None)
        if product:
            product["active"] = False
            changes.append(f"Discontinued {product['name']}")

    # What the player spelled out comes first: the model often tells the story of a
    # launch and forgets to list the product.
    launches = list(effects.get("new_products") or []) if _LAUNCH_TOPIC.search(decision) else []
    stated_launch = _stated_launch(decision, set(active))
    if stated_launch:
        launches = [stated_launch]
    if action.get("type"):
        launches = [action] if action["type"] == "launch" else []
    launch_cost = 0
    for item in launches[:2]:
        if not isinstance(item, dict) or len(active) >= MAX_PRODUCTS:
            continue
        name = _text(item.get("name"), 40)
        price = _num(item.get("price"))
        if not name or name.lower() in active or price <= 0:
            continue
        price = _clamp(price, 0.5, 1_000_000)
        unit_cost = _num(item.get("unit_cost")) or price * 0.4
        product = _product(name, price, _clamp(unit_cost, price * 0.05, price * 0.9), NEW_PRODUCT_REVENUE_TARGET, 55)
        s["products"].append(product)
        active[name.lower()] = product
        changes.append(f"Launched {name} at {_money(product['price'])}")
        launch_cost += LAUNCH_COST
    if launch_cost:
        changes.append(f"Launch cost {_money(launch_cost)}")

    hires = _stated_hires(decision)
    if hires is None:
        hires = _num(effects.get("hires")) if _STAFF_TOPIC.search(decision) else 0
    hires = int(_clamp(hires, -(s["employees"] - 1), 25))
    staffing_cost = hires * HIRING_COST if hires > 0 else -hires * SEVERANCE
    morale_change = _clamp(_num(effects.get("morale_change")), -15, 15)
    if hires:
        s["employees"] += hires
        changes.append(f"{hires:+d} staff")
        if hires < 0:
            morale_change = max(-15, morale_change - 2 * -hires)

    s["reputation"] = round(_clamp(s["reputation"] + _clamp(_num(effects.get("reputation_change")), -15, 15), 0, 100))

    one_time_cost = _clamp(_num(effects.get("one_time_cost")), 0, max(0, s["cash"]) + 50_000)
    one_time_income = _num(effects.get("one_time_income")) if _INCOME_TOPIC.search(decision) else 0
    one_time_income = _clamp(one_time_income, 0, max(100_000, 16 * s["last"]["revenue"]))
    if one_time_cost >= 1:
        changes.append(f"Spent {_money(one_time_cost)}")
    if one_time_income >= 1:
        changes.append(f"Raised {_money(one_time_income)}")

    # ---- Play out the week ----
    reputation_factor = 0.5 + s["reputation"] / 100
    wanted = []
    for p in s["products"]:
        if not p["active"]:
            p["units_sold"], p["revenue"] = 0, 0
            continue
        quality_factor = 0.7 + 0.5 * p["quality"] / 100
        wanted.append((p, p["demand"] * reputation_factor * quality_factor * rng.uniform(0.93, 1.07)))

    capacity = s["employees"] * REVENUE_PER_EMPLOYEE * (0.6 + 0.6 * (s["morale"] + morale_change) / 100)
    wanted_revenue = sum(units * p["price"] for p, units in wanted)
    scale = 1.0
    if wanted_revenue > capacity > 0:
        scale = capacity / wanted_revenue
        morale_change = max(-15, morale_change - 3)
        changes.append("Team at capacity: some orders went unfilled")

    revenue = cost_of_goods = 0.0
    for p, units in wanted:
        sold = max(0, round(units * scale))
        p["units_sold"] = sold
        p["revenue"] = round(sold * p["price"])
        revenue += sold * p["price"]
        cost_of_goods += sold * p["unit_cost"]
        # Word of mouth: a well-liked company slowly grows, a disliked one shrinks.
        p["demand"] = max(0, round(p["demand"] * (1 + (s["reputation"] - 50) / WORD_OF_MOUTH)))

    s["morale"] = round(_clamp(s["morale"] + morale_change, 0, 100))
    payroll = s["employees"] * SALARY
    overhead = FIXED_OVERHEAD + OVERHEAD_RATE * revenue
    costs = cost_of_goods + payroll + overhead + one_time_cost + staffing_cost + launch_cost
    profit = revenue + one_time_income - costs

    s["turn"] += 1
    s["cash"] = round(s["cash"] + profit)
    s["last"] = {"revenue": round(revenue), "costs": round(costs), "profit": round(profit)}
    s["history"] = (s["history"] + [{
        "turn": s["turn"], "revenue": round(revenue), "profit": round(profit),
        "cash": s["cash"], "employees": s["employees"],
    }])[-HISTORY_LIMIT:]

    reactions = []
    for item in (reply.get("reactions") or [])[:4]:
        if isinstance(item, dict) and _text(item.get("text"), 240):
            sentiment = item.get("sentiment")
            reactions.append({
                "source": _text(item.get("source"), 40) or "Someone",
                "text": _text(item.get("text"), 240),
                "sentiment": sentiment if sentiment in ("positive", "neutral", "negative") else "neutral",
            })
    s["reactions"] = reactions

    options = [_text(o, 90) for o in (reply.get("options") or []) if _text(o, 90)][:3]
    s["options"] = options if len(options) == 3 else list(DEFAULT_OPTIONS)

    narrative = _text(reply.get("narrative"), 900) or "The week passes without much to report."
    if s["cash"] < 0:
        s["status"] = "bankrupt"
        s["options"] = []
        narrative += " The company has run out of money."

    s["log"] = (s["log"] + [{
        "turn": s["turn"],
        "decision": decision,
        "narrative": narrative,
        "changes": changes,
        "reactions": reactions,
        "financials": {**s["last"], "cash": s["cash"]},
    }])[-LOG_LIMIT:]
    return s
