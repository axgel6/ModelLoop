from pydantic import AfterValidator, BaseModel, EmailStr, Field, StringConstraints
from typing import Annotated, Optional
import uuid
from config import MAX_PROMPT_LENGTH, MAX_SYSTEM_PROMPT_LENGTH, MAX_TITLE_LENGTH, MAX_GUEST_HISTORY, MODEL_NAME_PATTERN


# Trimmed before the length check, so a name of only spaces is rejected
FullName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]


# Stored lowercased, so "Ana" and "ana" are the same account. The pattern is checked
# before lowercasing, so it has to accept capitals too.
Username = Annotated[str, StringConstraints(strip_whitespace=True, to_lower=True, pattern=r"^[A-Za-z0-9_]{3,30}$")]


# Stored lowercased, so sign-in and the taken check need not care about case
Email = Annotated[EmailStr, AfterValidator(str.lower)]


class RegisterRequest(BaseModel):
    username:  Username
    email:     Optional[Email] = Field(default=None, max_length=254)
    password:  str                = Field(..., min_length=8, max_length=128)
    # users.full_name is NOT NULL, so registering needs one
    full_name: FullName


class UpdateProfileRequest(BaseModel):
    full_name: FullName


class UpdatePreferencesRequest(BaseModel):
    theme: Optional[str] = Field(default=None, pattern=r"^(ember|frost|dune|meadow|halloween|christmas)$")
    font:  Optional[str] = Field(default=None, pattern=r"^(inter|rounded)$")
    # A color as #rrggbb, or "" to go back to the theme's own
    avatar_color: Optional[str] = Field(default=None, pattern=r"^(#[0-9a-fA-F]{6})?$")


class UpdatePersonalContextRequest(BaseModel):
    personal_context: Optional[str] = Field(default=None, max_length=1000)


class LoginRequest(BaseModel):
    # A username, or the email on the account
    identifier: str = Field(..., min_length=1, max_length=254)
    password:   str = Field(..., max_length=128)


class UpdateEmailRequest(BaseModel):
    # null removes it
    email: Optional[Email] = Field(default=None, max_length=254)


# "system" role excluded to prevent prompt injection via guest history
class GuestMessage(BaseModel):
    role:    str = Field(..., pattern=r"^(user|assistant)$")
    content: str = Field(..., max_length=MAX_PROMPT_LENGTH)


class ChatRequest(BaseModel):
    prompt:        str                 = Field(..., min_length=1, max_length=MAX_PROMPT_LENGTH)
    chat_id:       uuid.UUID           = Field(...)
    model:         Optional[str]       = Field(default=None, max_length=100, pattern=MODEL_NAME_PATTERN)
    system_prompt: Optional[str]       = Field(default=None, max_length=MAX_SYSTEM_PROMPT_LENGTH)
    temperature:   Optional[float]     = Field(default=0.7, ge=0.0, le=2.0)
    top_p:         Optional[float]     = Field(default=0.9, ge=0.0, le=1.0)
    num_predict:   Optional[int]       = Field(default=-1, ge=-1, le=32768)
    images:        Optional[list[str]] = Field(default=None, max_length=4)
    force_search:  Optional[bool]      = Field(default=False)
    # Reason before answering, for models that can. Ignored by the rest.
    think:         Optional[bool]      = Field(default=False)
    # The festive theme in use (frontend/src/festive.ts): Olly's default prompt gets its voice
    festive:       Optional[str]       = Field(default=None, max_length=32, pattern=r"^[a-z-]+$")
    # Start a web studio project in this chat. A chat with a project stays in project mode.
    project:       Optional[bool]      = Field(default=False)
    # The model project turns use, from Preferences. Empty means pick one (see webdev/mode.py choose_model).
    project_model: Optional[str]       = Field(default=None, max_length=100)


class GuestChatRequest(BaseModel):
    prompt:        str                  = Field(..., min_length=1, max_length=MAX_PROMPT_LENGTH)
    messages:      list[GuestMessage]   = Field(default=[], max_length=MAX_GUEST_HISTORY)
    model:         Optional[str]        = Field(default=None, max_length=100, pattern=MODEL_NAME_PATTERN)
    system_prompt: Optional[str]        = Field(default=None, max_length=MAX_SYSTEM_PROMPT_LENGTH)
    temperature:   Optional[float]      = Field(default=0.7, ge=0.0, le=2.0)
    top_p:         Optional[float]      = Field(default=0.9, ge=0.0, le=1.0)
    num_predict:   Optional[int]        = Field(default=-1, ge=-1, le=32768)
    images:        Optional[list[str]]  = Field(default=None, max_length=4)
    think:         Optional[bool]       = Field(default=False)
    festive:       Optional[str]        = Field(default=None, max_length=32, pattern=r"^[a-z-]+$")


# A signed-in user's private chat: nothing is stored, so the browser sends the
# history like a guest does, and only the latest messages are kept.
class PrivateChatRequest(BaseModel):
    prompt:        str                  = Field(..., min_length=1, max_length=MAX_PROMPT_LENGTH)
    messages:      list[GuestMessage]   = Field(default=[], max_length=MAX_GUEST_HISTORY)
    model:         Optional[str]        = Field(default=None, max_length=100, pattern=MODEL_NAME_PATTERN)
    system_prompt: Optional[str]        = Field(default=None, max_length=MAX_SYSTEM_PROMPT_LENGTH)
    temperature:   Optional[float]      = Field(default=0.7, ge=0.0, le=2.0)
    top_p:         Optional[float]      = Field(default=0.9, ge=0.0, le=1.0)
    num_predict:   Optional[int]        = Field(default=-1, ge=-1, le=32768)
    images:        Optional[list[str]]  = Field(default=None, max_length=4)
    force_search:  Optional[bool]       = Field(default=False)
    think:         Optional[bool]       = Field(default=False)
    festive:       Optional[str]        = Field(default=None, max_length=32, pattern=r"^[a-z-]+$")


class RenameChatRequest(BaseModel):
    title: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=MAX_TITLE_LENGTH)]


class UpdateOllamaUrlRequest(BaseModel):
    # null or empty clears the override and falls back to the shared server
    ollama_url: Optional[str] = Field(default=None, max_length=300)


class RefreshRequest(BaseModel):
    refresh_token: str = Field(..., min_length=1, max_length=256)


class LogoutRequest(BaseModel):
    refresh_token: str = Field(..., min_length=1, max_length=256)
