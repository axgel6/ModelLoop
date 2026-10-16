"""What makes the Marketplace feel lived in, beyond the chat itself: how busy a listing is, what
happens to the ones you save, boosting a listing of your own, and authenticating before you buy.

Free play goes by the calendar day and a Hustle run by its own days, so a saved listing can drop
in price overnight in one and between chats in the other. No I/O in this file.
"""
import copy
import random
from datetime import datetime, timezone
from typing import Callable, Optional

from . import extras

# ---- Busy listings: views and saves, and what a busy seller does differently ----

BUSY_AT = 0.6                  # how hot a listing has to be to count as busy
BUSY_STIFFEN = 0.08            # a busy seller holds out this much harder
FRESH_SHARE = 0.08             # the share of listings that are just listed on a given day


def today() -> int:
    """Free play's day: the calendar day, the same for everyone."""
    return datetime.now(timezone.utc).date().toordinal()


def day_key(run: Optional[dict], day: Optional[int] = None) -> str:
    """What a day's buzz is seeded with: a Hustle run's day, or free play's calendar day."""
    if run:
        return f"run:{run['price_seed']}:{run['day'] if day is None else day}"
    return f"date:{today() if day is None else day}"


def buzz(scenario: dict, price: int, value: int, key: str) -> dict:
    """How many people viewed and saved a listing today. A price under what it resells for draws a crowd.
    A scammer's listing is crowded in a way that does not add up: plenty of views, almost nobody saving it."""
    rng = random.Random(f"busy:{key}:{scenario['id']}")
    if scenario.get("scam"):
        return {"views": rng.randint(40, 90), "saves": rng.randint(0, 1), "fresh": True, "busy": True}
    ratio = value / max(1, price)
    heat = min(1.0, max(0.0, (ratio - 0.85) * 2.5)) * 0.7 + rng.random() * 0.3
    return {
        "views": 2 + round(heat ** 2 * 60) + rng.randint(0, 6),
        "saves": round(heat ** 2 * 9) + rng.randint(0, 1),
        "fresh": rng.random() < FRESH_SHARE,
        "busy": heat >= BUSY_AT,
    }


def packed(b: dict) -> list:
    """A listing's buzz in as few characters as possible, for sending every listing's at once."""
    return [b["views"], b["saves"], int(b["fresh"]), int(b["busy"])]


def make_busy(state: dict, b: dict, max_resistance: float) -> dict:
    """A buying chat with a busy seller: they know they have interest, so they budge less."""
    s = copy.deepcopy(state)
    s["buzz"] = {"views": b["views"], "saves": b["saves"]}
    if b["busy"] and not s.get("scam"):
        s["resistance"] = min(max_resistance, s["resistance"] + BUSY_STIFFEN)
    return s


# ---- Saved listings: they can drop in price, or sell to someone else ----

SAVED_MAX = 30
DROP_CHANCE = (0.25, 0.05)     # a day's chance of a price drop: a quiet listing, a busy one
SOLD_CHANCE = (0.06, 0.20)     # ...and of selling to someone else
DROP_SIZE = (0.85, 0.95)       # each drop takes the price to this share of what it was
LOWEST_CUT = 0.7               # however many drops, never below this share of the usual price
CATCH_UP_DAYS = 30             # days away longer than this are not played out one by one


def toggle_saved(saved: list, listing: str, day: int) -> list:
    """Save a listing, or unsave it if it was saved."""
    if any(x["listing"] == listing for x in saved):
        return [x for x in saved if x["listing"] != listing]
    if len(saved) >= SAVED_MAX:
        raise ValueError(f"You can save up to {SAVED_MAX} listings. Unsave one first.")
    return saved + [{"listing": listing, "saved": day, "checked": day, "cut": 1.0, "news": None}]


def tick_saved(saved: list, day: int, seed: str, busy: Callable[[str, int], bool]) -> list:
    """Play out the days since the saved listings were last looked at. `busy(listing, day)` says whether a
    listing was busy that day: a busy one rarely drops and often sells. Each change leaves news to show."""
    out = []
    for x in saved:
        x = dict(x)
        if not x.get("gone"):
            for d in range(max(x["checked"] + 1, day - CATCH_UP_DAYS + 1), day + 1):
                hot = busy(x["listing"], d)
                roll = random.Random(f"saved:{seed}:{x['listing']}:{d}").random()
                if roll < SOLD_CHANCE[hot]:
                    x.update(gone=True, news="sold")
                    break
                if roll < SOLD_CHANCE[hot] + DROP_CHANCE[hot]:
                    was = x["cut"]
                    x["cut"] = round(max(LOWEST_CUT, was * random.Random(f"drop:{seed}:{x['listing']}:{d}").uniform(*DROP_SIZE)), 4)
                    if x["cut"] < was:
                        x.update(news="drop", was=x.get("was") if x.get("news") == "drop" else was)
        x["checked"] = day
        out.append(x)
    return out


def saved_cut(saved: list, listing: Optional[str]) -> float:
    """What share of its usual price a saved listing is down to, 1 if it is not saved or has not dropped."""
    x = next((x for x in saved if x["listing"] == listing and not x.get("gone")), None)
    return x["cut"] if x else 1.0


def without(saved: list, listing: Optional[str]) -> list:
    return [x for x in saved if x["listing"] != listing]


def seen(saved: list, listing: Optional[str]) -> list:
    """Its news read: the player has opened the chat."""
    return [{**x, "news": None, "was": None} if x["listing"] == listing and x.get("news") == "drop" else x for x in saved]


# ---- Boosting a listing of your own ----

# level: (label, share of the asking price, least, most, extra buyers, how much likelier a big spender is, extra chance of a rival offer)
BOOSTS = {
    1: {"label": "Boost", "share": 0.03, "least": 5, "most": 300, "extra": 1, "rich": 2.0, "ping": 0.10},
    2: {"label": "Top boost", "share": 0.06, "least": 12, "most": 900, "extra": 2, "rich": 3.0, "ping": 0.20},
}


def boost_fee(level: int, asking: int) -> int:
    b = BOOSTS.get(level)
    if not b:
        return 0
    return int(min(b["most"], max(b["least"], round(asking * b["share"]))))


# ---- Authentication: checked by a third party before money changes hands ----

AUTH_CATEGORIES = (
    "Bags", "Jewelry", "Fragrance", "Clothing and shoes", "Apple and phones", "Marvel and comics",
    "Art and rare finds", "Music and merch", "Home and collectables", "Games", "Consoles", "Cameras and video",
    "Vintage", "Books",
)
AUTH_SHARE = 0.02
AUTH_FEE = (10, 300)           # least and most it costs
AUTH_LIFT = 0.10               # buyers pay up to this much more for an authenticated listing
# What an authenticator catches: tampering and fakes, not ordinary wear
_CAUGHT = (extras._SEALED_FLAW[0], extras._FAKE_COA[0], extras._SIGNED[0])
_CAUGHT_WORDS = ("fake", "replica", "counterfeit", "not real", "not genuine", "resealed", "knockoff", "dupe")


def can_authenticate(scenario: dict) -> bool:
    item = (scenario.get("item") or "").lower()
    return (
        scenario.get("category") in AUTH_CATEGORIES or scenario.get("condition") == "New"
        or "signed" in item or "sealed" in item
    )


def auth_fee(price: int) -> int:
    return int(min(AUTH_FEE[1], max(AUTH_FEE[0], round(price * AUTH_SHARE))))


def catches(flaw_text: Optional[str]) -> bool:
    text = (flaw_text or "").lower()
    return bool(text) and (text in _CAUGHT or any(w in text for w in _CAUGHT_WORDS))


def authenticate(state: dict, fake: bool) -> dict:
    """Buying: the verdict on the item before paying. `fake` is whether it turns out a counterfeit (decided
    here, and kept, so what happens at pickup matches). A scammer will not send anything in; that is the tell."""
    s = copy.deepcopy(state)
    name = s["scenario"]["merchant"]
    fee = auth_fee(s["ask"])
    flaw = s.get("flaw") or {}
    if s.get("scam"):
        s["auth"] = {"verdict": "refused", "fee": 0, "note": f"{name} would not send it in. A real seller has no reason to refuse."}
        return s
    if fake:
        s["auth"] = {"verdict": "fake", "fee": fee, "note": "It is a counterfeit. A good one, but not the real thing."}
        s["fake"] = True
        return s
    s["fake"] = False
    if flaw and not flaw.get("revealed") and catches(flaw.get("text")):
        # Owned up to, as if they had been asked: it is worth less, and they know it
        flaw["revealed"] = True
        s["value"] = max(1, round(s["value"] * (1 - flaw["loss"])))
        s["auth"] = {"verdict": "failed", "fee": fee, "note": f"It did not pass: {flaw['text']}."}
        return s
    s["auth"] = {"verdict": "passed", "fee": fee, "note": "Authentic, and as described."}
    return s
