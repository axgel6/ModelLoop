"""What a Marketplace chat has beyond the price: sweeteners, hidden flaws, deadlines and reviews.

Shared by buying (engine.py) and selling (selling.py). No I/O in this file.
"""
import re
from statistics import mean
from typing import Optional

# ---- Sweeteners: terms other than money, each usable once per chat ----

# id: (label on the chip, what is said if nothing is typed, what the other side is told)
SWEETENERS = {
    "buy": {
        "cash": ("Cash, today", "I can pay cash, today.", "The buyer offers to pay cash today."),
        "pickup": ("Pick up now", "I can come pick it up right now.", "The buyer offers to come and collect it right away."),
        "shipping": ("Cover shipping", "I'll cover the shipping.", "The buyer offers to pay for shipping themselves."),
    },
    "sell": {
        "dropoff": ("Drop it off", "I can drop it off to you.", "The seller offers to drop it off at your place."),
        "hold": ("Hold it for you", "I'll hold it for you, no one else gets it.", "The seller offers to hold it for you only."),
        "anytime": ("Pickup any time", "Pick it up whenever suits you.", "The seller offers pickup at any time that suits you."),
    },
}
SWEETENER_BONUS = 1            # a sweetener lifts how persuasive the message was by this, up to the usual 2


def sweetener(mode: str, key: Optional[str]) -> Optional[tuple]:
    return SWEETENERS["sell" if mode == "sell" else "buy"].get(key or "")


def ships(scenario: dict) -> bool:
    """Whether the listing offers shipping at all, as against local pickup only."""
    return "shipping" in str(scenario.get("setting") or "").lower()


# ---- Hidden flaws: buying only. Found by asking, or found at pickup ----

FLAW_CHANCE = 0.35
# (the flaw, words that show the buyer asked about it, share of the resale value it costs)
_FLAWS = {
    "tech": [
        ("the battery health is down to 76 percent", ("battery", "charge", "health"), 0.20),
        ("there is a dead pixel near the top corner", ("screen", "pixel", "display"), 0.15),
        ("the charging port only works if you wiggle the cable", ("port", "charging", "usb", "cable"), 0.15),
        ("it runs hot and the fan gets loud", ("fan", "noise", "hot", "temperature", "temps", "loud"), 0.15),
    ],
    "console": [
        ("the left stick drifts", ("drift", "stick", "controller", "joystick"), 0.15),
        ("the disc drive is loud and sometimes will not read", ("disc", "drive", "read", "noise", "loud"), 0.20),
        ("it was banned from online play", ("online", "ban", "banned", "account", "network"), 0.25),
    ],
    "games": [
        ("the disc has a deep scratch and freezes in one spot", ("scratch", "disc", "freeze", "play", "work", "tested"), 0.40),
        ("the manual is a photocopy", ("manual", "complete", "original", "insert"), 0.25),
    ],
    "vehicle": [
        ("the check engine light comes on now and then", ("engine", "light", "warning", "mechanic", "service"), 0.12),
        ("the AC blows warm", ("ac", "air", "aircon", "cool", "cold", "a/c"), 0.06),
        ("it has a salvage title", ("title", "accident", "salvage", "crash", "history"), 0.30),
    ],
    "fashion": [
        ("there is a small stain inside that will not come out", ("stain", "mark", "clean", "wash"), 0.20),
        ("the zipper sticks", ("zip", "zipper", "zips"), 0.12),
        ("the authenticity card and receipt are missing", ("authentic", "receipt", "card", "real", "fake", "legit"), 0.25),
    ],
    "jewelry": [
        ("the clasp is loose", ("clasp", "lock", "loose", "secure"), 0.15),
        ("the plating is wearing through in places", ("plating", "plated", "solid", "wear", "tarnish", "karat", "gold"), 0.35),
    ],
    "fragrance": [
        ("it was stored in a hot car and smells off", ("stored", "smell", "heat", "batch", "fresh", "old"), 0.40),
        ("the bottle is about a third emptier than it looks", ("full", "left", "level", "much", "used", "ml"), 0.30),
    ],
    "tickets": [
        ("the seats are partial view behind a speaker stack", ("view", "seats", "see", "stage", "obstructed"), 0.30),
    ],
    "general": [
        ("there is a scuff the photos do not show", ("scuff", "scratch", "marks", "dent", "photos"), 0.10),
        ("it smells strongly of smoke", ("smoke", "smell", "smoker", "pets", "pet"), 0.20),
        ("one piece is missing", ("missing", "complete", "included", "everything", "pieces", "parts"), 0.15),
    ],
}
_FLAW_GROUP = {
    "PC and gear": "tech", "Apple and phones": "tech", "Consoles": "console", "Controllers and accessories": "console",
    "Bundles": "console", "Games": "games", "Vehicles": "vehicle", "Bags": "fashion", "Clothing and shoes": "fashion",
    "Dupes": "fashion", "Jewelry": "jewelry", "Fragrance": "fragrance", "Tickets": "tickets",
}
# Asking straight out whether anything is wrong finds any flaw
_ANY_FLAW = ("problem", "issue", "wrong", "flaw", "defect", "damage", "damaged", "catch", "honest", "broken", "faults", "fault")


def deal_flaw(category: Optional[str], rng) -> Optional[dict]:
    if rng.random() >= FLAW_CHANCE:
        return None
    text, words, loss = rng.choice(_FLAWS.get(_FLAW_GROUP.get(category or "", "general"), _FLAWS["general"]))
    return {"text": text, "words": list(words), "loss": loss, "revealed": False}


def asks_about(flaw: Optional[dict], message: str) -> bool:
    """Whether the buyer's message asks about the flaw, or about flaws at all."""
    if not flaw or flaw.get("revealed"):
        return False
    said = set(re.findall(r"[a-z/]+", message.lower()))
    return bool(said & set(flaw["words"]) or said & set(_ANY_FLAW))


def flaw_hint(flaw: Optional[dict]) -> str:
    """What sold listings say: where to look, without saying what is wrong."""
    if not flaw:
        return "These look clean: nothing commonly goes wrong with them."
    return f"People who bought these often bring up the {flaw['words'][0]}. Worth asking about."


def sold_listings(state: dict) -> str:
    """Checking sold listings: what one in good shape sells for, and what tends to go wrong."""
    value = state.get("value")
    flaw = state.get("flaw")
    if value and flaw and flaw.get("revealed"):
        # The flaw already knocked this one's worth down; sold listings show the going rate
        value = round(value / (1 - flaw["loss"]))
    going = f"Similar ones sell for about ${int(value):,}. " if value else ""
    return going + flaw_hint(flaw)


# ---- Deadlines: buying only. Some sellers have to be rid of it soon ----

DEADLINE_ROUNDS = 6
DEADLINE_SLIDE = 0.06          # each round the seller's resistance drops by this, as the clock runs down
DEADLINE_RIVAL = 0.10          # from the third round, the chance each round that someone else buys it first
_DEADLINE = re.compile(r"\b(tonight|today|friday|thursday|this week|moving|must go|leaving|movers|asap)\b", re.I)


def has_deadline(scenario: dict) -> bool:
    if scenario.get("category") == "Tickets":
        return True
    text = " ".join(str(scenario.get(k) or "") for k in ("item", "persona", "description", "opening"))
    return bool(_DEADLINE.search(text))


# ---- Unhinged characters: a friend with a sailor's mouth ----

SWEARING = (
    "You have a sailor's mouth: swear freely and casually in nearly every message (fuck, shit, damn, hell, "
    "bastard and the like), the way some friends talk. It is for colour and comedy, never aimed at the other "
    "person as an insult, and never a slur or anything hateful. You are still friendly underneath."
)


CLEAN_SWEARING = (
    "You are loud, colourful and dramatic, but the player has asked for clean language: no swearing at all. "
    "Say heck, dang or freaking instead."
)


def swearing(scenario: dict, clean: bool = False) -> list[str]:
    """The extra line for a character who swears, or nothing for everyone else. With `clean`, the
    player's Marketplace setting, they keep their energy and lose the language."""
    if not scenario.get("swears"):
        return []
    return [CLEAN_SWEARING if clean else SWEARING]


# ---- Reviews: after every chat, the other side may rate you ----

REVIEWS_KEPT = 50
TRUST_MIN_REVIEWS = 3
TRUST_LOW = 3.5                # below this average, people have one less patience with you
TRUST_HIGH = 4.7               # at or above it, one more
_REVIEW_TEXT = {
    5: "Smooth deal. Would trade again.",
    4: "Good trade.",
    3: "Haggled hard, but we got there.",
    2: "Backed out after we agreed.",
    1: "Rude and wasted my time.",
}


def review(state: dict) -> Optional[dict]:
    """The stars the other side leaves when a chat ends, or None if they would not bother."""
    result = state.get("result") or {}
    outcome = result.get("outcome")
    log = state.get("log") or []
    insults = sum(1 for e in log if e.get("insulted"))
    agreed = bool(log and log[-1].get("agreed")) or (state.get("opening_agreed") and not log)
    if outcome in ("deal", "sold"):
        stars = 5 - min(2, insults) - (1 if state.get("bluffed") else 0)
        stars = max(3, stars)
    elif outcome in ("walked", "kept"):
        if agreed:
            stars = 2
        elif insults >= 2:
            stars = 1
        elif insults:
            stars = 3
        else:
            return None
    else:
        return None
    return {"stars": stars, "text": _REVIEW_TEXT[stars], "by": state["scenario"].get("merchant") or "Someone"}


def rating(reviews: list) -> Optional[float]:
    return round(mean(r["stars"] for r in reviews), 1) if reviews else None


def trust_bonus(reviews: list) -> int:
    """How your reviews change the patience people have with you."""
    if len(reviews) < TRUST_MIN_REVIEWS:
        return 0
    score = rating(reviews) or 0
    return 1 if score >= TRUST_HIGH else -1 if score < TRUST_LOW else 0
