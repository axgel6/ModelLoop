"""HTTP API for chat games: saved sessions, and playing a turn."""
import json
import logging
import random
import time
import uuid
from datetime import datetime, timezone
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

import config as _config
import ollama_caps
import ollama_http
from config import CHAT_RATE_LIMIT, MODEL_NAME_PATTERN, NGROK_HEADERS, THINKING_MODELS
from database import get_db, AsyncSessionLocal
from dependencies import get_user
from games.ceo_simulator import engine as ceo
from games.model_arena import engine as arena
from games.negotiation import engine as haggle
from games.negotiation import aftertalk, badges, bank, extras, hustle, market, reviews, selling, trades
from models import GameScore, GameSession, User
from ollama_target import effective_ollama_url
from rate_limit import limiter

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/games", tags=["games"])

MAX_SAVES_PER_GAME = 20
SALE_GAME_TYPE = "negotiation-sale"   # sales are scored apart from purchases
TURN_TIMEOUT_SECONDS = 180
# How free the model is in a turn that must follow the game's rules (Marketplace, Founder Mode).
# Lower keeps small models in role and on the instructions; the debates' prose runs warmer.
JSON_TURN_TEMPERATURE = 0.6


class ProductIn(BaseModel):
    name:  str   = Field(..., min_length=1, max_length=40)
    price: float = Field(..., gt=0, le=1_000_000)


class NewCeoGame(BaseModel):
    company:  str             = Field(..., min_length=1, max_length=60)
    pitch:    str             = Field(default="", max_length=200)
    products: list[ProductIn] = Field(..., min_length=1, max_length=ceo.MAX_START_PRODUCTS)
    difficulty: str           = Field(default="normal", pattern="^(easy|normal|hard)$")
    style: Optional[str]      = Field(default=None, pattern="^(bootstrapper|growth|perfectionist)$")


class ProductEdit(BaseModel):
    name:  Optional[str]   = Field(default=None, min_length=1, max_length=40)
    price: Optional[float] = Field(default=None, gt=0, le=1_000_000)


class OfferAnswer(BaseModel):
    """The id of one of the offer's choices; yes/no offers use "accept" and "reject"."""
    choice: str = Field(..., min_length=1, max_length=20)


class LoanRequest(BaseModel):
    amount: int = Field(..., gt=0, le=10_000_000)


class LoanRepayment(BaseModel):
    """Which loan to clear, by its position in the game's list of loans."""
    index: int = Field(..., ge=0, le=10)


class TurnAction(BaseModel):
    """A decision made with a dashboard form instead of typed out."""
    type:       str             = Field(..., pattern="^(launch|discontinue|hire)$")
    role:       Optional[str]   = Field(default=None, max_length=20)
    count:      Optional[int]   = Field(default=None, ge=1, le=25)
    name:       Optional[str]   = Field(default=None, max_length=40)
    price:      Optional[float] = Field(default=None, gt=0, le=1_000_000)
    product_id: Optional[str]   = Field(default=None, max_length=20)


class CustomListing(BaseModel):
    """Something the player lists themselves, to sell to a model buyer."""
    item:        str           = Field(..., min_length=3, max_length=80)
    price:       int           = Field(..., gt=0, le=10_000_000_000)
    condition:   Optional[str] = Field(default=None, max_length=20)
    category:    Optional[str] = Field(default=None, max_length=30)
    description: str           = Field(default="", max_length=600)


class NewNegotiation(BaseModel):
    """Buying: a catalogue scenario (left out, one is dealt at random).
    Selling: something from the inventory, or a listing of the player's own, at an asking price."""
    mode:         str                     = Field(default="buy", pattern="^(buy|sell)$")
    scenario:     Optional[str]           = Field(default=None, max_length=20)
    difficulty:   str                     = Field(default="normal", pattern="^(easy|normal|hard)$")
    custom:       Optional[CustomListing] = None
    inventory_id: Optional[uuid.UUID]     = None
    asking:       Optional[int]           = Field(default=None, gt=0, le=10_000_000_000)
    # Selling from the inventory. Free play may rewrite the title, condition, category and description;
    # a Hustle run keeps the item's real listing, and the player adds notes the buyer takes as claims
    title:        Optional[str]           = Field(default=None, min_length=3, max_length=80)
    condition:    Optional[str]           = Field(default=None, max_length=20)
    category:     Optional[str]           = Field(default=None, max_length=30)
    description:  Optional[str]           = Field(default=None, max_length=600)
    notes:        Optional[str]           = Field(default=None, max_length=300)
    # Part of the player's Hustle run: real money, and it uses a day
    hustle:       bool                    = False
    # Hustle: answer a seller who messaged again after the player walked away
    callback:     Optional[str]           = Field(default=None, max_length=20)
    # Selling: pay to reach more buyers (1 Boost, 2 Top boost), and to have it authenticated first
    boost:        int                     = Field(default=0, ge=0, le=2)
    authenticate: bool                    = False


class ArenaSide(BaseModel):
    model:     str = Field(..., max_length=100, pattern=MODEL_NAME_PATTERN)
    # The character's name, and the system prompt that makes the model play it
    character: str = Field(default="", max_length=40)
    prompt:    str = Field(default="", max_length=4000)


class NewArena(BaseModel):
    """The first side argues for the topic, the second against."""
    topic: str             = Field(..., min_length=3, max_length=200)
    sides: list[ArenaSide] = Field(..., min_length=2, max_length=2)
    # argument: the models go back and forth on their own. debate: rounds, each ending on a question from the moderator
    mode:  str             = Field(default="argument", pattern="^(argument|debate)$")


class Verdict(BaseModel):
    winner: int = Field(..., ge=0, le=1)


class ModeratorQuestion(BaseModel):
    # Empty passes: the debate carries on without a question
    question: str = Field(default="", max_length=300)


class BuyerPick(BaseModel):
    """Which of the buyers in the inbox to answer, by position."""
    index: int = Field(..., ge=0, le=10)


class BankMove(BaseModel):
    """Free play money in from nowhere, or out to it."""
    amount: int = Field(..., gt=0, le=bank.MAX_MOVE)


class AfterChat(BaseModel):
    """A message once the haggle is over: no prices, just talk."""
    message: str           = Field(..., min_length=1, max_length=400)
    model:   Optional[str] = Field(default=None, max_length=100, pattern=MODEL_NAME_PATTERN)
    clean:   bool          = False


class TurnRequest(BaseModel):
    decision: str                  = Field(default="", max_length=400)
    action:   Optional[TurnAction] = None
    # Negotiation only: the price the player puts on the table with their message
    offer:    Optional[int]        = Field(default=None, gt=0, le=10_000_000_000)
    # Negotiation only: the player says they are leaving, to see if the price moves. Works once.
    bluff:    bool                 = False
    # Negotiation only: a term other than money, such as cash today. Each works once per chat.
    sweetener: Optional[str]       = Field(default=None, max_length=20)
    # Selling only: hold up another buyer's real offer against this one
    leverage: bool                 = False
    # Marketplace setting: characters who swear keep it clean
    clean:    bool                 = False
    model:    Optional[str]        = Field(default=None, max_length=100, pattern=MODEL_NAME_PATTERN)


# How a game shows its state to the player, in full and in a save list. Games not listed use the CEO shapes.
def _haggle_rules(state: dict):
    """The rules a negotiation plays by: buying, or selling to a model buyer."""
    return selling if state.get("mode") == selling.MODE else haggle


_VIEWS = {
    haggle.GAME_TYPE: (lambda s: _haggle_rules(s).public(s), lambda s: _haggle_rules(s).summary(s)),
    arena.GAME_TYPE:  (arena.public, arena.summary),
    hustle.GAME_TYPE: (hustle.public, hustle.summary),
}


def _serialize(game: GameSession, with_state: bool = True) -> dict:
    out = {
        "id":         str(game.id),
        "game_type":  game.game_type,
        "title":      game.title,
        "created_at": game.created_at,
        "updated_at": game.updated_at,
    }
    views = _VIEWS.get(game.game_type)
    if views:
        out["state" if with_state else "summary"] = views[0 if with_state else 1](game.state)
    elif with_state:
        state = ceo.upgrade(game.state) if game.game_type == ceo.GAME_TYPE else game.state
        # The undo snapshot is a second copy of the whole game: say it exists, do not send it.
        out["state"] = {**{k: v for k, v in state.items() if k != "undo"}, "can_undo": bool(state.get("undo"))}
    else:
        # Enough for a save list without shipping every turn of every game
        out["summary"] = {k: game.state.get(k) for k in (
            "turn", "cash", "status", "valuation", "result", "official_result", "free_play",
        )}
    return out


def _score_for(user: User, title: str, state: dict) -> Optional[GameScore]:
    """A score row for a run that has just ended, or for a year just completed, or None.

    A company that reaches the end of its year records its score once and plays on
    (`year_scored`, which this takes off the state). Free play never adds another.
    """
    if state.pop("year_scored", False):
        result = state["official_result"]
    else:
        result = state.get("result")
        if not result or state.get("official_result"):
            return None
    return GameScore(
        user_id=user.id, game_type=ceo.GAME_TYPE, title=title[:80], score=int(result["score"]),
        detail={
            **{k: result.get(k) for k in ("outcome", "rating", "weeks", "goal_met", "typed_cash")},
            "difficulty": state.get("difficulty", "normal"),
        },
    )


async def _owned_game(game_id: uuid.UUID, user: User, db: AsyncSession) -> GameSession:
    result = await db.execute(
        select(GameSession).where(GameSession.id == game_id, GameSession.user_id == user.id)
    )
    game = result.scalar_one_or_none()
    if not game:
        raise HTTPException(status_code=404, detail="Game not found")
    return game


@router.get("")
async def list_games(
    game_type: Optional[str] = None,
    user: User = Depends(get_user),
    db: AsyncSession = Depends(get_db),
):
    query = select(GameSession).where(GameSession.user_id == user.id)
    if game_type:
        query = query.where(GameSession.game_type == game_type)
    result = await db.execute(query.order_by(GameSession.updated_at.desc()))
    return {"games": [_serialize(g, with_state=False) for g in result.scalars().all()]}


async def _best(user: User, db: AsyncSession, game_type: str) -> list[dict]:
    result = await db.execute(
        select(GameScore)
        .where(GameScore.user_id == user.id, GameScore.game_type == game_type)
        .order_by(GameScore.score.desc(), GameScore.created_at.asc())
        .limit(10)
    )
    return [
        {"id": str(row.id), "title": row.title, "score": row.score, "created_at": row.created_at, **row.detail}
        for row in result.scalars().all()
    ]


@router.get("/scores")
async def best_scores(
    game_type: str = ceo.GAME_TYPE,
    user: User = Depends(get_user),
    db: AsyncSession = Depends(get_db),
):
    """The caller's ten best finished runs."""
    return {"scores": await _best(user, db, game_type)}


@router.get("/negotiation/listings")
async def negotiation_listings(user: User = Depends(get_user)) -> dict:
    """Everything that can be haggled over, for the start screen to deal from. The same for everyone,
    so it needs no database: the stars you gave sellers are counted in on the page, from the bank's `given`."""
    return {"listings": haggle.catalogue()}


@router.get("/negotiation/profile")
async def negotiation_profile(user: User = Depends(get_user), db: AsyncSession = Depends(get_db)) -> dict:
    """Your marketplace profile: your rating, what you have traded, the reviews both ways, and your badges."""
    account = await _ready(await _free_bank(user, db), user, db)
    await db.commit()
    rows = (await db.execute(
        select(GameScore.title, GameScore.detail)
        .where(GameScore.user_id == user.id, GameScore.game_type == haggle.GAME_TYPE)
    )).all()
    run_game = await _hustle_run(user, db)
    return _profile_view(user, account, [{"title": title, **detail} for title, detail in rows], run_game.state if run_game else None)


def _profile_view(user: User, account: GameSession, rows: list[dict], run: Optional[dict]) -> dict:
    return {
        **reviews.profile(
            account.state, user.full_name or "You", user.created_at.isoformat() if user.created_at else None, rows, run,
        ),
        **badges.view(account.state),
    }


def _prices(run: Optional[dict], scenario: dict) -> tuple[int, int]:
    """A listing's price and resale value: free play's, or the run's."""
    if run:
        return hustle.price_of(run, scenario), hustle.value_of(run, scenario)
    return scenario["list_price"], haggle.market_value(scenario)


def _buzz(run: Optional[dict]) -> dict:
    key = market.day_key(run)
    out = {}
    for s in haggle.SCENARIOS:
        price, value = _prices(run, s)
        out[s["id"]] = market.packed(market.buzz(s, price, value, key))
    return out


def _tick_saved(saved: list, run: Optional[dict], seed: str) -> list:
    """Play out the days since saved listings were last looked at: free play's calendar days, or the run's."""
    if not saved:
        return saved
    def busy(listing: str, day: int) -> bool:
        s = haggle.scenario_for(listing)
        if s["id"] != listing:
            return False
        price, value = _prices(run, s)
        return market.buzz(s, price, value, market.day_key(run, day))["busy"]
    return market.tick_saved(saved, run["day"] if run else market.today(), seed, busy)


async def _hustle_run(user: User, db: AsyncSession, run_id: Optional[str] = None) -> Optional[GameSession]:
    """The caller's Hustle run: the one given, or else the latest."""
    query = select(GameSession).where(GameSession.user_id == user.id, GameSession.game_type == hustle.GAME_TYPE)
    if run_id:
        query = query.where(GameSession.id == uuid.UUID(run_id))
    result = await db.execute(query.order_by(GameSession.updated_at.desc()).limit(1))
    return result.scalar_one_or_none()


def _cheapest(run: dict) -> int:
    return min(hustle.prices(run, haggle.SCENARIOS).values())


def _settle_run(user: User, run_game: GameSession, db: AsyncSession) -> None:
    """Close the run if it is over, and score it once."""
    before = run_game.state["status"]
    run_game.state = hustle.settle(run_game.state, _cheapest(run_game.state))
    if before == "active" and run_game.state["status"] != "active":
        db.add(GameScore(
            user_id=user.id, game_type=hustle.GAME_TYPE, title=f"Hustle run, {run_game.state['days']} days",
            score=int(run_game.state["result"]["net_worth"]), detail=hustle.score_detail(run_game.state),
        ))


def _run_view(run_game: Optional[GameSession]) -> dict:
    if not run_game:
        return {"run": None, "prices": {}, "values": {}}
    run = run_game.state
    return {
        "run": {"id": str(run_game.id), **hustle.public(run)},
        "prices": hustle.prices(run, haggle.SCENARIOS) if run["status"] == "active" else {},
        "values": hustle.values(run, haggle.SCENARIOS) if run["status"] == "active" else {},
    }


@router.get("/negotiation/hustle")
async def get_hustle(user: User = Depends(get_user), db: AsyncSession = Depends(get_db)) -> dict:
    """The caller's latest Hustle run, and what everything costs in it."""
    return await _current_hustle(user, db)


async def _current_hustle(user: User, db: AsyncSession, run_game: Optional[GameSession] = None) -> dict:
    """The latest run, settled first if its last day went on a chat that was never finished."""
    run_game = run_game or await _hustle_run(user, db)
    if run_game and run_game.state["status"] == "active" and run_game.state["day"] >= run_game.state["days"]:
        # The last day was spent on a chat that was never finished: the run is over all the same
        open_chat = (await db.execute(
            select(GameSession.id).where(GameSession.user_id == user.id, GameSession.game_type == haggle.GAME_TYPE)
        )).first()
        chat = open_chat and await db.get(GameSession, open_chat[0])
        if not chat or chat.state.get("run_id") != str(run_game.id) or chat.state.get("status") not in ("active", "choosing"):
            _settle_run(user, run_game, db)
            await db.commit()
            await db.refresh(run_game)
    return _run_view(run_game)


@router.post("/negotiation/hustle", status_code=201)
async def start_hustle(user: User = Depends(get_user), db: AsyncSession = Depends(get_db)) -> dict:
    """Start a fresh Hustle run. A run still going is given up, unscored."""
    # Its trades stay on your profile
    old = await _hustle_run(user, db)
    if old:
        account = await _free_bank(user, db)
        account.state = reviews.fold_run(account.state, old.state)
    await db.execute(
        delete(GameSession).where(
            GameSession.user_id == user.id, GameSession.game_type.in_([hustle.GAME_TYPE, haggle.GAME_TYPE]),
        )
    )
    run_game = GameSession(user_id=user.id, game_type=hustle.GAME_TYPE, title="Hustle run", state=hustle.new_run())
    db.add(run_game)
    await db.commit()
    await db.refresh(run_game)
    return _run_view(run_game)


async def _free_bank(user: User, db: AsyncSession) -> GameSession:
    """The caller's free play bank account, opened the first time it is needed."""
    account = (await db.execute(
        select(GameSession).where(GameSession.user_id == user.id, GameSession.game_type == bank.GAME_TYPE).limit(1)
    )).scalar_one_or_none()
    if not account:
        account = GameSession(user_id=user.id, game_type=bank.GAME_TYPE, title="Bank account", state=bank.new_account())
        db.add(account)
        await db.flush()
    return account


async def _ready(account: GameSession, user: User, db: AsyncSession) -> GameSession:
    """The profile with its running totals for badges, worked out from the record the first time they are
    needed, so whatever past play proves is granted at once."""
    if "stats" not in account.state:
        def details(game_type: str):
            return select(GameScore.detail).where(GameScore.user_id == user.id, GameScore.game_type == game_type)
        buys = (await db.execute(details(haggle.GAME_TYPE))).scalars().all()
        sales = (await db.execute(details(SALE_GAME_TYPE))).scalars().all()
        runs = (await db.execute(details(hustle.GAME_TYPE))).scalars().all()
        run_game = await _hustle_run(user, db)
        stats = badges.seed(
            list(buys), list(sales), [d.get("rating") for d in runs], account.state.get("hustle_trades") or {},
            run_game.state if run_game else None,
        )
        account.state, _ = badges.refresh({**account.state, "stats": stats})
    return account


def _after_chat(account: GameSession, chat: dict) -> list[dict]:
    """Count a finished chat towards the badges. Returns the ones it earned."""
    stats = badges.after_chat(account.state.get("stats") or badges.blank(), chat)
    account.state, new = badges.refresh({**account.state, "stats": stats})
    return badges.named(new)


def _bump(account: GameSession, key: str) -> list[dict]:
    stats = badges.bump(account.state.get("stats") or badges.blank(), key)
    account.state, new = badges.refresh({**account.state, "stats": stats})
    return badges.named(new)


async def _bank_view(account: GameSession, user: User, db: AsyncSession) -> dict:
    """The account, with net worth: cash plus what was paid for everything still held."""
    rows = (await db.execute(
        select(GameScore.detail).where(GameScore.user_id == user.id, GameScore.game_type == haggle.GAME_TYPE)
    )).scalars().all()
    held = [d for d in rows if not d.get("sold")]
    return {
        **account.state,
        "deposited": account.state.get("deposited", 0),
        "rating": extras.rating(account.state.get("reviews") or []),
        "reviews": (account.state.get("reviews") or [])[-5:][::-1],
        "review_count": len(account.state.get("reviews") or []),
        "held": len(held),
        "net_worth": account.state["cash"] + sum(int(d.get("paid") or 0) for d in held),
    }


@router.get("/negotiation/bank")
async def get_bank(user: User = Depends(get_user), db: AsyncSession = Depends(get_db)) -> dict:
    """The free play bank account."""
    account = await _free_bank(user, db)
    await db.commit()
    return await _bank_view(account, user, db)


@router.post("/negotiation/bank/{kind}")
async def move_money(
    kind: str,
    body: BankMove,
    user: User = Depends(get_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Deposit money from nowhere, or withdraw it into nowhere. `kind` is deposit or withdraw."""
    if kind not in ("deposit", "withdraw"):
        raise HTTPException(status_code=404, detail="Deposit or withdraw")
    account = await _free_bank(user, db)
    try:
        account.state = bank.move(account.state, kind, body.amount)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    await db.commit()
    await db.refresh(account)
    return await _bank_view(account, user, db)


@router.get("/negotiation/inventory")
async def negotiation_inventory(
    user: User = Depends(get_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Everything the caller has bought in Negotiation, newest first."""
    return {"items": await _inventory(user, db)}


async def _inventory(user: User, db: AsyncSession) -> list[dict]:
    result = await db.execute(
        select(GameScore)
        .where(GameScore.user_id == user.id, GameScore.game_type == haggle.GAME_TYPE)
        .order_by(GameScore.created_at.desc())
    )
    return [
        haggle.inventory_item({"id": str(row.id), "title": row.title, "score": row.score, "bought_at": row.created_at, **row.detail})
        for row in result.scalars().all()
    ]


@router.get("/negotiation/overview")
async def negotiation_overview(user: User = Depends(get_user), db: AsyncSession = Depends(get_db)) -> dict:
    """Everything the Marketplace menu shows, in one trip: the chat still open, the Hustle run,
    the inventory, the bank and the leaderboards. The catalogue of listings stays separate."""
    open_chat = (await db.execute(
        select(GameSession)
        .where(GameSession.user_id == user.id, GameSession.game_type == haggle.GAME_TYPE)
        .order_by(GameSession.updated_at.desc())
    )).scalars().all()
    unfinished = next((g for g in open_chat if g.state.get("status") in ("active", "choosing")), None)
    run_game = await _hustle_run(user, db)
    account = await _ready(await _free_bank(user, db), user, db)
    # Saved listings: what happened to them since they were last looked at
    account.state = {**account.state, "saved": _tick_saved(account.state.get("saved") or [], None, str(user.id))}
    live = run_game if run_game and run_game.state["status"] == "active" else None
    if live and live.state.get("saved"):
        live.state = {**live.state, "saved": _tick_saved(live.state["saved"], live.state, str(live.state["price_seed"]))}
    hustle_view = await _current_hustle(user, db, run_game)
    if run_game and (run_game.state.get("result") or {}).get("rating") == badges.MOGUL_RATING:
        account.state, _ = badges.refresh({**account.state, "stats": {**account.state["stats"], "hustle_mogul": True}})
    await db.commit()
    inventory = await _inventory(user, db)
    return {
        "unfinished": _serialize(unfinished, with_state=False) if unfinished else None,
        "hustle": hustle_view,
        "inventory": inventory,
        # How busy every listing is today, as [views, saves, just listed, busy]: free play's, and the run's
        "buzz": {
            "free": _buzz(None),
            "hustle": _buzz(live.state) if live else None,
        },
        # Ready before it is opened, from what is loaded here anyway
        "profile": _profile_view(user, account, inventory, hustle_view["run"]),
        "bank": await _bank_view(account, user, db),
        "scores": {
            "buy": await _best(user, db, haggle.GAME_TYPE),
            "sell": await _best(user, db, SALE_GAME_TYPE),
            "hustle": await _best(user, db, hustle.GAME_TYPE),
        },
    }


@router.post("/ceo-simulator", status_code=201)
async def create_ceo_game(
    body: NewCeoGame,
    user: User = Depends(get_user),
    db: AsyncSession = Depends(get_db),
):
    company = " ".join(body.company.split())
    names = [" ".join(p.name.split()) for p in body.products]
    if not company or not all(names):
        raise HTTPException(status_code=422, detail="Company and product names cannot be blank")
    if len({n.lower() for n in names}) != len(names):
        raise HTTPException(status_code=422, detail="Each product needs a different name")

    existing = await db.execute(
        select(GameSession.id).where(GameSession.user_id == user.id, GameSession.game_type == ceo.GAME_TYPE)
    )
    if len(existing.all()) >= MAX_SAVES_PER_GAME:
        raise HTTPException(status_code=409, detail="You have too many saved companies. Delete one to start another.")

    state = ceo.new_game(
        company,
        " ".join(body.pitch.split()),
        [{"name": n, "price": p.price} for n, p in zip(names, body.products)],
        difficulty=body.difficulty,
        style=body.style,
    )
    game = GameSession(user_id=user.id, game_type=ceo.GAME_TYPE, title=company, state=state)
    db.add(game)
    await db.commit()
    await db.refresh(game)
    return _serialize(game)


@router.post("/negotiation", status_code=201)
async def create_negotiation(
    body: NewNegotiation,
    user: User = Depends(get_user),
    db: AsyncSession = Depends(get_db),
):
    """Start a haggle, buying or selling. Only one is kept at a time: a new one replaces the last."""
    profile = await _free_bank(user, db)
    trust = extras.trust_bonus(profile.state.get("reviews") or [])
    given = profile.state.get("given") or []
    if body.hustle:
        return await _create_hustle_chat(body, user, db, trust, given)
    custom = body.custom and haggle.custom_listing(
        " ".join(body.custom.item.split()), body.custom.price, body.custom.condition,
        body.custom.category and " ".join(body.custom.category.split()), " ".join(body.custom.description.split()),
    )
    if body.notes is not None:
        raise HTTPException(status_code=422, detail="Seller's notes are for Hustle runs")
    if body.mode == selling.MODE:
        if body.inventory_id:
            row = await _unsold_purchase(body.inventory_id, user, db)
            item = haggle.inventory_item({"id": str(row.id), "title": row.title, **row.detail})
            listing = {
                "id": item.get("listing"), "item": item["title"], "list_price": item["list_price"],
                "value": item.get("value") or item["list_price"],
                **{k: item.get(k) for k in ("condition", "description", "category", "setting")},
            }
            edits = {}
            if body.title is not None:
                edits["title"] = listing["item"] = " ".join(body.title.split())
            if body.condition is not None:
                # Blank is "Not stated"
                edits["condition"] = listing["condition"] = body.condition if body.condition in haggle.CONDITIONS else None
            if body.category is not None:
                edits["category"] = listing["category"] = " ".join(body.category.split()) or "Custom"
            if body.description is not None:
                edits["description"] = listing["description"] = " ".join(body.description.split())
            if edits:
                # Kept with this purchase alone, apart from what the seller's listing said, so the
                # next time it goes up for sale it starts from the player's own version
                row.detail = {**row.detail, "edits": {**(row.detail.get("edits") or {}), **edits}}
            asking = body.asking or item["list_price"]
            auth, _ = _list_extras(body, profile, None, listing, asking, row.detail.get("flaw"), False)
            state = selling.new_game(
                listing, asking, item.get("paid"), str(row.id), body.difficulty, patience_bonus=trust,
                boost=body.boost, authenticated=bool(auth and auth["verdict"] == "passed"),
            )
            state["auth"] = auth
        elif custom:
            asking = body.asking or custom["list_price"]
            auth, _ = _list_extras(body, profile, None, custom, asking, None, False)
            state = selling.new_game(
                custom, asking, None, None, body.difficulty, patience_bonus=trust,
                boost=body.boost, authenticated=bool(auth and auth["verdict"] == "passed"),
            )
            state["auth"] = auth
        else:
            raise HTTPException(status_code=422, detail="Pick something from your inventory, or describe what you are selling")
    elif custom:
        raise HTTPException(status_code=422, detail="Listings of your own are for selling")
    else:
        base = haggle.scenario_for(body.scenario)
        # A saved listing that has dropped is messaged at its new price
        saved = profile.state.get("saved") or []
        cut = market.saved_cut(saved, base["id"])
        state = haggle.new_game(
            base["id"], body.difficulty, patience_bonus=trust,
            list_price=haggle._nice(base["list_price"] * cut, base["list_price"]) if cut < 1 else None,
        )
        state["seller"] = reviews.with_yours(state.get("seller"), given, state["scenario"]["id"])
        state = market.make_busy(
            state, market.buzz(base, base["list_price"], state["value"], market.day_key(None)),
            haggle.MAX_RESISTANCE,
        )
        profile.state = {**profile.state, "saved": market.seen(saved, base["id"])}
    await db.execute(
        delete(GameSession).where(GameSession.user_id == user.id, GameSession.game_type == haggle.GAME_TYPE)
    )
    game = GameSession(user_id=user.id, game_type=haggle.GAME_TYPE, title=state["scenario"]["item"][:80], state=state)
    db.add(game)
    await db.commit()
    await db.refresh(game)
    return _serialize(game)


def _list_extras(
    body: NewNegotiation, account: Optional[GameSession], run: Optional[dict], listing: dict, asking: int,
    flaw: Optional[str], fake: bool,
) -> tuple[Optional[dict], Optional[dict]]:
    """Selling: pay for a boost and for authentication, from the free play account or the run (`run`, when given).
    Returns the authenticator's verdict, if one was asked for, and the run after its fees."""
    fees = []
    if body.boost:
        fees.append((market.boost_fee(body.boost, asking), market.BOOSTS[body.boost]["label"]))
    auth = None
    if body.authenticate:
        if not market.can_authenticate(listing):
            raise HTTPException(status_code=422, detail="This is not something that gets authenticated")
        failed = fake or market.catches(flaw)
        auth = {
            "verdict": "failed" if failed else "passed", "fee": market.auth_fee(asking),
            "note": (f"It did not pass: {flaw if flaw and market.catches(flaw) else 'it is a counterfeit'}. "
                     "It is listed without the badge.") if failed
                    else "Authentic. Buyers see the badge, and trust it enough to pay more.",
        }
        fees.append((auth["fee"], "Authentication"))
    try:
        for fee, what in fees:
            if run is not None:
                run = hustle.charge(run, fee, listing["item"], what)
            else:
                account.state = bank.record(account.state, "fee", fee, listing["item"], what)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    return auth, run


async def _create_hustle_chat(
    body: NewNegotiation, user: User, db: AsyncSession, trust: int = 0, given: Optional[list] = None,
) -> dict:
    """A chat inside the Hustle run, at the run's prices. Starting it uses a day."""
    run_game = await _hustle_run(user, db)
    if not run_game or run_game.state["status"] != "active":
        raise HTTPException(status_code=409, detail="Start a Hustle run first")
    run = run_game.state
    if body.custom:
        raise HTTPException(status_code=422, detail="Listings of your own are for free play")
    if any(v is not None for v in (body.title, body.condition, body.category, body.description)):
        raise HTTPException(status_code=422, detail="A Hustle item keeps its listing; add notes instead")
    if body.mode == selling.MODE:
        item = body.inventory_id and hustle.holding(run, str(body.inventory_id))
        if not item or item.get("sold"):
            raise HTTPException(status_code=404, detail="That is not in this run's inventory")
        listing = {
            "id": item.get("listing"), "item": item["title"], "list_price": item["list_price"],
                "value": item.get("value") or item["list_price"],
            **{k: item.get(k) for k in ("condition", "description", "category", "setting")},
        }
        asking = body.asking or item["list_price"]
        auth, run = _list_extras(body, None, run, listing, asking, item.get("flaw"), bool(item.get("fake")))
        state = selling.new_game(
            listing, asking, item["paid"], item["id"], body.difficulty,
            notes=body.notes and " ".join(body.notes.split()), patience_bonus=trust,
            boost=body.boost, authenticated=bool(auth and auth["verdict"] == "passed"),
        )
        state["auth"] = auth
    elif body.callback:
        # A seller who messaged again: their new price, and they open with it
        try:
            run, callback = hustle.take_callback(run, body.callback)
        except ValueError as e:
            raise HTTPException(status_code=409, detail=str(e))
        scenario = haggle.scenario_for(callback["scenario"])
        state = haggle.new_game(
            scenario["id"], body.difficulty, list_price=callback["price"], value=hustle.value_of(run, scenario),
            patience_bonus=trust,
        )
        state["opening"] = f"Hey, still interested? I can do ${callback['price']:,} now."
        state["callback"] = {"was": callback["was"]}
    else:
        scenario = haggle.scenario_for(body.scenario)
        price, value = hustle.price_of(run, scenario), hustle.value_of(run, scenario)
        # A saved listing that has dropped is messaged at its new price; a busy seller holds out
        saved = run.get("saved") or []
        cut = market.saved_cut(saved, scenario["id"])
        state = haggle.new_game(
            scenario["id"], body.difficulty, list_price=haggle._nice(price * cut, price) if cut < 1 else price,
            value=value, patience_bonus=trust,
        )
        state = market.make_busy(
            state, market.buzz(scenario, price, value, market.day_key(run)), haggle.MAX_RESISTANCE,
        )
        run = {**run, "saved": market.seen(saved, scenario["id"])}
    if body.mode != selling.MODE:
        state["seller"] = reviews.with_yours(state.get("seller"), given or [], state["scenario"]["id"])
    try:
        started = hustle.start_chat(run)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    if body.mode == selling.MODE:
        # The notes stay with this holding, to start from the next time it goes up for sale
        hustle.holding(started, str(body.inventory_id))["notes"] = state["scenario"]["notes"]
    run_game.state = started
    state["run_id"] = str(run_game.id)
    await db.execute(
        delete(GameSession).where(GameSession.user_id == user.id, GameSession.game_type == haggle.GAME_TYPE)
    )
    game = GameSession(user_id=user.id, game_type=haggle.GAME_TYPE, title=state["scenario"]["item"][:80], state=state)
    db.add(game)
    await db.commit()
    await db.refresh(game)
    return _serialize(game)


@router.post("/model-arena", status_code=201)
async def create_arena(
    body: NewArena,
    user: User = Depends(get_user),
    db: AsyncSession = Depends(get_db),
):
    """Set up a debate. Nothing is said until the first turn is played."""
    topic = " ".join(body.topic.split())
    if len(topic) < 3:
        raise HTTPException(status_code=422, detail="Give the debate a topic")
    # Old debates make room for new ones instead of blocking them.
    kept = await db.execute(
        select(GameSession.id)
        .where(GameSession.user_id == user.id, GameSession.game_type == arena.GAME_TYPE)
        .order_by(GameSession.updated_at.desc())
        .offset(MAX_SAVES_PER_GAME - 1)
    )
    stale = [row[0] for row in kept.all()]
    if stale:
        await db.execute(delete(GameSession).where(GameSession.id.in_(stale)))
    state = arena.new_game(topic, [
        {"model": s.model.strip(), "character": " ".join(s.character.split()), "prompt": s.prompt.strip()}
        for s in body.sides
    ], body.mode)
    game = GameSession(user_id=user.id, game_type=arena.GAME_TYPE, title=topic[:80], state=state)
    db.add(game)
    await db.commit()
    await db.refresh(game)
    return _serialize(game)


@router.patch("/{game_id}/verdict")
async def give_verdict(
    game_id: uuid.UUID,
    body: Verdict,
    user: User = Depends(get_user),
    db: AsyncSession = Depends(get_db),
):
    """The moderator names the winner of a finished debate."""
    game = await _owned_game(game_id, user, db)
    if game.game_type != arena.GAME_TYPE:
        raise HTTPException(status_code=400, detail="Unknown game")
    try:
        game.state = arena.set_winner(game.state, body.winner)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    await db.commit()
    await db.refresh(game)
    return _serialize(game)


@router.patch("/{game_id}/question")
async def ask_question(
    game_id: uuid.UUID,
    body: ModeratorQuestion,
    user: User = Depends(get_user),
    db: AsyncSession = Depends(get_db),
):
    """The moderator's question at the end of a debate round. Both sides answer it next."""
    game = await _owned_game(game_id, user, db)
    if game.game_type != arena.GAME_TYPE:
        raise HTTPException(status_code=400, detail="Unknown game")
    try:
        game.state = arena.ask_question(game.state, body.question)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    await db.commit()
    await db.refresh(game)
    return _serialize(game)


@router.get("/{game_id}")
async def get_game(
    game_id: uuid.UUID,
    user: User = Depends(get_user),
    db: AsyncSession = Depends(get_db),
):
    return _serialize(await _owned_game(game_id, user, db))


@router.delete("/{game_id}", status_code=204)
async def delete_game(
    game_id: uuid.UUID,
    user: User = Depends(get_user),
    db: AsyncSession = Depends(get_db),
):
    await db.delete(await _owned_game(game_id, user, db))
    await db.commit()


@router.patch("/{game_id}/products/{product_id}")
async def edit_product(
    game_id: uuid.UUID,
    product_id: str,
    body: ProductEdit,
    user: User = Depends(get_user),
    db: AsyncSession = Depends(get_db),
):
    """Rename or reprice a product from the dashboard, without playing a turn."""
    game = await _owned_game(game_id, user, db)
    if game.game_type != ceo.GAME_TYPE:
        raise HTTPException(status_code=400, detail="Unknown game")
    state = ceo.upgrade(game.state)
    if state.get("status") != "active":
        raise HTTPException(status_code=409, detail="This game is over")
    try:
        if body.name is not None:
            state = ceo.rename_product(state, product_id, body.name)
        if body.price is not None:
            state = ceo.set_price(state, product_id, body.price)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    game.state = state
    await db.commit()
    await db.refresh(game)
    return _serialize(game)


@router.patch("/{game_id}/continue")
async def continue_game(
    game_id: uuid.UUID,
    user: User = Depends(get_user),
    db: AsyncSession = Depends(get_db),
):
    """Keep playing a run that has ended. Its recorded score stays as it is."""
    game = await _owned_game(game_id, user, db)
    if game.game_type != ceo.GAME_TYPE:
        raise HTTPException(status_code=400, detail="Unknown game")
    try:
        game.state = ceo.continue_game(ceo.upgrade(game.state))
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    await db.commit()
    await db.refresh(game)
    return _serialize(game)


@router.patch("/{game_id}/loan")
async def take_loan(
    game_id: uuid.UUID,
    body: LoanRequest,
    user: User = Depends(get_user),
    db: AsyncSession = Depends(get_db),
):
    """Borrow from the bank. Instant: no turn, no model call."""
    game = await _owned_game(game_id, user, db)
    if game.game_type != ceo.GAME_TYPE:
        raise HTTPException(status_code=400, detail="Unknown game")
    try:
        game.state = ceo.take_loan(ceo.upgrade(game.state), body.amount)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    await db.commit()
    await db.refresh(game)
    return _serialize(game)


class Infusion(BaseModel):
    """Founder money put into the company."""
    amount: int = Field(..., gt=0, le=ceo.MAX_INFUSION)


@router.patch("/{game_id}/infuse")
async def infuse_cash(
    game_id: uuid.UUID,
    body: Infusion,
    user: User = Depends(get_user),
    db: AsyncSession = Depends(get_db),
):
    """Put the founder's own money in. Instant and unlimited: no turn, no model call."""
    game = await _owned_game(game_id, user, db)
    if game.game_type != ceo.GAME_TYPE:
        raise HTTPException(status_code=400, detail="Unknown game")
    try:
        game.state = ceo.infuse(ceo.upgrade(game.state), body.amount)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    await db.commit()
    await db.refresh(game)
    return _serialize(game)


class StaffHire(BaseModel):
    candidate_id: str = Field(..., min_length=1, max_length=20)


@router.patch("/{game_id}/staff/hire")
async def hire_candidate(
    game_id: uuid.UUID,
    body: StaffHire,
    user: User = Depends(get_user),
    db: AsyncSession = Depends(get_db),
):
    """Hire someone from the candidate pool. Instant: no turn, no model call."""
    game = await _owned_game(game_id, user, db)
    if game.game_type != ceo.GAME_TYPE:
        raise HTTPException(status_code=400, detail="Unknown game")
    try:
        game.state = ceo.hire_candidate(ceo.upgrade(game.state), body.candidate_id)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    await db.commit()
    await db.refresh(game)
    return _serialize(game)


@router.patch("/{game_id}/staff/{staff_id}/release")
async def release_staff(
    game_id: uuid.UUID,
    staff_id: str,
    user: User = Depends(get_user),
    db: AsyncSession = Depends(get_db),
):
    """Let one person go. Before week one, this undoes a hire for a full refund."""
    game = await _owned_game(game_id, user, db)
    if game.game_type != ceo.GAME_TYPE:
        raise HTTPException(status_code=400, detail="Unknown game")
    try:
        game.state = ceo.release_staff(ceo.upgrade(game.state), staff_id)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    await db.commit()
    await db.refresh(game)
    return _serialize(game)


@router.patch("/{game_id}/undo")
async def undo_turn(
    game_id: uuid.UUID,
    user: User = Depends(get_user),
    db: AsyncSession = Depends(get_db),
):
    """Take back the last week played."""
    game = await _owned_game(game_id, user, db)
    if game.game_type != ceo.GAME_TYPE:
        raise HTTPException(status_code=400, detail="Unknown game")
    try:
        game.state = ceo.undo_turn(game.state)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    game.title = game.state["company"]["name"][:80]
    await db.commit()
    await db.refresh(game)
    return _serialize(game)


@router.patch("/{game_id}/loan/repay")
async def repay_loan(
    game_id: uuid.UUID,
    body: LoanRepayment,
    user: User = Depends(get_user),
    db: AsyncSession = Depends(get_db),
):
    """Pay a loan off early. Instant: no turn, no model call."""
    game = await _owned_game(game_id, user, db)
    if game.game_type != ceo.GAME_TYPE:
        raise HTTPException(status_code=400, detail="Unknown game")
    try:
        game.state = ceo.repay_loan(ceo.upgrade(game.state), body.index)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    await db.commit()
    await db.refresh(game)
    return _serialize(game)


@router.patch("/{game_id}/offer")
async def answer_offer(
    game_id: uuid.UUID,
    body: OfferAnswer,
    user: User = Depends(get_user),
    db: AsyncSession = Depends(get_db),
):
    """Accept or turn down the offer on the table. Instant: no turn, no model call."""
    game = await _owned_game(game_id, user, db)
    if game.game_type != ceo.GAME_TYPE:
        raise HTTPException(status_code=400, detail="Unknown game")
    try:
        game.state = ceo.answer_offer(ceo.upgrade(game.state), body.choice)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    score = _score_for(user, game.title, game.state)  # accepting a buyout ends the run
    if score:
        db.add(score)
    await db.commit()
    await db.refresh(game)
    return _serialize(game)


async def _unsold_purchase(row_id: uuid.UUID, user: User, db: AsyncSession) -> GameScore:
    """Something the caller bought and still has."""
    row = (await db.execute(
        select(GameScore).where(
            GameScore.id == row_id, GameScore.user_id == user.id, GameScore.game_type == haggle.GAME_TYPE,
        )
    )).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="That is not in your inventory")
    if row.detail.get("sold"):
        raise HTTPException(status_code=409, detail="You already sold that")
    return row


def _sale_score(user: User, state: dict) -> Optional[GameScore]:
    """A score row for a sale that went through. Keeping the item records nothing."""
    result = state.get("result") or {}
    if result.get("outcome") != "sold":
        return None
    return GameScore(
        user_id=user.id, game_type=SALE_GAME_TYPE, title=state["scenario"]["item"][:80], score=int(result["score"]),
        detail={
            **{k: result.get(k) for k in ("outcome", "rating", "paid", "rounds", "profit", "ceiling")},
            "asking": state["list_price"],
            "cost": state.get("cost"),
            "buyer": state["scenario"]["merchant"],
            "buyer_kind": state["scenario"].get("kind"),
            "difficulty": state.get("difficulty", "normal"),
            "inventory_id": state.get("inventory_id"),
            **{k: state["scenario"].get(k) for k in ("condition", "category")},
        },
    )


async def _mark_sold(user: User, state: dict, db: AsyncSession) -> None:
    """Record a sale against the purchase it came from, so the inventory shows it as sold."""
    result = state.get("result") or {}
    if result.get("outcome") != "sold" or not state.get("inventory_id"):
        return
    row = (await db.execute(
        select(GameScore).where(GameScore.id == uuid.UUID(state["inventory_id"]), GameScore.user_id == user.id)
    )).scalar_one_or_none()
    if row and not row.detail.get("sold"):
        # A new dict, so the change to the JSON column is noticed
        row.detail = {**row.detail, "sold": {
            "price": result["paid"], "profit": result.get("profit"), "buyer": state["scenario"]["merchant"],
            "rating": result["rating"], "at": datetime.now(timezone.utc).isoformat(),
        }}


def _haggle_score(user: User, state: dict) -> Optional[GameScore]:
    """A score row for a haggle that ended in a deal. Walking away records nothing."""
    if state.get("mode") == selling.MODE:
        return _sale_score(user, state)
    result = state.get("result") or {}
    if result.get("outcome") != "deal" or (result.get("pickup") or {}).get("kind") == "scam":
        return None             # a scam leaves nothing to put in the inventory
    return GameScore(
        user_id=user.id, game_type=haggle.GAME_TYPE, title=state["scenario"]["item"][:80], score=int(result["score"]),
        # Everything the inventory shows, kept with the purchase so it outlives the listing
        detail={
            **{k: result.get(k) for k in ("outcome", "rating", "paid", "rounds", "saved", "floor")},
            "list_price": state["list_price"],
            "value": state.get("value"),
            "flaw": (state.get("flaw") or {}).get("text"),
            "merchant": state["scenario"]["merchant"],
            "difficulty": state.get("difficulty", "normal"),
            "listing": state["scenario"].get("id"),
            **{k: state["scenario"].get(k) for k in ("condition", "description", "setting")},
            "category": state["scenario"].get("category") or haggle.category_of(state["scenario"].get("id")),
        },
    )


async def _end_haggle(game_id: uuid.UUID, user: User, db: AsyncSession, move: str) -> dict:
    """`move` is accept (take the price on the table), trade (take the trade on the table) or walk_away,
    in whichever direction the haggle runs."""
    game = await _owned_game(game_id, user, db)
    if game.game_type != haggle.GAME_TYPE:
        raise HTTPException(status_code=400, detail="Unknown game")
    rules = _haggle_rules(game.state)
    buying = rules is haggle
    # What leaves the account if this goes through: the price, or a trade's cash
    if move == "trade" and buying:
        due = int((game.state.get("trade_offer") or {}).get("cash") or 0)
    else:
        due = int(game.state.get("ask") or 0) if move == "accept" and buying else 0
    run_game = game.state.get("run_id") and await _hustle_run(user, db, game.state["run_id"])
    if run_game and due and not hustle.can_pay(run_game.state, due):
        raise HTTPException(status_code=409, detail=f"You only have ${run_game.state['cash']:,} in your account.")
    account = None if game.state.get("run_id") else await _free_bank(user, db)
    if account and due and not bank.can_pay(account.state, due):
        raise HTTPException(status_code=409, detail=f"You only have ${account.state['cash']:,} in your account.")
    # Something offered in a trade has to still be yours
    gave_row = None
    if move == "trade" and buying and account:
        gave_row = await _unsold_purchase(uuid.UUID(game.state["trade_offer"]["item_id"]), user, db)
    try:
        # Fakes and bounced payments only happen where the money is real
        if move == "accept":
            game.state = rules.accept(game.state, scams=bool(run_game))
        elif move == "trade":
            game.state = (trades.accept_trade if buying else selling.accept_trade)(game.state, scams=bool(run_game))
        else:
            game.state = rules.walk_away(game.state)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    profile = await _ready(account or await _free_bank(user, db), user, db)
    left = extras.review(game.state)
    profile.state = bank.add_review(profile.state, left)
    result = game.state.get("result") or {}
    listing = game.state["scenario"].get("id")
    if game.state.get("run_id"):
        # A Hustle chat moves the run's money, not the free play inventory and scores
        if run_game and run_game.state["status"] == "active":
            outcome = result.get("outcome")
            try:
                if outcome == "deal":
                    run_game.state = hustle.record_purchase(run_game.state, game.state)
                    run_game.state = {**run_game.state, "saved": market.without(run_game.state.get("saved") or [], listing)}
                elif outcome == "sold":
                    run_game.state = hustle.record_sale(run_game.state, game.state)
                elif outcome == "walked" and buying:
                    run_game.state = hustle.maybe_callback(run_game.state, game.state)
            except ValueError as e:
                raise HTTPException(status_code=409, detail=str(e))
            _settle_run(user, run_game, db)
    else:
        score = _haggle_score(user, game.state)
        if score:
            db.add(score)
        await _mark_sold(user, game.state, db)
        trade = result.get("trade")
        if gave_row and trade:
            # Traded away: it leaves the inventory as if sold, for what the trade counted it as
            gave_row.detail = {**gave_row.detail, "sold": {
                "price": trade["value"], "profit": trade["value"] - int(gave_row.detail.get("paid") or 0),
                "buyer": game.state["scenario"]["merchant"], "rating": "Traded", "traded": True,
                "at": datetime.now(timezone.utc).isoformat(),
            }}
        if trade and result.get("outcome") == "sold":
            db.add(_trade_in_row(user, game.state))
        if account and result.get("paid") is not None:
            scenario = game.state["scenario"]
            kind = "sell" if result["outcome"] == "sold" else "buy"
            try:
                account.state = bank.record(
                    account.state, kind, int(result.get("paid_cash", result["paid"])), scenario["item"], scenario["merchant"],
                    result.get("profit") if kind == "sell" else None,
                )
            except ValueError as e:
                raise HTTPException(status_code=409, detail=str(e))
            if kind == "buy":
                account.state = {**account.state, "saved": market.without(account.state.get("saved") or [], listing)}
    # Shown with the result: who rated you and how, and any badge it earned
    game.state = {**game.state, "review": left, "badges_new": _after_chat(profile, game.state)}
    await db.commit()
    await db.refresh(game)
    return _serialize(game)


def _trade_in_row(user: User, state: dict) -> GameScore:
    """What a buyer traded you, joining the inventory at what the trade counted it as."""
    trade = state["result"]["trade"]
    return GameScore(
        user_id=user.id, game_type=haggle.GAME_TYPE, title=trade["got"][:80], score=0,
        detail={
            "outcome": "deal", "rating": "Traded", "paid": trade["worth"], "rounds": 0, "saved": None,
            "list_price": trade["worth"], "value": trade["value"], "flaw": trade.get("flaw"),
            "merchant": state["scenario"]["merchant"], "difficulty": state.get("difficulty", "normal"),
            "listing": trade["listing"],
            **{k: trade.get(k) for k in ("condition", "description", "setting", "category")},
        },
    )


@router.patch("/{game_id}/buyer")
async def pick_buyer(
    game_id: uuid.UUID,
    body: BuyerPick,
    user: User = Depends(get_user),
    db: AsyncSession = Depends(get_db),
):
    """Selling: answer one of the buyers who messaged about the listing."""
    game = await _owned_game(game_id, user, db)
    if game.game_type != haggle.GAME_TYPE or game.state.get("mode") != selling.MODE:
        raise HTTPException(status_code=400, detail="Only a listing has buyers to pick from")
    try:
        game.state = selling.choose(game.state, body.index)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    await db.commit()
    await db.refresh(game)
    return _serialize(game)


async def _haggle_in_play(game_id: uuid.UUID, user: User, db: AsyncSession) -> GameSession:
    game = await _owned_game(game_id, user, db)
    if game.game_type != haggle.GAME_TYPE:
        raise HTTPException(status_code=400, detail="Unknown game")
    return game


@router.patch("/{game_id}/research")
async def research_listing(game_id: uuid.UUID, user: User = Depends(get_user), db: AsyncSession = Depends(get_db)):
    """Buying: check sold listings for what tends to go wrong with this item. Free, or $5 in Hustle. Once per chat."""
    game = await _haggle_in_play(game_id, user, db)
    state = game.state
    if _haggle_rules(state) is not haggle or state.get("status") != "active":
        raise HTTPException(status_code=409, detail="Only while you are buying")
    if state.get("research"):
        raise HTTPException(status_code=409, detail="You already checked")
    run_game = state.get("run_id") and await _hustle_run(user, db, state["run_id"])
    if run_game:
        try:
            run_game.state = hustle.charge(run_game.state, hustle.RESEARCH_FEE, state["scenario"]["item"], "Checked sold listings")
        except ValueError as e:
            raise HTTPException(status_code=409, detail=str(e))
    # When, so it shows in the chat where it happened
    game.state = {**state, "research": extras.sold_listings(state), "research_turn": state.get("turn", 0)}
    await db.commit()
    await db.refresh(game)
    return _serialize(game)


@router.patch("/{game_id}/refund")
async def ask_for_refund(game_id: uuid.UUID, user: User = Depends(get_user), db: AsyncSession = Depends(get_db)):
    """At pickup, ask the seller for money back for a flaw they kept quiet about. Once."""
    game = await _haggle_in_play(game_id, user, db)
    try:
        game.state = haggle.ask_refund(game.state)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    amount = game.state["result"]["pickup"]["refunded"]
    if amount:
        item, other = game.state["scenario"]["item"], game.state["scenario"]["merchant"]
        run_game = game.state.get("run_id") and await _hustle_run(user, db, game.state["run_id"])
        if run_game:
            run_game.state = hustle.refund(run_game.state, amount, item, other)
        elif not game.state.get("run_id"):
            account = await _free_bank(user, db)
            account.state = bank.record(account.state, "refund", amount, item, other)
    await db.commit()
    await db.refresh(game)
    return _serialize(game)


@router.patch("/{game_id}/report")
async def report_seller(game_id: uuid.UUID, user: User = Depends(get_user), db: AsyncSession = Depends(get_db)):
    """Report a scammer after the chat. A payment made in the app gets some of it back from Purchase
    Protection: at once in free play, a couple of days later in a Hustle run."""
    game = await _haggle_in_play(game_id, user, db)
    try:
        game.state = haggle.report(game.state)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    profile = await _ready(await _free_bank(user, db), user, db)
    game.state = {**game.state, "badges_new": _bump(profile, "scams_reported")}
    pickup = game.state["result"].get("pickup") or {}
    amount = pickup.get("refunded")
    if amount:
        item = game.state["scenario"]["item"]
        run_game = game.state.get("run_id") and await _hustle_run(user, db, game.state["run_id"])
        if run_game and run_game.state["status"] == "active":
            run_game.state, pickup["due_day"] = hustle.file_claim(run_game.state, amount, item)
        elif run_game:
            run_game.state = hustle.refund(run_game.state, amount, item, "Purchase Protection")
        elif not game.state.get("run_id"):
            account = await _free_bank(user, db)
            account.state = bank.record(account.state, "refund", amount, item, "Purchase Protection")
        # A new dict, so the change to the JSON column is noticed
        game.state = {**game.state}
    await db.commit()
    await db.refresh(game)
    return _serialize(game)


class BounceRequest(BaseModel):
    model: Optional[str] = Field(default=None, max_length=100, pattern=MODEL_NAME_PATTERN)
    clean: bool          = False


@router.patch("/{game_id}/bounce")
@limiter.limit(CHAT_RATE_LIMIT)
async def payment_bounced(
    request: Request,
    game_id: uuid.UUID,
    body: BounceRequest,
    user: User = Depends(get_user),
    db: AsyncSession = Depends(get_db),
):
    """Buying: the player tried to pay more than they have. The seller hears about it, once per chat."""
    game = await _haggle_in_play(game_id, user, db)
    state = game.state
    if _haggle_rules(state) is not haggle or not haggle.can_bounce(state):
        raise HTTPException(status_code=409, detail="Nothing to tell them")
    # Only a payment that really could not go through bounces
    run_game = state.get("run_id") and await _hustle_run(user, db, state["run_id"])
    if run_game:
        covered = hustle.can_pay(run_game.state, state["ask"])
    elif state.get("run_id"):
        covered = True
    else:
        covered = bank.can_pay((await _free_bank(user, db)).state, state["ask"] or 0)
    if covered:
        raise HTTPException(status_code=409, detail="That payment would go through")
    turn_before = state["turn"]
    base_url = await effective_ollama_url(user)
    # The model can take a while; do not hold a pooled connection for it.
    await db.close()

    reply = await _ask_with_retry(
        game_id, base_url, body.model, haggle.SYSTEM_PROMPT,
        haggle.describe_bounce_for_model(state, clean=body.clean), haggle.REPLY_SCHEMA,
    )
    new_state = haggle.apply_bounce(state, reply)

    async with AsyncSessionLocal() as write_db:
        current = (await write_db.execute(
            select(GameSession).where(GameSession.id == game_id, GameSession.user_id == user.id)
        )).scalar_one_or_none()
        if not current:
            raise HTTPException(status_code=404, detail="Game not found")
        if current.state.get("turn") != turn_before or current.state.get("status") != "active":
            raise HTTPException(status_code=409, detail="This turn was already played. Reload the game.")
        await write_db.execute(update(GameSession).where(GameSession.id == game_id).values(state=new_state))
        await write_db.commit()
        await write_db.refresh(current)
        return _serialize(current)


@router.patch("/{game_id}/switch")
async def switch_buyer(game_id: uuid.UUID, user: User = Depends(get_user), db: AsyncSession = Depends(get_db)):
    """Selling: drop this buyer for the one who just messaged with a better offer."""
    game = await _haggle_in_play(game_id, user, db)
    if game.state.get("mode") != selling.MODE:
        raise HTTPException(status_code=400, detail="Only a sale has other buyers")
    try:
        game.state = selling.switch(game.state)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    await db.commit()
    await db.refresh(game)
    return _serialize(game)


@router.post("/{game_id}/chat")
@limiter.limit(CHAT_RATE_LIMIT)
async def keep_chatting(
    request: Request,
    game_id: uuid.UUID,
    body: AfterChat,
    user: User = Depends(get_user),
    db: AsyncSession = Depends(get_db),
):
    """Talk on with the seller or buyer once the haggle is over. Nothing about the deal changes."""
    game = await _owned_game(game_id, user, db)
    if game.game_type != haggle.GAME_TYPE:
        raise HTTPException(status_code=400, detail="Unknown game")
    state = game.state
    if not aftertalk.can_chat(state):
        raise HTTPException(status_code=409, detail="Finish the haggle first")
    message = " ".join(body.message.split())
    talked_before = len(state.get("after") or [])
    base_url = await effective_ollama_url(user)
    # The model can take a while; do not hold a pooled connection for it.
    await db.close()

    reply = await _ask_with_retry(
        game_id, base_url, body.model, aftertalk.SYSTEM_PROMPT,
        aftertalk.describe_for_model(state, message, clean=body.clean), aftertalk.REPLY_SCHEMA,
    )
    new_state = aftertalk.apply_reply(state, message, reply)

    async with AsyncSessionLocal() as write_db:
        current = (await write_db.execute(
            select(GameSession).where(GameSession.id == game_id, GameSession.user_id == user.id)
        )).scalar_one_or_none()
        if not current:
            raise HTTPException(status_code=404, detail="Game not found")
        if len(current.state.get("after") or []) != talked_before:
            raise HTTPException(status_code=409, detail="That message was already sent. Reload the chat.")
        await write_db.execute(update(GameSession).where(GameSession.id == game_id).values(state=new_state))
        await write_db.commit()
        await write_db.refresh(current)
        return _serialize(current)


class LastWordRequest(BaseModel):
    model: Optional[str] = Field(default=None, max_length=100, pattern=MODEL_NAME_PATTERN)
    clean: bool          = False


@router.patch("/{game_id}/last-word")
@limiter.limit(CHAT_RATE_LIMIT)
async def last_word(
    request: Request,
    game_id: uuid.UUID,
    body: LastWordRequest,
    user: User = Depends(get_user),
    db: AsyncSession = Depends(get_db),
):
    """Selling: a buyer of the sore-loser kind has something to say about the item being kept. Once."""
    game = await _haggle_in_play(game_id, user, db)
    state = game.state
    if not aftertalk.wants_last_word(state):
        raise HTTPException(status_code=409, detail="Nothing more to say")
    base_url = await effective_ollama_url(user)
    # The model can take a while; do not hold a pooled connection for it.
    await db.close()

    reply = await _ask_with_retry(
        game_id, base_url, body.model, aftertalk.SYSTEM_PROMPT,
        aftertalk.describe_last_word(state, clean=body.clean), aftertalk.REPLY_SCHEMA,
    )
    new_state = aftertalk.apply_last_word(state, reply)

    async with AsyncSessionLocal() as write_db:
        current = (await write_db.execute(
            select(GameSession).where(GameSession.id == game_id, GameSession.user_id == user.id)
        )).scalar_one_or_none()
        if not current:
            raise HTTPException(status_code=404, detail="Game not found")
        if current.state.get("after"):
            raise HTTPException(status_code=409, detail="That message was already sent. Reload the chat.")
        await write_db.execute(update(GameSession).where(GameSession.id == game_id).values(state=new_state))
        await write_db.commit()
        await write_db.refresh(current)
        return _serialize(current)


@router.patch("/{game_id}/accept")
async def accept_price(
    game_id: uuid.UUID,
    user: User = Depends(get_user),
    db: AsyncSession = Depends(get_db),
):
    """Close at the price on the table: pay the seller, or take the buyer's money. Instant: no model call."""
    return await _end_haggle(game_id, user, db, "accept")


@router.patch("/{game_id}/walk")
async def walk_away(
    game_id: uuid.UUID,
    user: User = Depends(get_user),
    db: AsyncSession = Depends(get_db),
):
    """Leave without buying, or keep the item instead of selling. Instant: no model call."""
    return await _end_haggle(game_id, user, db, "walk_away")


@router.patch("/{game_id}/trade")
async def accept_trade(
    game_id: uuid.UUID,
    user: User = Depends(get_user),
    db: AsyncSession = Depends(get_db),
):
    """Take the trade on the table: the one a seller agreed to, or the one a buyer offered. Instant."""
    return await _end_haggle(game_id, user, db, "trade")


class TradeOffer(BaseModel):
    """Buying: one of your things, and cash if you like, instead of paying the price."""
    item_id: str           = Field(..., min_length=1, max_length=40)
    cash:    int           = Field(default=0, ge=0, le=10_000_000_000)
    message: str           = Field(default="", max_length=400)
    model:   Optional[str] = Field(default=None, max_length=100, pattern=MODEL_NAME_PATTERN)
    clean:   bool          = False


async def _tradeable(user: User, db: AsyncSession, state: dict, item_id: str) -> dict:
    """Something of yours that can go in a trade: in the run's holdings in Hustle, the inventory in free play."""
    if state.get("run_id"):
        run_game = await _hustle_run(user, db, state["run_id"])
        item = run_game and hustle.holding(run_game.state, item_id)
        if not item or item.get("sold"):
            raise HTTPException(status_code=404, detail="That is not in this run's inventory")
        return {"id": item["id"], "title": item["title"], "value": item.get("value") or item["list_price"],
                "paid": item["paid"], "category": item.get("category")}
    try:
        row = await _unsold_purchase(uuid.UUID(item_id), user, db)
    except ValueError:
        raise HTTPException(status_code=404, detail="That is not in your inventory")
    return {"id": str(row.id), "title": row.title, "value": row.detail.get("value") or row.detail.get("list_price") or 0,
            "paid": row.detail.get("paid"), "category": row.detail.get("category")}


@router.patch("/{game_id}/trade-offer")
@limiter.limit(CHAT_RATE_LIMIT)
async def offer_trade(
    request: Request,
    game_id: uuid.UUID,
    body: TradeOffer,
    user: User = Depends(get_user),
    db: AsyncSession = Depends(get_db),
):
    """Buying: offer one of your things, plus cash if you like. The seller answers in character; a yes or a
    counter stands for you to confirm. Costs patience like any message."""
    game = await _haggle_in_play(game_id, user, db)
    state = game.state
    if _haggle_rules(state) is not haggle or not trades.can_trade(state):
        raise HTTPException(status_code=409, detail="You can offer a trade while you are buying, before their final price")
    item = await _tradeable(user, db, state, body.item_id)
    verdict = trades.judge(state, item, body.cash)
    message = " ".join(body.message.split()) or trades.trade_message(verdict)
    base_url = await effective_ollama_url(user)
    turn_before = state["turn"]
    # The model can take a while; do not hold a pooled connection for it.
    await db.close()

    reply = await _ask_with_retry(
        game_id, base_url, body.model, haggle.SYSTEM_PROMPT,
        trades.describe_trade_for_model(state, message, verdict, clean=body.clean), haggle.REPLY_SCHEMA,
    )
    new_state = trades.apply_trade(state, message, verdict, reply)

    async with AsyncSessionLocal() as write_db:
        current = (await write_db.execute(
            select(GameSession).where(GameSession.id == game_id, GameSession.user_id == user.id)
        )).scalar_one_or_none()
        if not current:
            raise HTTPException(status_code=404, detail="Game not found")
        if current.state.get("turn") != turn_before:
            raise HTTPException(status_code=409, detail="That turn was already played. Reload the chat.")
        await write_db.execute(update(GameSession).where(GameSession.id == game_id).values(state=new_state))
        await write_db.commit()
        await write_db.refresh(current)
        return _serialize(current)


@router.patch("/{game_id}/authenticate")
async def authenticate_listing(game_id: uuid.UUID, user: User = Depends(get_user), db: AsyncSession = Depends(get_db)):
    """Buying: have it checked before paying, for a fee. Catches fakes and tampering, not ordinary wear.
    A scammer will not send it in, and that costs nothing. Once per chat."""
    game = await _haggle_in_play(game_id, user, db)
    state = game.state
    if _haggle_rules(state) is not haggle or state.get("status") != "active":
        raise HTTPException(status_code=409, detail="Only while you are buying")
    if state.get("auth"):
        raise HTTPException(status_code=409, detail="You already had it authenticated")
    if not market.can_authenticate(state["scenario"]):
        raise HTTPException(status_code=409, detail="This is not something that gets authenticated")
    run_game = state.get("run_id") and await _hustle_run(user, db, state["run_id"])
    checked = market.authenticate(state, fake=haggle.counterfeit_roll(state, bool(run_game), random.Random()))
    fee, item = checked["auth"]["fee"], state["scenario"]["item"]
    if fee:
        try:
            if run_game:
                run_game.state = hustle.charge(run_game.state, fee, item, "Authentication")
            elif not state.get("run_id"):
                account = await _free_bank(user, db)
                account.state = bank.record(account.state, "fee", fee, item, "Authentication")
        except ValueError as e:
            raise HTTPException(status_code=409, detail=str(e))
    checked["auth"]["turn"] = state.get("turn", 0)
    game.state = checked
    await db.commit()
    await db.refresh(game)
    return _serialize(game)


class SaveToggle(BaseModel):
    listing: str  = Field(..., min_length=1, max_length=20)
    # The Hustle run's saved listings, apart from free play's
    hustle:  bool = False


@router.post("/negotiation/saved")
async def toggle_saved(body: SaveToggle, user: User = Depends(get_user), db: AsyncSession = Depends(get_db)) -> dict:
    """Save a listing to watch for price drops, or unsave it."""
    if not haggle.scenario_for(body.listing) or haggle.scenario_for(body.listing)["id"] != body.listing:
        raise HTTPException(status_code=404, detail="No such listing")
    try:
        if body.hustle:
            run_game = await _hustle_run(user, db)
            if not run_game or run_game.state["status"] != "active":
                raise HTTPException(status_code=409, detail="Start a Hustle run first")
            saved = market.toggle_saved(run_game.state.get("saved") or [], body.listing, run_game.state["day"])
            run_game.state = {**run_game.state, "saved": saved}
        else:
            account = await _free_bank(user, db)
            saved = market.toggle_saved(account.state.get("saved") or [], body.listing, market.today())
            account.state = {**account.state, "saved": saved}
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    await db.commit()
    return {"saved": saved}


@router.patch("/{game_id}/review-text")
@limiter.limit(CHAT_RATE_LIMIT)
async def write_review(
    request: Request,
    game_id: uuid.UUID,
    body: LastWordRequest,
    user: User = Depends(get_user),
    db: AsyncSession = Depends(get_db),
):
    """The review the other side left you, written in their voice. Asked for once the chat closes,
    so taking the price stays instant; the stock text stands if the model cannot be reached."""
    game = await _haggle_in_play(game_id, user, db)
    state = game.state
    if not (state.get("review") or {}).get("pending"):
        raise HTTPException(status_code=409, detail="Nothing to write")
    base_url = await effective_ollama_url(user)
    # The model can take a while; do not hold a pooled connection for it.
    await db.close()

    try:
        reply = await _ask_with_retry(
            game_id, base_url, body.model, reviews.SYSTEM_PROMPT,
            reviews.describe_review(state, clean=body.clean), reviews.REPLY_SCHEMA, reviews.MAX_TOKENS,
        )
    except HTTPException:
        reply = {}
    new_state = reviews.apply_text(state, reply)

    async with AsyncSessionLocal() as write_db:
        current = (await write_db.execute(
            select(GameSession).where(GameSession.id == game_id, GameSession.user_id == user.id)
        )).scalar_one_or_none()
        if not current:
            raise HTTPException(status_code=404, detail="Game not found")
        if not (current.state.get("review") or {}).get("pending"):
            raise HTTPException(status_code=409, detail="That review was already written. Reload the chat.")
        account = await _free_bank(user, write_db)
        account.state = reviews.with_text(account.state, new_state["review"])
        current.state = {**current.state, "review": new_state["review"]}
        await write_db.commit()
        await write_db.refresh(current)
        return _serialize(current)


@router.delete("/negotiation/reviews/{key}")
async def delete_review(key: str, user: User = Depends(get_user), db: AsyncSession = Depends(get_db)) -> dict:
    """Take back a review you left. The seller's rating stops counting it, and if the chat is
    still open, you can rate them again."""
    account = await _free_bank(user, db)
    try:
        account.state, gone = reviews.remove_given(account.state, key)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    chat = (await db.execute(
        select(GameSession).where(GameSession.user_id == user.id, GameSession.game_type == haggle.GAME_TYPE)
    )).scalars().first()
    if chat and (chat.state.get("your_review") or {}).get("at") == gone["at"]:
        chat.state = {**chat.state, "your_review": None}
    await db.commit()
    return {"given": (account.state.get("given") or [])[::-1]}


class RateBack(BaseModel):
    """Your stars for the person you just dealt with, and a line if you like."""
    stars: int = Field(..., ge=1, le=5)
    text:  str = Field(default="", max_length=reviews.MAX_YOUR_TEXT)


@router.patch("/{game_id}/rate")
async def rate_back(
    game_id: uuid.UUID,
    body: RateBack,
    user: User = Depends(get_user),
    db: AsyncSession = Depends(get_db),
):
    """Rate the seller or buyer you made a deal with. It shows on your profile, and a seller's
    rating counts it from then on."""
    game = await _haggle_in_play(game_id, user, db)
    try:
        game.state, given = reviews.rate(game.state, body.stars, body.text)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    account = await _free_bank(user, db)
    account.state = reviews.add_given(account.state, given)
    await db.commit()
    await db.refresh(game)
    return _serialize(game)


# What each model server has installed, asked once a minute rather than before every turn
MODEL_LIST_SECONDS = 60
_MODEL_LISTS: dict[str, tuple[float, list[str]]] = {}


async def _pick_model(base_url: str, wanted: str) -> str:
    """The model to narrate with: the one asked for if the server has it, else one it does have.

    The model picker can hold a name the current Ollama server does not carry (a
    preset, or a choice made against another server), and Ollama answers that with a 404.
    """
    seen = _MODEL_LISTS.get(base_url)
    if seen and time.monotonic() - seen[0] < MODEL_LIST_SECONDS:
        available = seen[1]
    else:
        try:
            resp = await ollama_http.client().get(f"{base_url}/api/tags", headers=NGROK_HEADERS, timeout=10)
            resp.raise_for_status()
            available = [m.get("name") for m in resp.json().get("models", []) if m.get("name")]
        except Exception as e:
            logger.warning("game_model_list_failed error=%s", str(e))
            return wanted  # cannot check: try what was asked for
        _MODEL_LISTS[base_url] = (time.monotonic(), available)
    if not available:
        raise HTTPException(status_code=502, detail="The model server has no models installed.")
    if wanted in available:
        return wanted
    for fallback in (_config.GAME_MODEL, _config.DEFAULT_MODEL):
        if fallback in available:
            return fallback
    # Reasoning models are slow and add nothing to a JSON turn; prefer any other.
    plain = [m for m in available if not any(p in m.lower() for p in THINKING_MODELS)]
    return (plain or available)[0]


async def _ask_json(
    base_url: str, model: str, system: str, prompt: str, schema: dict, max_tokens: Optional[int] = None,
) -> dict:
    """One model call that must come back as a JSON object matching `schema`. `max_tokens` caps a short answer."""
    payload: dict = {
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": prompt},
        ],
        "stream": False,
        "keep_alive": -1,
        "format": schema,
        "options": {"temperature": JSON_TURN_TEMPERATURE, **({"num_predict": max_tokens} if max_tokens else {})},
    }
    if await ollama_caps.can_think(base_url, model):
        payload["think"] = False
    resp = await ollama_http.client().post(
        f"{base_url}/api/chat", json=payload, headers=NGROK_HEADERS, timeout=TURN_TIMEOUT_SECONDS,
    )
    resp.raise_for_status()
    reply = json.loads(resp.json().get("message", {}).get("content", ""))
    if not isinstance(reply, dict):
        raise ValueError("reply is not a JSON object")
    return reply


async def _ask_text(base_url: str, model: str, messages: list[dict], max_tokens: int) -> str:
    """One model call answered in plain prose."""
    payload: dict = {
        "model": model,
        "messages": messages,
        "stream": False,
        "keep_alive": -1,
        "options": {"temperature": 0.9, "num_predict": max_tokens},
    }
    if await ollama_caps.can_think(base_url, model):
        payload["think"] = False
    resp = await ollama_http.client().post(
        f"{base_url}/api/chat", json=payload, headers=NGROK_HEADERS, timeout=TURN_TIMEOUT_SECONDS,
    )
    resp.raise_for_status()
    text = resp.json().get("message", {}).get("content", "")
    if not text.strip():
        raise ValueError("reply is empty")
    return text


def _ollama_refusal(e: httpx.HTTPStatusError, model: str) -> str:
    """What to tell the player when Ollama answered with an error, from its own explanation."""
    try:
        reason = str(e.response.json().get("error") or "")
    except Exception:
        reason = ""
    if "requires" in reason and "available" in reason:
        return f"{model} is too big for the model server's memory. Pick a smaller games model in Advanced settings."
    if "not found" in reason:
        return f"{model} is not installed on the model server."
    return f"The model server could not run {model}: {reason}" if reason else "The model server ran into an error. Try again."


async def _retrying(game_id: uuid.UUID, model: str, ask):
    """Run one model call, once more if its reply cannot be read. Raises a 502 the player can act on."""
    problem = "The model's reply could not be read. Try again."
    for attempt in range(2):
        try:
            return await ask()
        except httpx.TimeoutException:
            problem = "The model took too long to answer. Try again, or pick a faster model."
            break  # a second wait of the same length would not help
        except httpx.HTTPStatusError as e:
            # Reached, but it said no: say why, rather than blaming the connection
            problem = _ollama_refusal(e, model)
            logger.warning("game_turn_failed game_id=%s model=%s attempt=%s error=%s", game_id, model, attempt, str(e))
            if "memory" in problem:
                break  # it will not have more memory a moment from now
        except httpx.HTTPError as e:
            problem = "The model server could not be reached. Check that Ollama is running."
            logger.warning("game_turn_failed game_id=%s model=%s attempt=%s error=%s", game_id, model, attempt, str(e))
        except Exception as e:
            logger.warning("game_turn_unreadable game_id=%s model=%s attempt=%s error=%s", game_id, model, attempt, str(e))
    raise HTTPException(status_code=502, detail=problem)


async def _ask_with_retry(
    game_id: uuid.UUID, base_url: str, wanted: Optional[str], system: str, prompt: str, schema: dict,
    max_tokens: Optional[int] = None,
) -> dict:
    """The model's JSON reply to a turn, from the model asked for or the nearest one the server has."""
    model = await _pick_model(base_url, (wanted or _config.GAME_MODEL).strip())
    return await _retrying(game_id, model, lambda: _ask_json(base_url, model, system, prompt, schema, max_tokens))


async def _play_arena_turn(game: GameSession, user: User, db: AsyncSession) -> dict:
    """The next debater's speech. Each side speaks with its own model, whatever the request asked for."""
    state = game.state
    if arena.awaiting_question(state) is not None:
        raise HTTPException(status_code=409, detail="The debaters are waiting for your question")
    up = arena.next_up(state)
    if up is None:
        raise HTTPException(status_code=409, detail="This debate is over")
    game_id, turn_before = game.id, state["turn"]
    base_url = await effective_ollama_url(user)
    # The model can take a while; do not hold a pooled connection for it.
    await db.close()

    model = await _pick_model(base_url, state["sides"][up["side"]]["model"])
    text = await _retrying(
        game_id, model, lambda: _ask_text(base_url, model, arena.messages_for_model(state), arena.MAX_TOKENS),
    )
    try:
        new_state = arena.apply_speech(state, text, model)
    except ValueError:
        raise HTTPException(status_code=502, detail="The model's reply could not be read. Try again.")

    async with AsyncSessionLocal() as write_db:
        fresh = await write_db.execute(
            select(GameSession).where(GameSession.id == game_id, GameSession.user_id == user.id)
        )
        current = fresh.scalar_one_or_none()
        if not current:
            raise HTTPException(status_code=404, detail="Game not found")
        if current.state.get("turn") != turn_before:
            raise HTTPException(status_code=409, detail="This turn was already played. Reload the game.")
        await write_db.execute(update(GameSession).where(GameSession.id == game_id).values(state=new_state))
        await write_db.commit()
        await write_db.refresh(current)
        return _serialize(current)


async def _play_haggle_turn(game: GameSession, body: TurnRequest, user: User, db: AsyncSession) -> dict:
    state = game.state
    if state.get("status") != "active":
        raise HTTPException(status_code=409, detail="This haggle is over")
    message = " ".join(body.decision.split())
    # "Deal!" typed into the message box agrees to the price on the table. Paying is still the player's to do.
    rules = _haggle_rules(state)
    agreeing = body.offer is None and not body.bluff and not body.leverage and not body.sweetener and rules.is_acceptance(message)
    if state.get("final"):
        raise HTTPException(status_code=409, detail="That was their final offer. Take it or leave it.")
    bluff = body.bluff
    if bluff and not rules.can_bluff(state):
        raise HTTPException(status_code=409, detail="They have seen that move already.")
    leverage = body.leverage
    if leverage and (rules is not selling or not selling.can_leverage(state)):
        raise HTTPException(status_code=409, detail="Nobody else has made an offer.")
    sweet = body.sweetener
    if sweet and not rules.can_sweeten(state, sweet):
        raise HTTPException(status_code=409, detail="You have already offered that.")
    if sweet and not message:
        message = extras.sweetener(state.get("mode", "buy"), sweet)[1]
    if leverage:
        ping = state["ping"]
        message, offer = message or f"{ping['merchant']} just offered ${ping['offer']:,}. Can you beat that?", None
    elif bluff:
        message, offer = message or rules.BLUFF_MESSAGE, None
    elif agreeing:
        offer = state["ask"]
    elif body.offer is not None:
        offer = body.offer
    elif rules is selling:
        offer = selling.stated_price(message, state)
    else:
        offer = haggle.stated_offer(message, state["list_price"], state["scenario"]["item"], state["ask"])
    if not message and offer is not None:
        # The words the screen shows for a price sent on its own
        message = f"How about ${offer:,}?" if rules is haggle else f"I can do ${offer:,}."
    if not message:
        raise HTTPException(status_code=422, detail="Say something or make an offer")
    game_id, turn_before = game.id, state["turn"]
    base_url = await effective_ollama_url(user)
    # The model can take a while; do not hold a pooled connection for it.
    await db.close()

    extra = {"sweetener": sweet, **({"leverage": leverage} if rules is selling else {})}
    reply = await _ask_with_retry(
        game_id, base_url, body.model, rules.SYSTEM_PROMPT,
        rules.describe_for_model(state, message, offer, bluff, clean=body.clean, **extra), haggle.REPLY_SCHEMA,
    )
    new_state = rules.apply_turn(state, message, offer, reply, bluff, **extra)

    async with AsyncSessionLocal() as write_db:
        fresh = await write_db.execute(
            select(GameSession).where(GameSession.id == game_id, GameSession.user_id == user.id)
        )
        current = fresh.scalar_one_or_none()
        if not current:
            raise HTTPException(status_code=404, detail="Game not found")
        if current.state.get("turn") != turn_before or current.state.get("status") != "active":
            raise HTTPException(status_code=409, detail="This turn was already played. Reload the game.")
        await write_db.execute(update(GameSession).where(GameSession.id == game_id).values(state=new_state))
        score = _haggle_score(user, new_state)
        if score:
            write_db.add(score)
        await write_db.commit()
        await write_db.refresh(current)
        return _serialize(current)


@router.post("/{game_id}/turn")
@limiter.limit(CHAT_RATE_LIMIT)
async def play_turn(
    request: Request,
    game_id: uuid.UUID,
    body: TurnRequest,
    user: User = Depends(get_user),
    db: AsyncSession = Depends(get_db),
):
    game = await _owned_game(game_id, user, db)
    if game.game_type == haggle.GAME_TYPE:
        return await _play_haggle_turn(game, body, user, db)
    if game.game_type == arena.GAME_TYPE:
        return await _play_arena_turn(game, user, db)
    if game.game_type != ceo.GAME_TYPE:
        raise HTTPException(status_code=400, detail="Unknown game")
    state = ceo.upgrade(game.state)
    if state.get("status") != "active":
        raise HTTPException(status_code=409, detail="This game is over")
    if not state.get("staff"):
        raise HTTPException(status_code=422, detail="Hire at least one person before the first week.")

    action = None
    if body.action:
        try:
            action, decision = ceo.check_action(state, body.action.model_dump())
        except ValueError as e:
            raise HTTPException(status_code=422, detail=str(e))
    else:
        decision = " ".join(body.decision.split())
    if not decision:
        raise HTTPException(status_code=422, detail="Decision cannot be blank")
    base_url = await effective_ollama_url(user)
    turn_before = state["turn"]
    # The model can take a while; do not hold a pooled connection for it.
    await db.close()

    reply = await _ask_with_retry(
        game_id, base_url, body.model, ceo.SYSTEM_PROMPT, ceo.describe_for_model(state, decision), ceo.REPLY_SCHEMA,
    )

    new_state = ceo.apply_turn(state, decision, reply, action=action)

    async with AsyncSessionLocal() as write_db:
        fresh = await write_db.execute(
            select(GameSession).where(GameSession.id == game_id, GameSession.user_id == user.id)
        )
        current = fresh.scalar_one_or_none()
        if not current:
            raise HTTPException(status_code=404, detail="Game not found")
        # Two tabs playing the same week: the first one in wins.
        if current.state.get("turn") != turn_before:
            raise HTTPException(status_code=409, detail="This turn was already played. Reload the game.")
        # Before saving: a year just completed is scored here, and its flag comes off the state
        score = _score_for(user, new_state["company"]["name"], new_state)
        await write_db.execute(
            update(GameSession).where(GameSession.id == game_id)
            .values(state=new_state, title=new_state["company"]["name"][:80])
        )
        if score:
            write_db.add(score)
        await write_db.commit()
        await write_db.refresh(current)
        return _serialize(current)
