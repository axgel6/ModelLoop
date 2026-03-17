// Centralized API client — all fetch calls go through here so Authorization
// headers and the base URL are never scattered across components

// Base URL falls back to localhost for local development
const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";
const API_KEY = import.meta.env.VITE_API_KEY;

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

// ----- Auth -----

// Register a new account — returns a JWT on success
export async function apiRegister(
  email: string,
  password: string,
): Promise<{ token: string }> {
  const res = await fetch(`${API_URL}/api/auth/register`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const detail = typeof err.detail === "string" ? err.detail : "Registration failed";
    throw new Error(detail);
  }
  return res.json();
}

// Authenticate with existing credentials — returns a JWT on success
export async function apiLogin(
  email: string,
  password: string,
): Promise<{ token: string }> {
  const res = await fetch(`${API_URL}/api/auth/login`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const detail = typeof err.detail === "string" ? err.detail : "Invalid email or password";
    throw new Error(detail);
  }
  return res.json();
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
  const res = await fetch(`${API_URL}/api/chats`, { headers: authHeaders() });
  if (!res.ok) throw new Error("Failed to load chats");
  const data = await res.json();
  return data.chats;
}

// Create a new blank chat and return its metadata
export async function apiCreateChat(): Promise<ChatMeta> {
  const res = await fetch(`${API_URL}/api/chats`, {
    method: "POST",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("Failed to create chat");
  return res.json();
}

// Rename a chat, only the authorized user can rename it (enforced server-side)
export async function apiRenameChat(
  chatId: string,
  title: string,
): Promise<void> {
  const res = await fetch(`${API_URL}/api/chats/${chatId}`, {
    method: "PATCH",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ title }),
  });
  if (!res.ok) throw new Error("Failed to rename chat");
}

// Delete a chat and all its messages
export async function apiDeleteChat(chatId: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/chats/${chatId}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
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
  const res = await fetch(`${API_URL}/api/chats/${chatId}/messages`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("Failed to load messages");
  const data = await res.json();
  return data.messages;
}

// ----- Models + Health -----

// Fetch the list of available Ollama models from the backend
export async function apiGetModels(): Promise<string[]> {
  const res = await fetch(`${API_URL}/api/models`, { headers: authHeaders() });
  if (!res.ok) throw new Error("Failed to fetch models");
  const data = await res.json();
  // Fall back to empty array if the backend returns no models key
  return data.models ?? [];
}

// Ping the health endpoint, returns false instead of throwing on network errors
// Used by Chat.tsx to drive the connection status indicator
export async function apiHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${API_URL}/api/health`, {
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
}): Promise<Response> {
  const res = await fetch(`${API_URL}/api/chat/guest/stream`, {
    method: "POST",
    // No auth header, guest endpoint is unauthenticated
    headers: { "Content-Type": "application/json" },
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
}): Promise<Response> {
  const res = await fetch(`${API_URL}/api/chat/stream`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to get response");
  }
  return res;
}
