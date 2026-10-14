"""The free play bank account: money for Marketplace outside a Hustle run.

Purchases come out of it and sales go into it, as in Hustle, but there are no
days and no score. It is a
sandbox: money can be deposited out of thin air and withdrawn into it, as much
as the player likes. No I/O in this file.
"""
import copy
from datetime import datetime, timezone
from typing import Optional

from . import extras

GAME_TYPE = "marketplace-bank"
START_CASH = 10_000
LEDGER_LIMIT = 200
MAX_MOVE = 1_000_000_000       # the most one deposit or withdrawal can be, to keep the numbers sane


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_account() -> dict:
    # `deposited` is what came in from nowhere less what went out to it, so trading profit can leave it out
    return {"start_cash": START_CASH, "cash": START_CASH, "deposited": 0, "ledger": [], "opened_at": _now()}


def can_pay(account: dict, amount: int) -> bool:
    return account["cash"] >= amount


def record(account: dict, kind: str, amount: int, item: str, other: str, profit: Optional[int] = None) -> dict:
    """A purchase (`kind` buy) or fee (money out), or a sale or refund (money in). `amount` is positive either way."""
    if kind in ("buy", "fee") and not can_pay(account, amount):
        raise ValueError(f"You only have ${account['cash']:,} in your account.")
    a = copy.deepcopy(account)
    signed = -amount if kind in ("buy", "fee") else amount
    a["cash"] += signed
    entry = {"kind": kind, "item": item, "other": other, "amount": signed, "balance": a["cash"], "at": _now()}
    if profit is not None:
        entry["profit"] = profit
    a["ledger"] = (a["ledger"] + [entry])[-LEDGER_LIMIT:]
    return a


def move(account: dict, kind: str, amount: int) -> dict:
    """A deposit (money from nowhere) or a withdrawal (money into nowhere). A withdrawal cannot go below zero."""
    if kind not in ("deposit", "withdraw"):
        raise ValueError("Deposit or withdraw")
    if not 0 < amount <= MAX_MOVE:
        raise ValueError(f"Pick an amount between $1 and ${MAX_MOVE:,}")
    if kind == "withdraw" and amount > account["cash"]:
        raise ValueError(f"You only have ${account['cash']:,} to withdraw.")
    a = copy.deepcopy(account)
    signed = amount if kind == "deposit" else -amount
    a["cash"] += signed
    a["deposited"] = a.get("deposited", 0) + signed
    entry = {"kind": kind, "item": "Deposit" if kind == "deposit" else "Withdrawal", "other": "", "amount": signed,
             "balance": a["cash"], "at": _now()}
    a["ledger"] = (a["ledger"] + [entry])[-LEDGER_LIMIT:]
    return a


def add_review(account: dict, review: Optional[dict]) -> dict:
    """Keep a review someone left after a chat. The account doubles as the player's marketplace profile."""
    if not review:
        return account
    a = copy.deepcopy(account)
    a["reviews"] = ((a.get("reviews") or []) + [{**review, "at": _now()}])[-extras.REVIEWS_KEPT:]
    return a
