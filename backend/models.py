from datetime import datetime
from sqlalchemy import String, Text, ForeignKey, DateTime, Boolean, JSON, Integer, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func
from database import Base
from typing import Optional
import uuid


# ----- User Model -----

# Stores registered user accounts; owns zero or more chats
class User(Base):
    __tablename__ = "users"

    id:               Mapped[uuid.UUID]      = mapped_column(PG_UUID, primary_key=True, default=uuid.uuid4)
    email:            Mapped[str]            = mapped_column(String, unique=True, nullable=False)
    full_name:        Mapped[Optional[str]]  = mapped_column(String(120), nullable=False)
    password_hash:    Mapped[str]            = mapped_column(Text, nullable=False)
    theme:            Mapped[str]            = mapped_column(String(20), nullable=False, default="meadow", server_default="meadow")
    font:             Mapped[str]            = mapped_column(String(20), nullable=False, default="rounded", server_default="rounded")
    # The sidebar icon's color, as #rrggbb; NULL is the theme's own
    avatar_color:     Mapped[Optional[str]]  = mapped_column(String(7), nullable=True)
    personal_context: Mapped[Optional[str]]  = mapped_column(Text, nullable=True)
    # Optional per-user Ollama endpoint; NULL means use the shared server default
    ollama_url:       Mapped[Optional[str]]  = mapped_column(String(300), nullable=True)
    created_at:       Mapped[datetime]       = mapped_column(DateTime(timezone=True), server_default=func.now())
    # Cascade delete removes all chats when the user is deleted
    chats:            Mapped[list["Chat"]]   = relationship(back_populates="user", cascade="all, delete")

# ----- Chat Model -----

# Represents a single conversation thread belonging to a user
class Chat(Base):
    __tablename__ = "chats"

    id:         Mapped[uuid.UUID] = mapped_column(PG_UUID, primary_key=True, default=uuid.uuid4)
    user_id:    Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    title:      Mapped[str]       = mapped_column(Text, default="New Chat")
    created_at: Mapped[datetime]  = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime]  = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    user:       Mapped["User"]          = relationship(back_populates="chats")
    # Cascade delete removes all messages when the chat is deleted
    messages:   Mapped[list["Message"]] = relationship(
        back_populates="chat",
        cascade="all, delete",
        order_by="Message.created_at",
    )

# ----- Refresh Token Model -----

# Persisted refresh tokens; each login/register issues one, rotation creates a new one
class RefreshToken(Base):
    __tablename__ = "refresh_tokens"

    id:         Mapped[uuid.UUID] = mapped_column(PG_UUID, primary_key=True, default=uuid.uuid4)
    user_id:    Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    token_hash: Mapped[str]       = mapped_column(String(64), unique=True, nullable=False, index=True)
    expires_at: Mapped[datetime]  = mapped_column(DateTime(timezone=True), nullable=False)
    revoked:    Mapped[bool]      = mapped_column(Boolean, default=False)
    # Set when the token is rotated. A token presented shortly after its own rotation is
    # treated as a lost race (two tabs refreshing at once), not a replay, and still works.
    revoked_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime]  = mapped_column(DateTime(timezone=True), server_default=func.now())

# ----- Message Model -----

# A single turn in a chat; role is either "user" or "assistant"
class Message(Base):
    __tablename__ = "messages"

    id:             Mapped[uuid.UUID]        = mapped_column(PG_UUID, primary_key=True, default=uuid.uuid4)
    chat_id:        Mapped[uuid.UUID]        = mapped_column(ForeignKey("chats.id"), nullable=False, index=True)
    role:           Mapped[str]              = mapped_column(String(20), nullable=False)
    content:        Mapped[str]              = mapped_column(Text, nullable=False)
    images:         Mapped[Optional[list]]   = mapped_column(JSON, nullable=True)
    image_context:  Mapped[Optional[str]]    = mapped_column(Text, nullable=True)
    search_context: Mapped[Optional[str]]    = mapped_column(Text, nullable=True)
    # Which model wrote an assistant message; NULL for user turns and older rows
    model:          Mapped[Optional[str]]    = mapped_column(String(100), nullable=True)
    # Cards shown above an assistant reply, such as a clock: [{"kind": "clock", ...}]
    widgets:        Mapped[Optional[list]]   = mapped_column(JSON, nullable=True)
    # What a project turn changed, shown under the reply:
    # {"version": 3, "files": [{"action": "edited", "path": "style.css"}], "note": "..."}
    project_changes: Mapped[Optional[dict]]  = mapped_column(JSON, nullable=True)
    created_at:     Mapped[datetime]         = mapped_column(DateTime(timezone=True), server_default=func.now())
    chat:           Mapped["Chat"]           = relationship(back_populates="messages")

# ----- Game Model -----

# One saved playthrough of a chat game. The whole game state lives in `state`;
# its shape belongs to the game's engine (see games/), not to the database.
class GameSession(Base):
    __tablename__ = "game_sessions"

    id:         Mapped[uuid.UUID] = mapped_column(PG_UUID, primary_key=True, default=uuid.uuid4)
    user_id:    Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    game_type:  Mapped[str]       = mapped_column(String(40), nullable=False)
    title:      Mapped[str]       = mapped_column(String(80), nullable=False)
    state:      Mapped[dict]      = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime]  = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime]  = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

# One finished run of a game. Kept apart from the save so the score survives
# the save being deleted, and so free play after the end cannot change it.
class GameScore(Base):
    __tablename__ = "game_scores"

    id:         Mapped[uuid.UUID] = mapped_column(PG_UUID, primary_key=True, default=uuid.uuid4)
    user_id:    Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    game_type:  Mapped[str]       = mapped_column(String(40), nullable=False)
    title:      Mapped[str]       = mapped_column(String(80), nullable=False)
    score:      Mapped[int]       = mapped_column(Integer, nullable=False)
    # Whatever else the game wants shown beside the score (rating, how it ended)
    detail:     Mapped[dict]      = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime]  = mapped_column(DateTime(timezone=True), server_default=func.now())

# ----- Document Models -----

class Document(Base):
    __tablename__ = "documents"

    id:         Mapped[uuid.UUID] = mapped_column(PG_UUID, primary_key=True, default=uuid.uuid4)
    user_id:    Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    chat_id:    Mapped[uuid.UUID] = mapped_column(ForeignKey("chats.id", ondelete="CASCADE"), nullable=False, index=True)
    filename:   Mapped[str]       = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime]  = mapped_column(DateTime(timezone=True), server_default=func.now())
    chunks:     Mapped[list["DocumentChunk"]] = relationship(back_populates="document", cascade="all, delete")


class DocumentChunk(Base):
    __tablename__ = "document_chunks"

    id:          Mapped[uuid.UUID] = mapped_column(PG_UUID, primary_key=True, default=uuid.uuid4)
    document_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"), nullable=False, index=True)
    chat_id:     Mapped[uuid.UUID] = mapped_column(ForeignKey("chats.id", ondelete="CASCADE"), nullable=False, index=True)
    chunk_index: Mapped[int]       = mapped_column(Integer, nullable=False)
    content:     Mapped[str]       = mapped_column(Text, nullable=False)
    embedding:   Mapped[list]      = mapped_column(JSON, nullable=False)
    document:    Mapped["Document"] = relationship(back_populates="chunks")


# ----- Web Studio Models -----

# A small website built by chatting. One per chat: the chat is its conversation.
class Project(Base):
    __tablename__ = "projects"

    id:              Mapped[uuid.UUID] = mapped_column(PG_UUID, primary_key=True, default=uuid.uuid4)
    chat_id:         Mapped[uuid.UUID] = mapped_column(ForeignKey("chats.id", ondelete="CASCADE"), nullable=False, unique=True)
    name:            Mapped[str]       = mapped_column(String(80), nullable=False)
    # 0 until the first turn that changes a file
    current_version: Mapped[int]       = mapped_column(Integer, nullable=False, default=0, server_default="0")
    # The planner's spec: features, files and shared names every later turn follows
    spec:            Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at:      Mapped[datetime]  = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at:      Mapped[datetime]  = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


# A runtime check the stream is waiting on: the chat loads the new files in a hidden preview
# and fills in the errors it saw (see project_checks.py). Deleted once read.
class ProjectCheck(Base):
    __tablename__ = "project_checks"

    id:         Mapped[uuid.UUID]      = mapped_column(PG_UUID, primary_key=True, default=uuid.uuid4)
    chat_id:    Mapped[uuid.UUID]      = mapped_column(ForeignKey("chats.id", ondelete="CASCADE"), nullable=False, index=True)
    # Null until the browser answers
    errors:     Mapped[Optional[list]] = mapped_column(JSON(none_as_null=True), nullable=True)
    created_at: Mapped[datetime]       = mapped_column(DateTime(timezone=True), server_default=func.now())


# The project's files as they are now
class ProjectFile(Base):
    __tablename__ = "project_files"
    __table_args__ = (UniqueConstraint("project_id", "path", name="uq_project_files_path"),)

    id:         Mapped[uuid.UUID] = mapped_column(PG_UUID, primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    path:       Mapped[str]       = mapped_column(String(200), nullable=False)
    contents:   Mapped[str]       = mapped_column(Text, nullable=False)


# Every file as it was after one turn. Small sites are a few kilobytes, so a full
# snapshot per version is cheap and makes restoring one a plain copy.
class ProjectVersion(Base):
    __tablename__ = "project_versions"
    __table_args__ = (UniqueConstraint("project_id", "version", name="uq_project_versions_version"),)

    id:         Mapped[uuid.UUID]           = mapped_column(PG_UUID, primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID]           = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    version:    Mapped[int]                 = mapped_column(Integer, nullable=False)
    # {path: contents}
    files:      Mapped[dict]                = mapped_column(JSON, nullable=False)
    # The assistant reply that made it
    message_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("messages.id", ondelete="SET NULL"), nullable=True)
    # Set when the user restored an older version, which copies it as a new one
    restored_from: Mapped[Optional[int]]    = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime]            = mapped_column(DateTime(timezone=True), server_default=func.now())
