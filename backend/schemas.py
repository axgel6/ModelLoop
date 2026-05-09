from pydantic import BaseModel, EmailStr, Field
from typing import Optional
from config import MAX_PROMPT_LENGTH, MAX_SYSTEM_PROMPT_LENGTH, MAX_TITLE_LENGTH, MAX_GUEST_HISTORY, MODEL_NAME_PATTERN


class RegisterRequest(BaseModel):
    email:     EmailStr        = Field(..., max_length=254)
    password:  str             = Field(..., min_length=8, max_length=128)
    full_name: Optional[str]   = Field(default=None, max_length=120)


class UpdateProfileRequest(BaseModel):
    full_name: str = Field(..., min_length=1, max_length=120)


class UpdatePreferencesRequest(BaseModel):
    theme: Optional[str] = Field(default=None, pattern=r"^(ocean|gruvbox|dune)$")
    font:  Optional[str] = Field(default=None, pattern=r"^(mono|inter)$")


class LoginRequest(BaseModel):
    email:    EmailStr = Field(..., max_length=254)
    password: str      = Field(..., max_length=128)


# "system" role excluded to prevent prompt injection via guest history
class GuestMessage(BaseModel):
    role:    str = Field(..., pattern=r"^(user|assistant)$")
    content: str = Field(..., max_length=MAX_PROMPT_LENGTH)


class ChatRequest(BaseModel):
    prompt:        str                 = Field(..., min_length=1, max_length=MAX_PROMPT_LENGTH)
    chat_id:       str                 = Field(..., min_length=1, max_length=36)
    model:         Optional[str]       = Field(default=None, max_length=100, pattern=MODEL_NAME_PATTERN)
    system_prompt: Optional[str]       = Field(default=None, max_length=MAX_SYSTEM_PROMPT_LENGTH)
    temperature:   Optional[float]     = Field(default=0.7, ge=0.0, le=2.0)
    images:        Optional[list[str]] = Field(default=None, max_length=4)
    force_search:  Optional[bool]      = Field(default=False)


class GuestChatRequest(BaseModel):
    prompt:        str                  = Field(..., min_length=1, max_length=MAX_PROMPT_LENGTH)
    messages:      list[GuestMessage]   = Field(default=[], max_length=MAX_GUEST_HISTORY)
    model:         Optional[str]        = Field(default=None, max_length=100, pattern=MODEL_NAME_PATTERN)
    system_prompt: Optional[str]        = Field(default=None, max_length=MAX_SYSTEM_PROMPT_LENGTH)
    temperature:   Optional[float]      = Field(default=0.7, ge=0.0, le=2.0)
    images:        Optional[list[str]]  = Field(default=None, max_length=4)


class RenameChatRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=MAX_TITLE_LENGTH)


class RefreshRequest(BaseModel):
    refresh_token: str = Field(..., min_length=1, max_length=256)


class LogoutRequest(BaseModel):
    refresh_token: str = Field(..., min_length=1, max_length=256)


class SetRoleRequest(BaseModel):
    role: str


class UpdateFeatureFlagRequest(BaseModel):
    guest_enabled: Optional[bool] = None
    free_enabled:  Optional[bool] = None
    pro_enabled:   Optional[bool] = None
    admin_enabled: Optional[bool] = None
