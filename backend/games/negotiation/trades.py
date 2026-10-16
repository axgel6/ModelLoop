"""Trades: something you own, and cash if you like, instead of money alone.

Buying, you offer one of your items to the seller. The game judges it against what they would
take in cash (a seller who collects that kind of thing values it more, and some only want
cash); the model says it in their voice, and a yes leaves a trade standing for you to confirm.
Selling, a buyer may offer one of their things, which comes with its own hidden flaw, like
anything else bought on Marketplace. No I/O in this file.
"""
import copy
import random
from typing import Optional

from . import extras
from .engine import (
    LOG_LIMIT, MAX_REPLY, MODEL_CONTEXT_ROUNDS, NEUTRAL_REPLIES, SCENARIOS, _fill, _money, _nice, _reserve, accept,
    market_value, now, scenario_for,
)

CASH_ONLY_SHARE = 0.3          # sellers who will not hear of a trade
SAME_KIND_BONUS = 0.15         # a seller values a trade from their own category this much more
COUNTER_REACH = 0.7            # a trade worth this share of what they would take gets a counter, not a no
TRADE_PATIENCE = 1
TRADE_IN_SHARE = 0.2           # selling: the share of buyers who offer a trade alongside their cash offer
TRADE_IN_WORTH = (0.25, 0.7)   # ...of something worth this share of yours


# ---- Buying: offer one of yours ----

def cash_only(state: dict) -> bool:
    """A scammer wants money; some honest sellers do too. The same answer every time for the same seller."""
    scenario = state["scenario"]
    return bool(state.get("scam")) or random.Random(f"trade:{scenario.get('id')}").random() < CASH_ONLY_SHARE


def can_trade(state: dict) -> bool:
    return state.get("status") == "active" and state.get("mode") != "sell" and not state.get("final")


def judge(state: dict, item: dict, cash: int) -> dict:
    """What the seller makes of `item` plus `cash`: accept, counter (with the cash they would want), decline or cash only."""
    offer = {"item_id": item["id"], "item": item["title"], "value": int(item["value"]), "paid": item.get("paid"),
             "category": item.get("category"), "cash": int(cash)}
    if cash_only(state):
        return {**offer, "verdict": "cash_only"}
    bonus = SAME_KIND_BONUS if item.get("category") and item.get("category") == state["scenario"].get("category") else 0.0
    worth = offer["value"] * (1 + bonus) + offer["cash"]
    reserve = _reserve(state)
    if worth >= reserve:
        return {**offer, "verdict": "accept"}
    if worth >= reserve * COUNTER_REACH:
        add = _nice(reserve - worth, state["list_price"])
        return {**offer, "verdict": "counter", "counter": offer["cash"] + add}
    return {**offer, "verdict": "decline"}


_INSTRUCTIONS = {
    "accept": "Instruction for this round: ACCEPT THE TRADE. You will take it. Say yes in character, in a sentence or two. Do not write {price} or any number.",
    "counter": "Instruction for this round: COUNTER. You would do the trade if they add {price} in cash. Say so in character. Write {price} for that amount.",
    "decline": "Instruction for this round: DECLINE. The trade is not enough for you. Turn it down in your own way, and say cash still works. Do not write {price} or any number.",
    "cash_only": "Instruction for this round: DECLINE. You only want cash, no trades. Say so in your own way. Do not write {price} or any number.",
}


def describe_trade_for_model(state: dict, message: str, verdict: dict, clean: bool = False) -> str:
    scenario = state["scenario"]
    lines = [
        f"You are {scenario['merchant']}, the seller. Personality: {scenario['persona']}.",
        *extras.swearing(scenario, clean),
        *extras.manner(scenario),
        f"{scenario['merchant']} is your own name. The buyer is someone else: never call them {scenario['merchant']}.",
        "",
        f"You are selling: {scenario['item']}, listed at {_money(state['list_price'])}.",
        f"Your price now stands at {_money(state['ask'])}.",
        "",
        "The chat so far:",
        "Buyer: Hi, is this still available?",
        f"You: {state['opening']}",
    ]
    for entry in state["log"][-MODEL_CONTEXT_ROUNDS:]:
        lines.append(f"Buyer: {entry['you']}")
        lines.append(f"You: {entry['reply']}")
    cash = f" plus {_money(verdict['cash'])} in cash" if verdict["cash"] else ""
    lines += [
        "",
        f"Buyer's latest message: {message}",
        f"They are offering a trade: their {verdict['item']}{cash}, instead of paying your price.",
        f"Remember: you are {scenario['merchant']}, the SELLER. Rate this 0 with move haggle.",
        "",
        _INSTRUCTIONS[verdict["verdict"]],
    ]
    return "\n".join(lines)


def trade_message(verdict: dict) -> str:
    cash = f" plus {_money(verdict['cash'])}" if verdict["cash"] else ""
    return f"Would you take my {verdict['item']}{cash} for it?"


def apply_trade(state: dict, message: str, verdict: dict, reply: dict) -> dict:
    """The seller answers the trade. A yes or a counter stands until the next message, for the player to confirm."""
    s = copy.deepcopy(state)
    text = " ".join(str(reply.get("reply") or "").split())[:MAX_REPLY]
    text = extras.tidy_reply(text, [s.get("opening") or ""] + [e.get("reply") or "" for e in s["log"]], NEUTRAL_REPLIES, s["scenario"])
    counter = verdict.get("counter")
    said = _fill(text, counter, (verdict["cash"], s["list_price"], s["ask"])) if counter else text
    if not said:
        said = {"accept": "Deal, I'll take the trade.", "counter": f"Add {_money(counter or 0)} and you've got a deal.",
                "decline": "Not for me, sorry. Cash still works.", "cash_only": "Cash only, sorry."}[verdict["verdict"]]
    if counter and _money(counter) not in said:
        said = f"{said} Add {_money(counter)} and it's a deal."
    s["turn"] += 1
    s["patience"] = max(0, s["patience"] - TRADE_PATIENCE)
    s["final"] = s["final"] or s["patience"] <= 0
    s["traded"] = True
    standing = verdict["verdict"] in ("accept", "counter")
    s["trade_offer"] = {**verdict, "cash": counter if counter else verdict["cash"]} if standing else None
    entry = {
        "turn": s["turn"], "you": message, "offer": None, "persuasion": 0, "insulted": False, "repeated": False,
        "trade": verdict, "reply": said, "ask": s["ask"], "final": s["final"], "agreed": False, "at": now(),
    }
    s["log"] = (s["log"] + [entry])[-LOG_LIMIT:]
    return s


def accept_trade(state: dict, scams: bool = False, rng: Optional[random.Random] = None) -> dict:
    """Confirm the trade that stands. It is a purchase at what the trade is worth, of which only the cash leaves your account."""
    offer = state.get("trade_offer")
    if state.get("status") != "active" or not offer:
        raise ValueError("There is no trade on the table")
    s = copy.deepcopy(state)
    s["ask"] = offer["cash"] + offer["value"]
    s = accept(s, scams=scams, rng=rng)
    s["result"]["paid_cash"] = offer["cash"]
    s["result"]["trade"] = {"gave": offer["item"], "gave_id": offer["item_id"], "value": offer["value"], "cash": offer["cash"]}
    s["trade_offer"] = None
    return s


# ---- Selling: a buyer offers one of theirs ----

def trade_in(rng: random.Random, worth: int, ceiling: int, category: Optional[str]) -> Optional[dict]:
    """Now and then a buyer has something to trade, worth less than yours, with cash to make up the gap."""
    if rng.random() >= TRADE_IN_SHARE:
        return None
    low, high = worth * TRADE_IN_WORTH[0], worth * TRADE_IN_WORTH[1]
    pool = [s for s in SCENARIOS if not s.get("scam") and low <= market_value(s) <= high]
    if not pool:
        return None
    # Something from the same corner of the market, if they have it
    same = [s for s in pool if s.get("category") == category]
    pick = rng.choice(same if same and rng.random() < 0.5 else pool)
    value = market_value(pick)
    gap = ceiling * rng.uniform(0.8, 0.95) - value
    cash = _nice(gap, worth) if gap > 0 else 0
    if cash <= 0 and value < worth * 0.5:
        return None
    return {"listing": pick["id"], "item": pick["item"], "value": value, "cash": int(cash), "category": pick.get("category")}


def trade_in_line(trade: dict) -> str:
    cash = f" plus {_money(trade['cash'])}" if trade["cash"] else ""
    return f"Or would you trade for my {trade['item']}{cash}?"


def accept_trade_in(state: dict, finish, rng: Optional[random.Random] = None) -> dict:
    """Take the buyer's trade: their cash, and their item, which may turn out to have a flaw they kept quiet about.
    `finish` is selling's own _finish."""
    trade = state.get("trade_in")
    if state.get("status") != "active" or not trade:
        raise ValueError("There is no trade on the table")
    rng = rng or random.Random()
    s = copy.deepcopy(state)
    finish(s, "sold", trade["cash"] + trade["value"])
    got = scenario_for(trade["listing"])
    flaw = extras.deal_flaw(got, rng)
    value = trade["value"]
    if flaw:
        loss = round(value * flaw["loss"])
        value = max(1, value - loss)
        # Theirs to keep quiet about, like any seller's: found once it is yours
        s["result"]["pickup"] = {"kind": "trade_flaw", "loss": loss, "issue": f"Their {trade['item']}: {flaw['text']}."}
    else:
        s["result"]["pickup"] = {"kind": "fine", "issue": f"Swapped. Their {trade['item']} is as described."}
    s["result"]["paid_cash"] = trade["cash"]
    s["result"]["trade"] = {
        "got": trade["item"], "listing": trade["listing"], "value": value, "worth": trade["value"], "cash": trade["cash"],
        "flaw": flaw["text"] if flaw else None,
        **{k: got.get(k) for k in ("category", "condition", "description", "setting")},
    }
    return s
