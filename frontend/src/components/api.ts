// Centralized API client: all fetch calls go through here so Authorization
// headers and the base URL are never scattered across components

// Base URL falls back to localhost for local development
const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";
const API_KEY = import.meta.env.VITE_API_KEY;

// Registered by App.tsx so the interceptor can trigger logout when refresh fails
let unauthorizedHandler: (() => void) | null = null;

export function setUnauthorizedHandler(fn: () => void) {
  unauthorizedHandler = fn;
}

function authHeaders(
  extraHeaders: Record<string, string> = {},
): Record<string, string> {
  const token = localStorage.getItem("token");
  return {
    ...(API_KEY ? { "X-API-Key": API_KEY } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extraHeaders,
  };
}

// Silently exchange the stored refresh token for a new access + refresh token pair.
// Returns true on success, false if the refresh token is missing or rejected.
async function tryRefresh(): Promise<boolean> {
  const refreshToken = localStorage.getItem("refresh_token");
  if (!refreshToken) return false;
  try {
    const res = await fetch(`${API_URL}/api/v1/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    localStorage.setItem("token", data.token);
    localStorage.setItem("refresh_token", data.refresh_token);
    return true;
  } catch {
    return false;
  }
}

// Wraps a fetch lambda with one automatic retry after a silent token refresh.
// On an unrecoverable 401 it clears tokens and fires the logout callback.
async function withRefresh(
  requestFn: () => Promise<Response>,
): Promise<Response> {
  const res = await requestFn();
  if (res.status !== 401) return res;

  const refreshed = await tryRefresh();
  if (!refreshed) {
    localStorage.removeItem("token");
    localStorage.removeItem("refresh_token");
    unauthorizedHandler?.();
    return res;
  }

  return requestFn();
}

// ----- Auth -----

// Register a new account: returns access + refresh tokens on success
export async function apiRegister(
  email: string,
  password: string,
): Promise<{ token: string; refresh_token: string }> {
  const res = await fetch(`${API_URL}/api/v1/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const detail =
      typeof err.detail === "string" ? err.detail : "Registration failed";
    throw new Error(detail);
  }
  return res.json();
}

// Authenticate with existing credentials: returns access + refresh tokens on success
export async function apiLogin(
  email: string,
  password: string,
): Promise<{ token: string; refresh_token: string }> {
  const res = await fetch(`${API_URL}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const detail =
      typeof err.detail === "string" ? err.detail : "Invalid email or password";
    throw new Error(detail);
  }
  return res.json();
}

// Revoke the refresh token on the server, then clear both tokens from localStorage
export async function apiLogout(): Promise<void> {
  const refreshToken = localStorage.getItem("refresh_token");
  localStorage.removeItem("token");
  localStorage.removeItem("refresh_token");
  if (!refreshToken) return;
  try {
    await fetch(`${API_URL}/api/v1/auth/logout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
  } catch {
    /* Tokens cleared locally */
  }
}

// ----- Chats -----

// Metadata returned for each chat, does not include message content
export interface ChatMeta {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

// Fetch all chats for the authenticated user, ordered newest first
export async function apiListChats(): Promise<ChatMeta[]> {
  const res = await withRefresh(() =>
    fetch(`${API_URL}/api/v1/chats`, { headers: authHeaders() }),
  );
  if (!res.ok) throw new Error("Failed to load chats");
  const data = await res.json();
  return data.chats;
}

// Create a new blank chat and return its metadata
export async function apiCreateChat(): Promise<ChatMeta> {
  const res = await withRefresh(() =>
    fetch(`${API_URL}/api/v1/chats`, { method: "POST", headers: authHeaders() }),
  );
  if (!res.ok) throw new Error("Failed to create chat");
  return res.json();
}

// Rename a chat, only the authorized user can rename it (enforced server-side)
export async function apiRenameChat(
  chatId: string,
  title: string,
): Promise<void> {
  const res = await withRefresh(() =>
    fetch(`${API_URL}/api/v1/chats/${chatId}`, {
      method: "PATCH",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ title }),
    }),
  );
  if (!res.ok) throw new Error("Failed to rename chat");
}

// Delete a chat and all its messages
export async function apiDeleteChat(chatId: string): Promise<void> {
  const res = await withRefresh(() =>
    fetch(`${API_URL}/api/v1/chats/${chatId}`, {
      method: "DELETE",
      headers: authHeaders(),
    }),
  );
  if (!res.ok) throw new Error("Failed to delete chat");
}

// ----- Messages -----

// A single turn in a conversation
export interface Message {
  role: "user" | "assistant";
  content: string;
}

// Fetch the full message history for a chat, ordered by creation time
export async function apiGetMessages(chatId: string): Promise<Message[]> {
  const res = await withRefresh(() =>
    fetch(`${API_URL}/api/v1/chats/${chatId}/messages`, {
      headers: authHeaders(),
    }),
  );
  if (!res.ok) throw new Error("Failed to load messages");
  const data = await res.json();
  return data.messages;
}

// ----- Models + Health -----

// Fetch the list of available Ollama models from the backend
export async function apiGetModels(): Promise<string[]> {
  const res = await fetch(`${API_URL}/api/v1/models`, { headers: authHeaders() });
  if (!res.ok) throw new Error("Failed to fetch models");
  const data = await res.json();
  // Fall back to empty array if the backend returns no models key
  return data.models ?? [];
}

// Ping the health endpoint, returns false instead of throwing on network errors
// Used by Chat.tsx to drive the connection status indicator
export async function apiHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${API_URL}/api/v1/health`, {
      headers: authHeaders(),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ----- Streaming -----

// Send a guest chat message, no auth required, history is passed by the caller
// Returns the raw Response so the caller can read the SSE stream directly
export async function apiGuestChatStream(payload: {
  prompt: string;
  messages: Message[];
  model?: string;
  system_prompt?: string;
  temperature?: number;
}): Promise<Response> {
  const res = await fetch(`${API_URL}/api/v1/chat/guest/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-Key": API_KEY },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to get response");
  }
  return res;
}

// Send an authenticated chat message, history is loaded from the DB by the server
// Returns the raw Response so the caller can read the SSE stream directly
export async function apiChatStream(payload: {
  prompt: string;
  chat_id: string;
  model?: string;
  system_prompt?: string;
  temperature?: number;
}): Promise<Response> {
  const res = await withRefresh(() =>
    fetch(`${API_URL}/api/v1/chat/stream`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
    }),
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to get response");
  }
  return res;
}
