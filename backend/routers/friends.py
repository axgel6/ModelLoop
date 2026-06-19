import logging
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, or_, and_
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import User, Friendship
from auth import get_current_user_id
from schemas import FriendRequestBody

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/friends", tags=["friends"])


def _friendship_user_view(friendship: Friendship, viewer_id: str) -> dict:
    """Return the other user's public info from the friendship row."""
    is_requester = str(friendship.requester_id) == viewer_id
    other = friendship.addressee if is_requester else friendship.requester
    return {
        "friendship_id": str(friendship.id),
        "status": friendship.status,
        "direction": "outgoing" if is_requester else "incoming",
        "user": {
            "id": str(other.id),
            "username": other.username,
            "full_name": other.full_name,
        },
    }


@router.get("")
async def list_friends(
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Return all accepted friends."""
    result = await db.execute(
        select(Friendship)
        .options(selectinload(Friendship.requester), selectinload(Friendship.addressee))
        .where(
            and_(
                Friendship.status == "accepted",
                or_(
                    Friendship.requester_id == user_id,
                    Friendship.addressee_id == user_id,
                ),
            )
        )
    )
    rows = result.scalars().all()
    return {"friends": [_friendship_user_view(row, user_id) for row in rows]}


@router.get("/requests")
async def list_requests(
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Return all pending friend requests (incoming and outgoing)."""
    result = await db.execute(
        select(Friendship)
        .options(selectinload(Friendship.requester), selectinload(Friendship.addressee))
        .where(
            and_(
                Friendship.status == "pending",
                or_(
                    Friendship.requester_id == user_id,
                    Friendship.addressee_id == user_id,
                ),
            )
        )
    )
    rows = result.scalars().all()
    return {"requests": [_friendship_user_view(row, user_id) for row in rows]}


@router.post("/request", status_code=201)
async def send_friend_request(
    body: FriendRequestBody,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Send a friend request to another user by username."""
    target_result = await db.execute(select(User).where(User.username == body.username))
    target = target_result.scalar_one_or_none()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if str(target.id) == user_id:
        raise HTTPException(status_code=400, detail="Cannot add yourself")

    # Check that our own user has a username set
    me_result = await db.execute(select(User).where(User.id == user_id))
    me = me_result.scalar_one_or_none()
    if not me or not me.username:
        raise HTTPException(status_code=400, detail="Set a username before adding friends")

    existing = await db.execute(
        select(Friendship).where(
            or_(
                and_(Friendship.requester_id == user_id, Friendship.addressee_id == str(target.id)),
                and_(Friendship.requester_id == str(target.id), Friendship.addressee_id == user_id),
            )
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Friend request already exists")

    friendship = Friendship(requester_id=user_id, addressee_id=str(target.id))
    db.add(friendship)
    await db.commit()
    await db.refresh(friendship)
    return {
        "friendship_id": str(friendship.id),
        "status": friendship.status,
        "addressee": {"id": str(target.id), "username": target.username, "full_name": target.full_name},
    }


@router.patch("/{friendship_id}/accept")
async def accept_friend_request(
    friendship_id: str,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Accept a pending incoming friend request."""
    result = await db.execute(select(Friendship).where(Friendship.id == friendship_id))
    friendship = result.scalar_one_or_none()
    if not friendship:
        raise HTTPException(status_code=404, detail="Friend request not found")
    if str(friendship.addressee_id) != user_id:
        raise HTTPException(status_code=403, detail="Not authorized")
    if friendship.status != "pending":
        raise HTTPException(status_code=400, detail="Request is not pending")
    friendship.status = "accepted"
    await db.commit()
    return {"friendship_id": str(friendship.id), "status": friendship.status}


@router.delete("/{friendship_id}", status_code=204)
async def remove_friend(
    friendship_id: str,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Decline a pending request or remove an accepted friend."""
    result = await db.execute(select(Friendship).where(Friendship.id == friendship_id))
    friendship = result.scalar_one_or_none()
    if not friendship:
        raise HTTPException(status_code=404, detail="Friendship not found")
    if str(friendship.requester_id) != user_id and str(friendship.addressee_id) != user_id:
        raise HTTPException(status_code=403, detail="Not authorized")
    await db.delete(friendship)
    await db.commit()
