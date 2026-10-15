"""Hustle: Marketplace with real money.

A run starts with a set amount of cash and lasts a set number of days. Every
chat with a buyer or seller uses a day, whether or not it ends in a deal.
Buying spends the balance and adds the item to the run's holdings; selling a
holding adds the sale price back. When the days run out, or the player is
broke with nothing left to sell, the run ends and is scored on net worth:
cash plus what was paid for anything still held.

Prices move a little from run to run, so no single deal can be memorised.
The run lives in its own saved game; the chats that belong to it carry its id.
No I/O in this file.
"""
import copy
import math
import random
import uuid
from datetime import datetime, timezone
from typing import Optional

from .engine import market_value
from .extras import PROTECTION_DAYS

GAME_TYPE = "marketplace-hustle"
START_CASH = 1000
DAYS = 30
PRICE_SWING = (0.85, 1.15)     # how far a listing's price can move from one run to the next
MILESTONES = (2500, 5000, 10000, 25000)
BROKE_BELOW = 10               # less cash than this, and nothing to sell, ends the run
RESEARCH_FEE = 5               # checking sold listings in a chat
# Walk away from a seller and they may message again a few days later, at a lower price
CALLBACK_CHANCE = 0.5
CALLBACK_DAYS = (1, 3)         # how many days later
CALLBACK_OPEN = 3              # days the message stays worth answering
CALLBACK_CUT = 0.85            # their new price, as a share of their last one, never under their floor

RATINGS = [                    # (net worth as a multiple of the starting cash, verdict)
    (10.0, "Marketplace mogul"),
    (5.0, "Serious flipper"),
    (2.5, "Side hustle that works"),
    (1.2, "Up on the month"),
    (0.9, "Broke even, roughly"),
    (0.0, "Paid for the lesson"),
]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _nice(value: float, base: int) -> int:
    step = 1 if base < 200 else 5 if base < 1000 else 25 if base < 5000 else 50
    return max(1, int(round(value / step) * step))


def new_run(rng: Optional[random.Random] = None) -> dict:
    rng = rng or random.Random()
    return {
        "status": "active",          # active | finished | broke
        "start_cash": START_CASH,
        "cash": START_CASH,
        "day": 0,                    # chats started so far
        "days": DAYS,
        "price_seed": rng.randrange(1, 2**31),
        "holdings": [],
        "ledger": [],                # every purchase and sale, oldest first
        "milestones": [],
        "result": None,
    }


def price_of(run: dict, scenario: dict) -> int:
    """What a listing costs in this run: its usual price, moved a little, the same every time in the run."""
    swing = random.Random(f"{run['price_seed']}:{scenario['id']}").uniform(*PRICE_SWING)
    return _nice(scenario["list_price"] * swing, scenario["list_price"])


def prices(run: dict, scenarios: list[dict]) -> dict:
    return {s["id"]: price_of(run, s) for s in scenarios}


def value_of(run: dict, scenario: dict) -> int:
    """What a listing resells for in this run. It moves with the run, apart from its price."""
    return market_value(scenario, str(run["price_seed"]))


def values(run: dict, scenarios: list[dict]) -> dict:
    return {s["id"]: value_of(run, s) for s in scenarios}


def unsold(run: dict) -> list[dict]:
    return [h for h in run["holdings"] if not h.get("sold")]


def net_worth(run: dict) -> int:
    """Cash, plus what was paid for everything still held. A fake counts for what it is really worth."""
    return run["cash"] + sum(min(h["paid"], h.get("value") or 0) if h.get("fake") else h["paid"] for h in unsold(run))


def holding(run: dict, holding_id: str) -> Optional[dict]:
    return next((h for h in run["holdings"] if h["id"] == holding_id), None)


def start_chat(run: dict) -> dict:
    """A chat with a buyer or seller begins, and uses a day."""
    if run["status"] != "active":
        raise ValueError("This run is over. Start a new one.")
    if run["day"] >= run["days"]:
        raise ValueError(f"Your {run['days']} days are up.")
    r = copy.deepcopy(run)
    r["day"] += 1
    _pay_claims(r)
    return r


def file_claim(run: dict, amount: int, item: str) -> tuple[dict, int]:
    """A Purchase Protection refund, paid a few days from now. Returns the run and the day it arrives."""
    r = copy.deepcopy(run)
    due = r["day"] + PROTECTION_DAYS
    r["claims"] = (r.get("claims") or []) + [{"amount": amount, "item": item, "due": due}]
    return r, due


def _pay_claims(r: dict, everything: bool = False) -> None:
    """Pay out the claims whose day has come, or all of them when the run ends."""
    due = [c for c in r.get("claims") or [] if everything or c["due"] <= r["day"]]
    for claim in due:
        r["cash"] += claim["amount"]
        r["ledger"].append({
            "day": r["day"], "kind": "refund", "item": claim["item"], "other": "Purchase Protection",
            "amount": claim["amount"], "balance": r["cash"], "at": _now(),
        })
    r["claims"] = [c for c in r.get("claims") or [] if c not in due]
    if due:
        _reach_milestones(r)


def can_pay(run: dict, amount: int) -> bool:
    return run["cash"] >= amount


def record_purchase(run: dict, chat: dict) -> dict:
    """A purchase paid for in a chat: the money leaves the balance and the item joins the holdings."""
    result, scenario = chat["result"], chat["scenario"]
    paid = int(result["paid"])
    if not can_pay(run, paid):
        raise ValueError(f"You only have ${run['cash']:,} in your account.")
    r = copy.deepcopy(run)
    r["cash"] -= paid
    if (result.get("pickup") or {}).get("kind") == "scam":
        # The money is gone and nothing came of it
        r["ledger"].append({
            "day": r["day"], "kind": "buy", "item": scenario["item"], "other": scenario["merchant"],
            "amount": -paid, "balance": r["cash"], "at": _now(), "note": "Scammed",
        })
        return r
    item = {
        "id": str(uuid.uuid4()),
        "listing": scenario.get("id"),
        "title": scenario["item"],
        "paid": paid,
        "list_price": chat["list_price"],
        "value": chat.get("value") or chat["list_price"],
        "saved": result.get("saved"),
        "score": result.get("score", 0),
        "rating": result.get("rating"),
        "rounds": result.get("rounds"),
        "merchant": scenario["merchant"],
        "difficulty": chat.get("difficulty", "normal"),
        **{k: scenario.get(k) for k in ("condition", "category", "description", "setting")},
        "day": r["day"],
        "bought_at": _now(),
        "sold": None,
        # What turned up at pickup
        "fake": (result.get("pickup") or {}).get("kind") == "counterfeit",
        "flaw": (chat.get("flaw") or {}).get("text"),
    }
    r["holdings"].append(item)
    r["ledger"].append({
        "day": r["day"], "kind": "buy", "item": item["title"], "other": scenario["merchant"],
        "amount": -paid, "balance": r["cash"], "holding": item["id"], "at": item["bought_at"],
    })
    _reach_milestones(r)
    return r


def record_sale(run: dict, chat: dict) -> dict:
    """A sale accepted in a chat: the money arrives and the holding is marked sold."""
    result, scenario = chat["result"], chat["scenario"]
    r = copy.deepcopy(run)
    item = holding(r, chat.get("inventory_id") or "")
    if not item or item.get("sold"):
        raise ValueError("That is no longer yours to sell.")
    # A payment that bounced brings nothing in, and the item is gone all the same
    price = 0 if result.get("scammed") else int(result["paid"])
    r["cash"] += price
    item["sold"] = {
        "price": price, "profit": price - item["paid"], "buyer": scenario["merchant"],
        "rating": result.get("rating"), "day": r["day"], "at": _now(), "scammed": bool(result.get("scammed")),
    }
    r["ledger"].append({
        "day": r["day"], "kind": "sell", "item": item["title"], "other": scenario["merchant"],
        "amount": price, "balance": r["cash"], "holding": item["id"], "profit": price - item["paid"],
        "at": item["sold"]["at"], **({"note": "Payment bounced"} if result.get("scammed") else {}),
    })
    _reach_milestones(r)
    return r


def charge(run: dict, amount: int, item: str, note: str) -> dict:
    """A small cost in a chat, such as checking sold listings."""
    if not can_pay(run, amount):
        raise ValueError(f"You only have ${run['cash']:,} in your account.")
    r = copy.deepcopy(run)
    r["cash"] -= amount
    r["ledger"].append({
        "day": r["day"], "kind": "fee", "item": item, "other": note, "amount": -amount, "balance": r["cash"], "at": _now(),
    })
    return r


def refund(run: dict, amount: int, item: str, other: str) -> dict:
    """Money back from a seller at pickup."""
    r = copy.deepcopy(run)
    r["cash"] += amount
    r["ledger"].append({
        "day": r["day"], "kind": "refund", "item": item, "other": other, "amount": amount, "balance": r["cash"], "at": _now(),
    })
    _reach_milestones(r)
    return r


def maybe_callback(run: dict, chat: dict, rng: Optional[random.Random] = None) -> dict:
    """After walking away from a seller, they may message again in a few days with a lower price."""
    rng = rng or random.Random()
    if chat.get("scam") or rng.random() >= CALLBACK_CHANCE or not chat.get("scenario", {}).get("id"):
        return run
    r = copy.deepcopy(run)
    price = max(chat["floor"], _nice(chat["ask"] * CALLBACK_CUT, chat["list_price"]))
    if price >= chat["ask"]:
        return run
    due = r["day"] + rng.randint(*CALLBACK_DAYS)
    r["callbacks"] = (r.get("callbacks") or []) + [{
        "id": uuid.uuid4().hex[:12], "scenario": chat["scenario"]["id"], "merchant": chat["scenario"]["merchant"],
        "item": chat["scenario"]["item"], "price": price, "was": chat["ask"], "due": due, "expires": due + CALLBACK_OPEN,
    }]
    return r


def due_callbacks(run: dict) -> list[dict]:
    return [c for c in run.get("callbacks") or [] if c["due"] <= run["day"] <= c["expires"]]


def take_callback(run: dict, callback_id: str) -> tuple[dict, dict]:
    """Answer a seller's message: it is used up whether or not a deal comes of it."""
    callback = next((c for c in due_callbacks(run) if c["id"] == callback_id), None)
    if not callback:
        raise ValueError("That message has gone cold")
    r = copy.deepcopy(run)
    r["callbacks"] = [c for c in r["callbacks"] if c["id"] != callback_id]
    return r, callback


def _reach_milestones(r: dict) -> None:
    worth = net_worth(r)
    for mark in MILESTONES:
        if worth >= mark and mark not in r["milestones"]:
            r["milestones"].append(mark)


def _rating(worth: int, start: int) -> str:
    multiple = worth / max(1, start)
    return next(label for least, label in RATINGS if multiple >= least)


def settle(run: dict, cheapest: int) -> dict:
    """After a chat ends: close the run if the days are spent or the player is broke.
    `cheapest` is the lowest price anything is listed at, below which cash buys nothing."""
    if run["status"] != "active":
        return run
    pending = sum(c["amount"] for c in run.get("claims") or [])
    broke = run["cash"] + pending < max(BROKE_BELOW, math.floor(cheapest * 0.45)) and not unsold(run)
    if run["day"] < run["days"] and not broke:
        return run
    r = copy.deepcopy(run)
    _pay_claims(r, everything=True)     # the run is over: whatever is owed arrives now
    worth = net_worth(r)
    flips = [h["sold"]["profit"] for h in r["holdings"] if h.get("sold")]
    r["status"] = "broke" if broke else "finished"
    r["result"] = {
        "net_worth": worth,
        "cash": r["cash"],
        "profit": worth - r["start_cash"],
        "rating": _rating(worth, r["start_cash"]),
        "days_used": r["day"],
        "bought": len(r["holdings"]),
        "sold": len(flips),
        "best_flip": max(flips) if flips else None,
        "worst_flip": min(flips) if flips else None,
        "ended_at": _now(),
    }
    return r


def score_detail(run: dict) -> dict:
    """What a finished run records beside its score."""
    return {**run["result"], "outcome": run["status"], "start_cash": run["start_cash"], "milestones": run["milestones"]}


def public(run: dict) -> dict:
    """The run as the player sees it. The price seed stays out: it would give every price away."""
    out = {k: v for k, v in run.items() if k != "price_seed"}
    out["net_worth"] = net_worth(run)
    # Only messages that have arrived: one due later is not known yet
    out["callbacks"] = due_callbacks(run)
    return out


def summary(run: dict) -> dict:
    return {
        "status": run.get("status"),
        "cash": run.get("cash"),
        "day": run.get("day"),
        "days": run.get("days"),
        "net_worth": net_worth(run),
    }
