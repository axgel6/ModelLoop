from sqlalchemy import String, Text, ForeignKey, DateTime
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func
from database import Base
import uuid

# ----- User Model -----

# Stores registered user accounts; owns zero or more chats
class User(Base):
    __tablename__ = "users"

    id:            Mapped[uuid.UUID] = mapped_column(PG_UUID, primary_key=True, default=uuid.uuid4)
    email:         Mapped[str]       = mapped_column(String, unique=True, nullable=False)
    password_hash: Mapped[str]       = mapped_column(Text, nullable=False)
    created_at:    Mapped[DateTime]  = mapped_column(DateTime(timezone=True), server_default=func.now())
    # Cascade delete removes all chats when the user is deleted
    chats:         Mapped[list["Chat"]] = relationship(back_populates="user", cascade="all, delete")

# ----- Chat Model -----

# Represents a single conversation thread belonging to a user
class Chat(Base):
    __tablename__ = "chats"

    id:         Mapped[uuid.UUID] = mapped_column(PG_UUID, primary_key=True, default=uuid.uuid4)
    user_id:    Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    title:      Mapped[str]       = mapped_column(Text, default="New Chat")
    created_at: Mapped[DateTime]  = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[DateTime]  = mapped_column(DateTime(timezone=True), server_default=func.now())
    user:       Mapped["User"]          = relationship(back_populates="chats")
    # Cascade delete removes all messages when the chat is deleted
    messages:   Mapped[list["Message"]] = relationship(
        back_populates="chat",
        cascade="all, delete",
        order_by="Message.created_at",
    )

# ----- Message Model -----

# A single turn in a chat; role is either "user" or "assistant"
class Message(Base):
    __tablename__ = "messages"

    id:         Mapped[uuid.UUID] = mapped_column(PG_UUID, primary_key=True, default=uuid.uuid4)
    chat_id:    Mapped[uuid.UUID] = mapped_column(ForeignKey("chats.id"), nullable=False)
    role:       Mapped[str]       = mapped_column(String(20), nullable=False)
    content:    Mapped[str]       = mapped_column(Text, nullable=False)
    created_at: Mapped[DateTime]  = mapped_column(DateTime(timezone=True), server_default=func.now())
    chat:       Mapped["Chat"]    = relationship(back_populates="messages")
