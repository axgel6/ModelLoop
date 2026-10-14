"""HTTP API for chat games: saved sessions, and playing a turn."""
import json
import logging
import uuid
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

import config as _config
import ollama_http
from config import CHAT_RATE_LIMIT, MODEL_NAME_PATTERN, NGROK_HEADERS, THINKING_MODELS
from database import get_db, AsyncSessionLocal
from dependencies import get_user
from games.ceo_simulator import engine as ceo
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


class TurnRequest(BaseModel):
    decision: str                  = Field(default="", max_length=400)
    action:   Optional[TurnAction] = None
    model:    Optional[str]        = Field(default=None, max_length=100, pattern=MODEL_NAME_PATTERN)


def _serialize(game: GameSession, with_state: bool = True) -> dict:
    out = {
        "id":         str(game.id),
        "game_type":  game.game_type,
        "title":      game.title,
        "created_at": game.created_at,
        "updated_at": game.updated_at,
    }
    if with_state:
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


async def _ask_game_master(base_url: str, model: str, state: dict, decision: str) -> dict:
    payload: dict = {
        "model": model,
        "messages": [
            {"role": "system", "content": ceo.SYSTEM_PROMPT},
            {"role": "user", "content": ceo.describe_for_model(state, decision)},
        ],
        "stream": False,
        "keep_alive": -1,
        "format": ceo.REPLY_SCHEMA,
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

    model = await _pick_model(base_url, (body.model or _config.DEFAULT_MODEL).strip())
    reply = None
    problem = "The model's reply could not be read. Try again."
    for attempt in range(2):
        try:
            reply = await _ask_game_master(base_url, model, state, decision)
            break
        except httpx.TimeoutException:
            problem = "The model took too long to answer. Try again, or pick a faster model."
            break  # a second wait of the same length would not help
        except httpx.HTTPError as e:
            problem = "The model server could not be reached. Check that Ollama is running."
            logger.warning("game_turn_failed game_id=%s model=%s attempt=%s error=%s", game_id, model, attempt, str(e))
        except Exception as e:
            logger.warning("game_turn_unreadable game_id=%s model=%s attempt=%s error=%s", game_id, model, attempt, str(e))
    if reply is None:
        raise HTTPException(status_code=502, detail=problem)

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
