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

GAME_TYPE = "marketplace-hustle"
START_CASH = 1000
DAYS = 30
PRICE_SWING = (0.85, 1.15)     # how far a listing's price can move from one run to the next
MILESTONES = (2500, 5000, 10000, 25000)
BROKE_BELOW = 10               # less cash than this, and nothing to sell, ends the run

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


def unsold(run: dict) -> list[dict]:
    return [h for h in run["holdings"] if not h.get("sold")]


def net_worth(run: dict) -> int:
    """Cash, plus what was paid for everything still held."""
    return run["cash"] + sum(h["paid"] for h in unsold(run))


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
    return r


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
    item = {
        "id": str(uuid.uuid4()),
        "listing": scenario.get("id"),
        "title": scenario["item"],
        "paid": paid,
        "list_price": chat["list_price"],
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
    price = int(result["paid"])
    r["cash"] += price
    item["sold"] = {
        "price": price, "profit": price - item["paid"], "buyer": scenario["merchant"],
        "rating": result.get("rating"), "day": r["day"], "at": _now(),
    }
    r["ledger"].append({
        "day": r["day"], "kind": "sell", "item": item["title"], "other": scenario["merchant"],
        "amount": price, "balance": r["cash"], "holding": item["id"], "profit": price - item["paid"],
        "at": item["sold"]["at"],
    })
    _reach_milestones(r)
    return r


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
    broke = run["cash"] < max(BROKE_BELOW, math.floor(cheapest * 0.45)) and not unsold(run)
    if run["day"] < run["days"] and not broke:
        return run
    r = copy.deepcopy(run)
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
    return out


def summary(run: dict) -> dict:
    return {
        "status": run.get("status"),
        "cash": run.get("cash"),
        "day": run.get("day"),
        "days": run.get("days"),
        "net_worth": net_worth(run),
    }
