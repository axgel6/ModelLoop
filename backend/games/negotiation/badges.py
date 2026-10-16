"""Badges: milestones on the player's marketplace profile.

They are earned from running totals kept on the profile ("stats"), updated as each chat ends,
and from the reviews people leave. The first time the totals are needed they are worked out from
the play already on record, so badges that history proves are granted from the start. Purely for
show: a badge changes nothing in a chat. No I/O in this file.
"""
import copy
from datetime import datetime, timezone
from typing import Optional

MOGUL_RATING = "Marketplace mogul"

# id: (name, how to earn it, rarity: higher is rarer, and the rarest earned show beside your name)
BADGES = {
    "first_deal": ("First deal", "Buy something.", 1),
    "first_flip": ("First flip", "Sell something for more than you paid.", 2),
    "sharp_eye": ("Sharp eye", "Get a seller to admit a flaw the listing left out.", 3),
    "trader": ("Trader", "Complete a trade.", 3),
    "verified": ("Verified", "Authenticate something.", 3),
    "boosted": ("Boosted", "Sell a boosted listing.", 3),
    "scam_spotter": ("Scam spotter", "Walk away from a scam, or report one.", 4),
    "lowballer": ("Lowballer", "Get a 1-star review. Not one to be proud of.", 4),
    "haggle_hero": ("Haggle hero", "Get 30% or more off a listing.", 5),
    "collector": ("Collector", "Buy 5 things from one category.", 5),
    "flipper": ("Flipper", "Make 10 sales.", 6),
    "smooth_talker": ("Smooth talker", "Get 5 five-star reviews in a row.", 6),
    "big_spender": ("Big spender", "Buy something for $100,000 or more.", 7),
    "mogul": ("Mogul", "Close a $1,000,000 deal.", 9),
    "hustle_mogul": ("Hustle mogul", "Finish a Hustle run as a Marketplace mogul.", 10),
}
TOP_SHOWN = 3


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def blank() -> dict:
    return {
        "deals": 0, "sales": 0, "flips": 0, "max_paid": 0, "max_deal": 0, "best_saving": 0.0, "by_category": {},
        "scams_dodged": 0, "scams_reported": 0, "flaws_found": 0, "trades": 0, "authenticated": 0,
        "boosted_sales": 0, "hustle_mogul": False,
    }


def _bought(st: dict, paid: int, list_price: Optional[int], category: Optional[str]) -> None:
    st["deals"] += 1
    st["max_paid"] = max(st["max_paid"], paid)
    st["max_deal"] = max(st["max_deal"], paid)
    if list_price:
        st["best_saving"] = max(st["best_saving"], round((list_price - paid) / list_price, 4))
    if category:
        st["by_category"][category] = st["by_category"].get(category, 0) + 1


def _sold(st: dict, price: int, profit: Optional[int]) -> None:
    st["sales"] += 1
    st["max_deal"] = max(st["max_deal"], price)
    if profit and profit > 0:
        st["flips"] += 1


def seed(buys: list[dict], sales: list[dict], hustle_ratings: list[Optional[str]], hustle_trades: dict,
         run: Optional[dict]) -> dict:
    """The totals as far as the record shows them: free play purchases and sales, the Hustle run still
    kept, and the counts from runs before it. What left no record (scams dodged, flaws found) starts at zero."""
    st = blank()
    for b in buys:
        if b.get("paid") is not None:
            _bought(st, int(b["paid"]), b.get("list_price"), b.get("category"))
    for x in sales:
        if x.get("paid") is not None:
            _sold(st, int(x["paid"]), x.get("profit"))
    for h in (run or {}).get("holdings") or []:
        _bought(st, int(h["paid"]), h.get("list_price"), h.get("category"))
        if h.get("sold"):
            _sold(st, int(h["sold"].get("price") or 0), h["sold"].get("profit"))
    # Earlier runs left only their totals
    st["deals"] += int(hustle_trades.get("bought") or 0)
    st["sales"] += int(hustle_trades.get("sold") or 0)
    flip = hustle_trades.get("best_flip") or {}
    if flip.get("profit", 0) > 0:
        st["flips"] = max(st["flips"], 1)
    st["max_deal"] = max(st["max_deal"], int(hustle_trades.get("max_deal") or 0))
    st["hustle_mogul"] = MOGUL_RATING in hustle_ratings
    return st


def after_chat(stats: dict, chat: dict) -> dict:
    """The totals once a chat has ended, however it ended."""
    st = copy.deepcopy(stats)
    result = chat.get("result") or {}
    outcome, paid = result.get("outcome"), result.get("paid")
    pickup = (result.get("pickup") or {}).get("kind")
    if outcome == "deal" and paid is not None and pickup != "scam":
        _bought(st, int(paid), chat.get("list_price"), chat["scenario"].get("category"))
    elif outcome == "sold" and paid is not None:
        _sold(st, int(paid), result.get("profit"))
        if chat.get("boost"):
            st["boosted_sales"] += 1
    if chat.get("scam") and outcome == "walked":
        st["scams_dodged"] += 1
    if (chat.get("flaw") or {}).get("revealed"):
        st["flaws_found"] += 1
    if result.get("trade") and outcome in ("deal", "sold"):
        st["trades"] += 1
    if (chat.get("auth") or {}).get("verdict") in ("passed", "failed", "fake"):
        st["authenticated"] += 1
    return st


def bump(stats: dict, key: str, by: int = 1) -> dict:
    st = copy.deepcopy(stats)
    st[key] = st.get(key, 0) + by
    return st


def _best_streak(reviews: list) -> int:
    """The longest run of five-star reviews in a row."""
    best = run = 0
    for r in reviews:
        run = run + 1 if r.get("stars") == 5 else 0
        best = max(best, run)
    return best


def _five_streak(reviews: list) -> bool:
    return _best_streak(reviews) >= 5


def progress(stats: dict, reviews: list) -> dict:
    """How far along each badge is: what you have, what it takes, and how to show it (a count, dollars or a percent)."""
    st = {**blank(), **stats}
    return {
        "first_deal": (st["deals"], 1, "count"),
        "first_flip": (st["flips"], 1, "count"),
        "sharp_eye": (st["flaws_found"], 1, "count"),
        "trader": (st["trades"], 1, "count"),
        "verified": (st["authenticated"], 1, "count"),
        "boosted": (st["boosted_sales"], 1, "count"),
        "scam_spotter": (st["scams_dodged"] + st["scams_reported"], 1, "count"),
        "lowballer": (int(any(r.get("stars") == 1 for r in reviews)), 1, "count"),
        "haggle_hero": (round(st["best_saving"] * 100), 30, "percent"),
        "collector": (max(st["by_category"].values(), default=0), 5, "count"),
        "flipper": (st["sales"], 10, "count"),
        "smooth_talker": (_best_streak(reviews), 5, "count"),
        "big_spender": (st["max_paid"], 100_000, "money"),
        "mogul": (st["max_deal"], 1_000_000, "money"),
        "hustle_mogul": (int(bool(st["hustle_mogul"])), 1, "count"),
    }


def earned(stats: dict, reviews: list) -> set[str]:
    st = {**blank(), **stats}
    tests = {
        "first_deal": st["deals"] >= 1,
        "first_flip": st["flips"] >= 1,
        "sharp_eye": st["flaws_found"] >= 1,
        "trader": st["trades"] >= 1,
        "verified": st["authenticated"] >= 1,
        "boosted": st["boosted_sales"] >= 1,
        "scam_spotter": st["scams_dodged"] + st["scams_reported"] >= 1,
        "lowballer": any(r.get("stars") == 1 for r in reviews),
        "haggle_hero": st["best_saving"] >= 0.30,
        "collector": max(st["by_category"].values(), default=0) >= 5,
        "flipper": st["sales"] >= 10,
        "smooth_talker": _five_streak(reviews),
        "big_spender": st["max_paid"] >= 100_000,
        "mogul": st["max_deal"] >= 1_000_000,
        "hustle_mogul": bool(st["hustle_mogul"]),
    }
    return {k for k, ok in tests.items() if ok}


def refresh(account: dict) -> tuple[dict, list[str]]:
    """Award whatever the totals and reviews now prove. Returns the account and the badges that are new."""
    have = account.get("badges") or {}
    new = [b for b in BADGES if b in earned(account.get("stats") or {}, account.get("reviews") or []) and b not in have]
    if not new:
        return account, []
    a = copy.deepcopy(account)
    a["badges"] = {**have, **{b: _now() for b in new}}
    return a, new


def view(account: dict) -> dict:
    """Every badge, earned or not, and the rarest earned to show beside your name."""
    have = account.get("badges") or {}
    along = progress(account.get("stats") or {}, account.get("reviews") or [])
    every = [
        {"id": b, "name": n, "how": how, "rarity": r, "at": have.get(b),
         "progress": {"have": min(along[b][0], along[b][1]), "need": along[b][1], "unit": along[b][2]}}
        for b, (n, how, r) in BADGES.items()
    ]
    top = sorted((x for x in every if x["at"]), key=lambda x: (-x["rarity"], x["at"]))[:TOP_SHOWN]
    return {"badges": every, "top": [x["id"] for x in top]}


def named(ids: list[str]) -> list[dict]:
    return [{"id": b, "name": BADGES[b][0], "how": BADGES[b][1]} for b in ids if b in BADGES]
