"""Reviews both ways once a chat is over, and the player's marketplace profile.

The other side's review of the player is decided in extras.review; here the model writes
its text in their voice. The player can rate the other side back, and what they leave
shows on that seller's profile from then on. No I/O in this file.
"""
import copy
import re
from collections import Counter
from datetime import datetime, timezone
from typing import Optional

from . import extras
from .engine import _money

GIVEN_KEPT = 50                # how many of the player's own reviews of others are kept
MAX_TEXT = 180                 # a review is a line, not a letter
MAX_YOUR_TEXT = 200
MAX_TOKENS = 80                # one short line; it shares the model with the chats, so it must not linger

REPLY_SCHEMA = {
    "type": "object",
    "properties": {"review": {"type": "string"}},
    "required": ["review"],
}

SYSTEM_PROMPT = """You write the short review a person leaves on an online marketplace, like eBay or Facebook Marketplace, after dealing with someone. Reply with JSON only: {"review": "..."}.

- Write as the person described, in their own voice and manner, about the other person as a buyer or seller.
- One sentence, under 20 words, the way real reviews read. Plain text: no emojis, no hashtags, no quotation marks.
- The tone matches the stars: 5 is warm, 3 is mixed, 1 is annoyed.
- Mention something that actually happened in the chat when it fits. Never invent what did not happen.
- Do not use the other person's name."""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


_ARTICLE = re.compile(r"^(the|a|an)\s+", re.I)


def describe_review(state: dict, clean: bool = False) -> str:
    """What the model is told to write the pending review from: who they are, and how the chat went."""
    scenario = state["scenario"]
    review = state["review"]
    result = state.get("result") or {}
    selling = review["role"] == "sell"
    # "your PS5", not "your The PS5"
    item, paid = _ARTICLE.sub("", scenario["item"]), result.get("paid")
    log = state.get("log") or []
    agreed = bool(log and log[-1].get("agreed"))

    if selling:
        happened = (
            f"You bought their {item} for {_money(paid)}. They first asked {_money(state['list_price'])}."
            if paid is not None
            else f"You wanted to buy their {item}, and they decided not to sell" + (" after agreeing a price." if agreed else ".")
        )
    else:
        happened = (
            f"You sold them your {item}, listed at {_money(state['list_price'])}, for {_money(paid)}."
            if paid is not None
            else f"They haggled over your {item} and left without buying" + (" after agreeing a price." if agreed else ".")
        )
    lines = [
        f"You are {scenario.get('merchant') or 'a marketplace user'}: {scenario.get('persona') or 'an ordinary person'}.",
        happened,
    ]
    insults = sum(1 for e in log if e.get("insulted"))
    if insults:
        lines.append(f"They named {'a price' if insults == 1 else f'{insults} prices'} you found insulting.")
    if state.get("bluffed"):
        lines.append("They pretended to walk away to get a better price.")
    if state.get("bounced"):
        lines.append("Their first payment bounced.")
    if "compliment" in (state.get("sweeteners") or []):
        lines.append("They were friendly and complimentary.")
    offered = [extras.sweetener(state.get("mode", "buy"), k) for k in state.get("sweeteners") or [] if k != "compliment"]
    if offered:
        lines.append("They offered: " + "; ".join(o[0].lower() for o in offered if o) + ".")
    flaw = state.get("flaw") or {}
    if flaw.get("revealed"):
        lines.append(f"They asked about something the listing left out: {flaw['text']}.")
    if clean or not scenario.get("swears"):
        lines.append("No swearing.")
    lines.append(
        f"You give them {review['stars']} out of 5 stars as a {'seller' if selling else 'buyer'}. "
        "Write the review that goes with them."
    )
    return "\n".join(lines)


_EMOJI = re.compile("[\U0001F000-\U0001FAFF\u2600-\u27BF\uFE0F]")
_DASHES = re.compile("\\s*[\u2014\u2013]\\s*")
_BEFORE_MARK = re.compile(r"\s+([,.!?])")


def tidy(text: str) -> str:
    """One clean line: no emojis, em dashes or wrapping quotes, cut at a sentence if it runs long."""
    text = _DASHES.sub(", ", _EMOJI.sub("", " ".join(str(text or "").split())))
    text = _BEFORE_MARK.sub(r"\1", text).strip().strip("\"'").strip()
    if len(text) > MAX_TEXT:
        cut = text[:MAX_TEXT]
        end = max(cut.rfind(". "), cut.rfind("! "), cut.rfind("? "))
        text = cut[: end + 1] if end > 40 else cut.rsplit(" ", 1)[0] + "."
    return text


def apply_text(state: dict, reply: dict) -> dict:
    """The pending review with the model's words, or its stock text if nothing usable came back."""
    s = copy.deepcopy(state)
    text = tidy(reply.get("review") or "")
    if len(text) >= 8:
        s["review"]["text"] = text
    s["review"]["pending"] = False
    return s


def with_text(account: dict, review: dict) -> dict:
    """The account with one of its reviews brought up to date, matched by id."""
    a = copy.deepcopy(account)
    a["reviews"] = [{**r, "text": review["text"], "pending": False} if r.get("id") == review["id"] else r
                    for r in a.get("reviews") or []]
    return a


# ---- Rating them back ----

def can_rate(state: dict) -> bool:
    """Only someone you actually dealt with, and only once."""
    result = state.get("result") or {}
    return result.get("paid") is not None and not state.get("your_review")


def rate(state: dict, stars: int, text: str) -> tuple[dict, dict]:
    """The chat with your review of the other side, and the entry kept on your profile."""
    if not can_rate(state):
        raise ValueError("You can only rate someone you made a deal with, once.")
    if not 1 <= stars <= 5:
        raise ValueError("Pick from 1 to 5 stars.")
    s = copy.deepcopy(state)
    scenario = s["scenario"]
    mine = {"stars": stars, "text": " ".join(text.split())[:MAX_YOUR_TEXT], "at": _now()}
    s["your_review"] = mine
    given = {
        **mine, "to": scenario.get("merchant") or "Someone", "item": scenario.get("item"),
        "listing": scenario.get("id"), "role": "sell" if s.get("mode") == "sell" else "buy",
    }
    return s, given


def add_given(account: dict, given: dict) -> dict:
    a = copy.deepcopy(account)
    a["given"] = ((a.get("given") or []) + [given])[-GIVEN_KEPT:]
    return a


def with_yours(seller: dict, given: list, listing: Optional[str]) -> dict:
    """A seller's public profile with the stars you gave them counted in."""
    yours = [g["stars"] for g in given if listing and g.get("listing") == listing and g.get("role") == "buy"]
    if not yours or not seller:
        return seller
    count = seller["ratings"] + len(yours)
    return {**seller, "rating": round((seller["rating"] * seller["ratings"] + sum(yours)) / count, 1), "ratings": count}


# ---- The profile ----

def _totals(rows: list[dict]) -> dict:
    """Bought, sold, spent, earned and the best flip, from purchases each with what it sold for if it has."""
    sold = [r["sold"] for r in rows if r.get("sold")]
    flips = [(r["sold"].get("profit"), r.get("title")) for r in rows if r.get("sold") and r["sold"].get("profit") is not None]
    best = max(flips, default=None, key=lambda f: f[0])
    return {
        "bought": len(rows),
        "sold": len(sold),
        "spent": sum(int(r.get("paid") or 0) for r in rows),
        "earned": sum(int(x.get("price") or 0) for x in sold),
        "best_flip": {"profit": best[0], "item": best[1]} if best and best[0] > 0 else None,
    }


def _add(a: dict, b: dict) -> dict:
    flips = [f for f in (a.get("best_flip"), b.get("best_flip")) if f]
    return {
        **{k: int(a.get(k) or 0) + int(b.get(k) or 0) for k in ("bought", "sold", "spent", "earned")},
        "best_flip": max(flips, key=lambda f: f["profit"]) if flips else None,
    }


def fold_run(account: dict, run: dict) -> dict:
    """Keep a Hustle run's trades on the profile before the run itself is cleared away."""
    a = copy.deepcopy(account)
    a["hustle_trades"] = _add(a.get("hustle_trades") or {}, _totals(run.get("holdings") or []))
    return a


def profile(account: dict, name: str, joined: Optional[str], rows: list[dict], run: Optional[dict] = None) -> dict:
    """Your marketplace profile: rating, how the stars split, what you have traded, and every review.
    `rows` are free play purchases, each with what it sold for if it has; `run` is the Hustle run
    still kept, whose trades join those of runs before it."""
    reviews = account.get("reviews") or []
    split = Counter(r["stars"] for r in reviews)
    trades = _add(_add(_totals(rows), account.get("hustle_trades") or {}), _totals((run or {}).get("holdings") or []))
    return {
        "name": name,
        "joined": joined,
        "rating": extras.rating(reviews),
        "review_count": len(reviews),
        "split": {str(n): split.get(n, 0) for n in range(5, 0, -1)},
        "trust": extras.trust_bonus(reviews),
        **trades,
        "reviews": reviews[::-1],
        "given": (account.get("given") or [])[::-1],
    }
