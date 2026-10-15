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


# Some characters are written to be cutting, or to say the same thing again. For them, the jabs and
# the stock lines are the character, so the prompt allows them and tidy_reply leaves them in.
RUDE = (
    "Your personality lets you be cutting: a dry jab or a bit of attitude when they lowball, nag or "
    "waste your time is in character. Keep it to the haggle. Nothing hateful, no threats, nothing about who they are."
)
REPEATS = (
    "You have a stock line or two, as your personality says, and you keep coming back to them. "
    "Saying the same thing again is in character for you."
)


def manner(character: dict) -> list[str]:
    """The extra lines for a character written to be rude or to repeat themselves, or nothing."""
    return [line for key, line in (("rude", RUDE), ("repeats", REPEATS)) if character.get(key)]


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


# ---- The listing's own downsides, as arguments the buyer can make ----
# Small models score a fair point low once they have decided to hold their price, so a buyer who
# points at a downside the listing itself admits to is credited in code. Each entry: what to call it,
# what in the listing makes it a downside, what a buyer says to bring it up, and whether "no"/"never"
# in front of it in the listing turns it into a selling point ("no scratches").
_DOWNSIDES = (
    ("the missing box",
     r"\bno (original )?box\b|\bwithout (the |its |a )?(original )?box\b|\bbox (is )?(not included|missing)\b",
     r"\bbox(es)?\b", False),
    ("the stick drift", r"\bdrift", r"\bdrift", True),
    ("the scratches", r"\bscratch|\bscuff", r"\bscratch|\bscuff", True),
    ("the dents", r"\bdent(s|ed)?\b", r"\bdent", True),
    ("the cracks", r"\bcrack|\bchipped\b", r"\bcrack|\bchip", True),
    ("the wear", r"\bworn\b|\bwear\b|\bfad(ed|ing)\b|\bpeel|\bcreas", r"\bworn\b|\bwear\b|\bfad(e|ed|ing)\b|\bpeel|\bcreas", True),
    ("the stains", r"\bstain", r"\bstain", True),
    ("the tears", r"\btorn\b|\bripped\b|\brips?\b", r"\btorn\b|\bripped\b|\brips?\b|\btears?\b", True),
    ("the noise", r"\brattl|\bloud\b|\bnois|\bsqueak|\bbuzz", r"\brattl|\bloud\b|\bnois|\bsqueak|\bbuzz|\bfans?\b", True),
    ("its age", r"\blaunch (model|edition|unit|day)\b|\bfirst gen|\byears? old\b|\bolder (model|one)\b",
     r"\blaunch\b|\bold\b|\bolder\b|\bage\b|\byears?\b|\bfirst gen|\boutdated\b", False),
    ("what is missing",
     r"\bmissing\b|\bnot included\b|\bno (charger|cables?|case|manual|remote|stand|controller|dust bag|papers|receipt)\b",
     r"\bmissing\b|\bnot included\b|\bdoes(n'?t| not) come with\b|\bno (charger|cables?|case|manual|remote|stand|controller|dust bag|papers|receipt)\b|\bwithout (a |the )?(charger|cables?|case|manual|remote|stand|receipt|papers)\b",
     False),
    ("the fault", r"\bdoes(n'?t| not) work|\bnot working\b|\bbroken\b|\bdead pixel|\bburn-?in\b|\bfaulty\b|\bglitch|\bflicker",
     r"\bdoes(n'?t| not) work|\bnot working\b|\bbroken\b|\bdead pixel|\bburn-?in\b|\bfaulty\b|\bglitch|\bflicker", True),
    ("the repairs", r"\brepair|\breplaced\b|\baftermarket\b|\bnot original\b", r"\brepair|\breplaced\b|\baftermarket\b|\bnot original\b", True),
    ("the smell", r"\bsmok(e|er|ing)\b(?!-free)|\bsmell|\bodou?r", r"\bsmok|\bsmell|\bodou?r", True),
)
_NEGATED = re.compile(r"\b(no|not|never|zero|without|free of|none)\b[^.,;]{0,20}$")
_WEAK_CONDITIONS = {"Used - Fair": r"\bfair\b|\bcondition\b|\bused\b", "For parts": r"\bparts\b|\bcondition\b|\bbroken\b"}
CITED_MIN_WORDS = 3            # "no box?" is a fair point; "box" alone is not an argument


def _admits(pattern: str, text: str, negatable: bool) -> bool:
    """The listing says this, as a downside: "light scratches", not "no scratches"."""
    for m in re.finditer(pattern, text, re.I):
        if not negatable or not _NEGATED.search(text[:m.start()].lower()):
            return True
    return False


def cited_downsides(scenario: dict, flaw: Optional[dict], message: str, already: list) -> list[str]:
    """The downsides the listing admits to that the buyer's message brings up, not counting any credited before."""
    if len(message.split()) < CITED_MIN_WORDS:
        return []
    listing = " ".join(str(scenario.get(k) or "") for k in ("item", "description"))
    said = message.lower()
    found = [
        label for label, admitted, raised, negatable in _DOWNSIDES
        if _admits(admitted, listing, negatable) and re.search(raised, said)
    ]
    weak = _WEAK_CONDITIONS.get(scenario.get("condition") or "")
    if weak and re.search(weak, said):
        found.append("its condition")
    if flaw and flaw.get("revealed") and set(re.findall(r"[a-z/]+", said)) & set(flaw["words"]):
        found.append("the flaw")
    return [f for f in found if f not in already]


# ---- Keeping the model's reply in line ----
# The model writes the reply and judges the message at once, and its own earlier lines are fed back
# to it, so a single insult or stock phrase gets copied round after round. Both are cut before saving.
_INSULTS = re.compile(
    r"\b(whin(y|ier|iest|ing|e|er|ers)|cheapskates?|annoying|pathetic|stupid|idiot\w*|dumb|clowns?|losers?|"
    r"entitled|greedy|grow up|get lost|stop being|desperate|beggars?|choosy)\b",
    re.I,
)
_SENTENCES = re.compile(r"(?<=[.!?])\s+")


def _gist(sentence: str) -> str:
    """A sentence with its prices and punctuation stripped, to spot one said before."""
    sentence = re.sub(r"\{price\}|\$[\d,]+(\.\d+)?", "#", sentence.lower())
    return " ".join(re.findall(r"[a-z#']+", sentence))


def tidy_reply(text: str, earlier: list[str], fallbacks: tuple[str, ...], character: Optional[dict] = None) -> str:
    """The reply without insults or sentences already said in this chat, except from a character
    written to be rude or to repeat themselves. If nothing is left, one of `fallbacks` the chat has not had yet."""
    character = character or {}
    said = set() if character.get("repeats") else {_gist(s) for line in earlier for s in _SENTENCES.split(line or "")}
    insults = None if character.get("rude") else _INSULTS
    kept = [s for s in _SENTENCES.split(text) if s and not (insults and insults.search(s)) and _gist(s) not in said]
    if kept:
        return " ".join(kept)
    unused = [f for f in fallbacks if _gist(f) not in said]
    return (unused or fallbacks)[0] if text or fallbacks else text


_HOLDING = re.compile(
    r"\{price\}|\$\d|\b(stick|firm|final|not (lowering|moving|budging|going lower)|won'?t (go|budge|move)|stays?|holding|as good as it gets|"
    r"minor|no big deal|not a big deal|does(n'?t| not) matter|barely|hardly)\b",
    re.I,
)


def without_holding(text: str, filler: tuple[str, ...] = ()) -> str:
    """The reply without the sentences that keep the price where it was or play the point down,
    for when the game moves it anyway. `filler` lines go too: the point is owned instead."""
    return " ".join(s for s in _SENTENCES.split(text) if s and not _HOLDING.search(s) and s not in filler)
