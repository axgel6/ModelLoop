import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import Chat, Message, Project, ProjectFile, ProjectVersion
from dependencies import get_user_id
import project_mode

router = APIRouter(prefix="/api/v1/chats", tags=["projects"])


async def _owned_project(db: AsyncSession, chat_id: uuid.UUID, user_id: str) -> Project:
    owned = await db.execute(select(Chat.id).where(Chat.id == chat_id, Chat.user_id == user_id))
    if owned.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="Chat not found")
    project = (await db.execute(select(Project).where(Project.chat_id == chat_id))).scalar_one_or_none()
    if project is None:
        raise HTTPException(status_code=404, detail="This chat has no project")
    return project


def _label(text: str) -> str:
    """A version's name in the picker: the request that made it, on one short line."""
    line = " ".join(text.split())
    return line if len(line) <= 70 else line[:67].rstrip() + "..."


@router.get("/{chat_id}/project")
async def get_project(
    chat_id: uuid.UUID,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    """The chat's web studio project: its files as they are now, and its versions (without their files)."""
    project = await _owned_project(db, chat_id, user_id)
    files = await db.execute(
        select(ProjectFile.path, ProjectFile.contents)
        .where(ProjectFile.project_id == project.id)
        .order_by(ProjectFile.path)
    )
    versions = (await db.execute(
        select(ProjectVersion.version, ProjectVersion.message_id, ProjectVersion.restored_from, ProjectVersion.created_at)
        .where(ProjectVersion.project_id == project.id)
        .order_by(ProjectVersion.version.desc())
    )).all()

    # A turn's two messages are written in one transaction, so the request shares its reply's
    # created_at. That pairs each version with what the user asked for.
    reply_ids = [m for _, m, _, _ in versions if m]
    asked: dict = {}
    if reply_ids:
        replies = (await db.execute(
            select(Message.id, Message.created_at).where(Message.id.in_(reply_ids))
        )).all()
        made_at = {mid: at for mid, at in replies}
        requests = (await db.execute(
            select(Message.created_at, Message.content)
            .where(Message.chat_id == chat_id, Message.role == "user", Message.created_at.in_(list(made_at.values())))
        )).all()
        by_time = {at: content for at, content in requests}
        asked = {mid: by_time.get(at) for mid, at in made_at.items()}

    return {
        "id": str(project.id),
        "name": project.name,
        "version": project.current_version,
        "files": [{"path": p, "content": c} for p, c in files.all()],
        "versions": [
            {
                "version": v,
                "label": f"Restored v{restored}" if restored else _label(asked.get(m) or "") or f"Version {v}",
                "restored_from": restored,
                "created_at": at.isoformat(),
            }
            for v, m, restored, at in versions
        ],
    }


@router.get("/{chat_id}/project/versions/{version}")
async def get_project_version(
    chat_id: uuid.UUID,
    version: int,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Every file as it was in one version, for viewing it in the studio."""
    project = await _owned_project(db, chat_id, user_id)
    files = (await db.execute(
        select(ProjectVersion.files)
        .where(ProjectVersion.project_id == project.id, ProjectVersion.version == version)
    )).scalar_one_or_none()
    if files is None:
        raise HTTPException(status_code=404, detail="No such version")
    return {"version": version, "files": [{"path": p, "content": c} for p, c in sorted(files.items())]}


@router.post("/{chat_id}/project/versions/{version}/restore")
async def restore_project_version(
    chat_id: uuid.UUID,
    version: int,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Makes an older version the project's files again. It is saved as a new version,
    so the versions after it stay in the history and the restore can be undone the same way."""
    project = await _owned_project(db, chat_id, user_id)
    if version == project.current_version:
        raise HTTPException(status_code=400, detail="That is already the latest version")
    files = (await db.execute(
        select(ProjectVersion.files)
        .where(ProjectVersion.project_id == project.id, ProjectVersion.version == version)
    )).scalar_one_or_none()
    if files is None:
        raise HTTPException(status_code=404, detail="No such version")

    new_version = project.current_version + 1
    await project_mode.write_version(db, project.id, new_version, files, restored_from=version)
    await db.commit()
    return {"version": new_version}
