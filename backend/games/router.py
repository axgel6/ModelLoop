"""HTTP API for chat games: saved sessions, and playing a turn."""
import json
import logging
import uuid
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

import config as _config
import ollama_http
from config import CHAT_RATE_LIMIT, MODEL_NAME_PATTERN, NGROK_HEADERS, THINKING_MODELS
from database import get_db, AsyncSessionLocal
from dependencies import get_user
from games.ceo_simulator import engine as ceo
from games.model_arena import engine as arena
from games.negotiation import engine as haggle
from models import GameScore, GameSession, User
from ollama_target import effective_ollama_url
from rate_limit import limiter

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/games", tags=["games"])

MAX_SAVES_PER_GAME = 20
TURN_TIMEOUT_SECONDS = 180


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


class NewNegotiation(BaseModel):
    """Leave the scenario out to be dealt one at random."""
    scenario:   Optional[str] = Field(default=None, max_length=20)
    difficulty: str           = Field(default="normal", pattern="^(easy|normal|hard)$")


class ArenaSide(BaseModel):
    model:     str = Field(..., max_length=100, pattern=MODEL_NAME_PATTERN)
    # The character's name, and the system prompt that makes the model play it
    character: str = Field(default="", max_length=40)
    prompt:    str = Field(default="", max_length=4000)


class NewArena(BaseModel):
    """The first side argues for the topic, the second against."""
    topic: str             = Field(..., min_length=3, max_length=200)
    sides: list[ArenaSide] = Field(..., min_length=2, max_length=2)


class Verdict(BaseModel):
    winner: int = Field(..., ge=0, le=1)


class TurnRequest(BaseModel):
    decision: str                  = Field(default="", max_length=400)
    action:   Optional[TurnAction] = None
    # Negotiation only: the price the player puts on the table with their message
    offer:    Optional[int]        = Field(default=None, gt=0, le=10_000_000)
    model:    Optional[str]        = Field(default=None, max_length=100, pattern=MODEL_NAME_PATTERN)


# How a game shows its state to the player, in full and in a save list. Games not listed use the CEO shapes.
_VIEWS = {
    haggle.GAME_TYPE: (haggle.public, haggle.summary),
    arena.GAME_TYPE:  (arena.public, arena.summary),
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
    """A score row for a run that has just ended, or None if there is nothing to record.

    Free play has an official result already and never adds another.
    """
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


@router.get("/scores")
async def best_scores(
    game_type: str = ceo.GAME_TYPE,
    user: User = Depends(get_user),
    db: AsyncSession = Depends(get_db),
):
    """The caller's ten best finished runs."""
    result = await db.execute(
        select(GameScore)
        .where(GameScore.user_id == user.id, GameScore.game_type == game_type)
        .order_by(GameScore.score.desc(), GameScore.created_at.asc())
        .limit(10)
    )
    return {"scores": [
        {"id": str(row.id), "title": row.title, "score": row.score, "created_at": row.created_at, **row.detail}
        for row in result.scalars().all()
    ]}


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
    """Start a haggle. Only one is kept at a time: a new one replaces the last."""
    await db.execute(
        delete(GameSession).where(GameSession.user_id == user.id, GameSession.game_type == haggle.GAME_TYPE)
    )
    state = haggle.new_game(body.scenario, body.difficulty)
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
    ])
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


def _haggle_score(user: User, state: dict) -> Optional[GameScore]:
    """A score row for a haggle that ended in a deal. Walking away records nothing."""
    result = state.get("result") or {}
    if result.get("outcome") != "deal":
        return None
    return GameScore(
        user_id=user.id, game_type=haggle.GAME_TYPE, title=state["scenario"]["item"][:80], score=int(result["score"]),
        detail={
            **{k: result.get(k) for k in ("outcome", "rating", "paid", "rounds")},
            "list_price": state["list_price"],
            "merchant": state["scenario"]["merchant"],
            "difficulty": state.get("difficulty", "normal"),
        },
    )


async def _end_haggle(game_id: uuid.UUID, user: User, db: AsyncSession, move) -> dict:
    game = await _owned_game(game_id, user, db)
    if game.game_type != haggle.GAME_TYPE:
        raise HTTPException(status_code=400, detail="Unknown game")
    try:
        game.state = move(game.state)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    score = _haggle_score(user, game.state)
    if score:
        db.add(score)
    await db.commit()
    await db.refresh(game)
    return _serialize(game)


@router.patch("/{game_id}/accept")
async def accept_price(
    game_id: uuid.UUID,
    user: User = Depends(get_user),
    db: AsyncSession = Depends(get_db),
):
    """Buy at the merchant's current price. Instant: no turn, no model call."""
    return await _end_haggle(game_id, user, db, haggle.accept)


@router.patch("/{game_id}/walk")
async def walk_away(
    game_id: uuid.UUID,
    user: User = Depends(get_user),
    db: AsyncSession = Depends(get_db),
):
    """Leave without buying. Instant: no turn, no model call."""
    return await _end_haggle(game_id, user, db, haggle.walk_away)


async def _pick_model(base_url: str, wanted: str) -> str:
    """The model to narrate with: the one asked for if the server has it, else one it does have.

    The model picker can hold a name the current Ollama server does not carry (a
    preset, or a choice made against another server), and Ollama answers that with a 404.
    """
    try:
        resp = await ollama_http.client().get(f"{base_url}/api/tags", headers=NGROK_HEADERS, timeout=10)
        resp.raise_for_status()
        available = [m.get("name") for m in resp.json().get("models", []) if m.get("name")]
    except Exception as e:
        logger.warning("game_model_list_failed error=%s", str(e))
        return wanted  # cannot check: try what was asked for
    if not available:
        raise HTTPException(status_code=502, detail="The model server has no models installed.")
    if wanted in available:
        return wanted
    if _config.DEFAULT_MODEL in available:
        return _config.DEFAULT_MODEL
    # Reasoning models are slow and add nothing to a JSON turn; prefer any other.
    plain = [m for m in available if not any(p in m.lower() for p in THINKING_MODELS)]
    return (plain or available)[0]


async def _ask_json(base_url: str, model: str, system: str, prompt: str, schema: dict) -> dict:
    """One model call that must come back as a JSON object matching `schema`."""
    payload: dict = {
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": prompt},
        ],
        "stream": False,
        "keep_alive": -1,
        "format": schema,
        "options": {"temperature": 0.8},
    }
    if any(p in model.lower() for p in THINKING_MODELS):
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
    if any(p in model.lower() for p in THINKING_MODELS):
        payload["think"] = False
    resp = await ollama_http.client().post(
        f"{base_url}/api/chat", json=payload, headers=NGROK_HEADERS, timeout=TURN_TIMEOUT_SECONDS,
    )
    resp.raise_for_status()
    text = resp.json().get("message", {}).get("content", "")
    if not text.strip():
        raise ValueError("reply is empty")
    return text


async def _retrying(game_id: uuid.UUID, model: str, ask):
    """Run one model call, once more if its reply cannot be read. Raises a 502 the player can act on."""
    problem = "The model's reply could not be read. Try again."
    for attempt in range(2):
        try:
            return await ask()
        except httpx.TimeoutException:
            problem = "The model took too long to answer. Try again, or pick a faster model."
            break  # a second wait of the same length would not help
        except httpx.HTTPError as e:
            problem = "The model server could not be reached. Check that Ollama is running."
            logger.warning("game_turn_failed game_id=%s model=%s attempt=%s error=%s", game_id, model, attempt, str(e))
        except Exception as e:
            logger.warning("game_turn_unreadable game_id=%s model=%s attempt=%s error=%s", game_id, model, attempt, str(e))
    raise HTTPException(status_code=502, detail=problem)


async def _ask_with_retry(
    game_id: uuid.UUID, base_url: str, wanted: Optional[str], system: str, prompt: str, schema: dict,
) -> dict:
    """The model's JSON reply to a turn, from the model asked for or the nearest one the server has."""
    model = await _pick_model(base_url, (wanted or _config.DEFAULT_MODEL).strip())
    return await _retrying(game_id, model, lambda: _ask_json(base_url, model, system, prompt, schema))


async def _play_arena_turn(game: GameSession, user: User, db: AsyncSession) -> dict:
    """The next debater's speech. Each side speaks with its own model, whatever the request asked for."""
    state = game.state
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
    if state.get("final"):
        raise HTTPException(status_code=409, detail="That was their final price. Take it or walk away.")
    message = " ".join(body.decision.split())
    offer = body.offer if body.offer is not None else haggle.stated_offer(message)
    if not message and offer is not None:
        message = f"How about ${offer:,}?"
    if not message:
        raise HTTPException(status_code=422, detail="Say something or make an offer")
    game_id, turn_before = game.id, state["turn"]
    base_url = await effective_ollama_url(user)
    # The model can take a while; do not hold a pooled connection for it.
    await db.close()

    reply = await _ask_with_retry(
        game_id, base_url, body.model, haggle.SYSTEM_PROMPT,
        haggle.describe_for_model(state, message, offer), haggle.REPLY_SCHEMA,
    )
    new_state = haggle.apply_turn(state, message, offer, reply)

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
        await write_db.execute(
            update(GameSession).where(GameSession.id == game_id)
            .values(state=new_state, title=new_state["company"]["name"][:80])
        )
        score = _score_for(user, new_state["company"]["name"], new_state)
        if score:
            write_db.add(score)
        await write_db.commit()
        await write_db.refresh(current)
        return _serialize(current)
