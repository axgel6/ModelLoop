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

// Shared promise so concurrent 401s don't each trigger an independent refresh,
// which would rotate the token under the second caller and cause a spurious logout.
let _refreshPromise: Promise<RefreshOutcome> | null = null;

// "rejected" means the server actively refused the token, and only that should log the
// user out. "unreachable" covers offline/DNS/500s, where the session is probably still
// valid and throwing the user out would lose their place for no reason.
type RefreshOutcome = "ok" | "rejected" | "unreachable";

function readAccessTokenExpiry(token: string): number | null {
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    return typeof payload.exp === "number" ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

async function _doRefresh(): Promise<RefreshOutcome> {
  const refreshToken = localStorage.getItem("refresh_token");
  if (!refreshToken) return "rejected";
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api/v1/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
  } catch {
    return "unreachable"; // offline or server down; keep the session
  }

  if (!res.ok) {
    // Another tab may have rotated the token while this request was in flight. If the
    // stored value changed, that tab succeeded and we can ride along on its new token.
    const current = localStorage.getItem("refresh_token");
    if (current && current !== refreshToken) return "ok";
    return res.status === 401 ? "rejected" : "unreachable";
  }

  try {
    const data = await res.json();
    localStorage.setItem("token", data.token);
    localStorage.setItem("refresh_token", data.refresh_token);
  } catch {
    return "unreachable";
  }
  scheduleProactiveRefresh();
  return "ok";
}

// Silently exchange the stored refresh token for a new access + refresh token pair.
function tryRefresh(): Promise<RefreshOutcome> {
  if (_refreshPromise) return _refreshPromise;
  _refreshPromise = _doRefresh().finally(() => {
    _refreshPromise = null;
  });
  return _refreshPromise;
}

// ----- Proactive refresh -----
//
// Refreshing only in reaction to a 401 means every request in flight when the access
// token expires fails at once, and each retry piles onto the same rotation. Renewing
// shortly before expiry keeps tokens valid so that stampede never forms.
let _refreshTimer: ReturnType<typeof setTimeout> | null = null;
const REFRESH_LEAD_MS = 60_000; // renew a minute before the token actually expires

export function scheduleProactiveRefresh() {
  if (_refreshTimer) {
    clearTimeout(_refreshTimer);
    _refreshTimer = null;
  }
  const token = localStorage.getItem("token");
  if (!token) return;
  const expiresAt = readAccessTokenExpiry(token);
  if (expiresAt === null) return;
  const delay = Math.max(5_000, expiresAt - Date.now() - REFRESH_LEAD_MS);
  _refreshTimer = setTimeout(() => {
    if (localStorage.getItem("refresh_token")) void tryRefresh();
  }, delay);
}

export function cancelProactiveRefresh() {
  if (_refreshTimer) {
    clearTimeout(_refreshTimer);
    _refreshTimer = null;
  }
}

// Wraps a fetch lambda with one automatic retry after a silent token refresh.
// Only a refresh the server actively rejected clears the session.
async function withRefresh(
  requestFn: () => Promise<Response>,
): Promise<Response> {
  const res = await requestFn();
  if (res.status !== 401) return res;

  const outcome = await tryRefresh();
  if (outcome === "rejected") {
    localStorage.removeItem("token");
    localStorage.removeItem("refresh_token");
    cancelProactiveRefresh();
    unauthorizedHandler?.();
    return res;
  }
  if (outcome === "unreachable") return res; // surface the failure, keep the session

  return requestFn();
}

// Authenticated request for feature folders that keep their own API file (games/).
// A body is sent as JSON.
export function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers: Record<string, string> =
    init.body !== undefined ? { "Content-Type": "application/json" } : {};
  return withRefresh(() =>
    fetch(`${API_URL}${path}`, { ...init, headers: authHeaders(headers) }),
  );
}

// ----- Auth -----

// Register a new account: returns access + refresh tokens on success
export async function apiRegister(
  email: string,
  password: string,
  fullName?: string,
): Promise<{ token: string; refresh_token: string }> {
  const res = await fetch(`${API_URL}/api/v1/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, full_name: fullName || undefined }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const detail =
      typeof err.detail === "string" ? err.detail : "I couldn't create that account. Try again in a moment.";
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
      typeof err.detail === "string" ? err.detail : "That email or password doesn't match. Try again?";
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
  if (!res.ok) throw new Error("I couldn't load your chats. Try again in a moment.");
  const data = await res.json();
  return data.chats;
}

// Create a new blank chat and return its metadata
export async function apiCreateChat(): Promise<ChatMeta> {
  const res = await withRefresh(() =>
    fetch(`${API_URL}/api/v1/chats`, {
      method: "POST",
      headers: authHeaders(),
    }),
  );
  if (!res.ok) throw new Error("I couldn't start a new chat. Try again in a moment.");
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
  if (!res.ok) throw new Error("I couldn't rename that chat.");
}

// Fetch the current user's id, email, full_name, theme, font, avatar_color, and personal_context
export async function apiGetMe(): Promise<{
  id: string;
  email: string;
  full_name: string | null;
  theme: string;
  font: string;
  /** The sidebar icon's color as #rrggbb, or null for the theme's own */
  avatar_color: string | null;
  personal_context: string | null;
  ollama_url: string | null;
}> {
  const res = await withRefresh(() =>
    fetch(`${API_URL}/api/v1/auth/me`, { headers: authHeaders() }),
  );
  if (!res.ok) throw new Error("I couldn't load your account details.");
  return res.json();
}

// `avatar_color` "" goes back to the theme's own color
export async function apiUpdatePreferences(prefs: { theme?: string; font?: string; avatar_color?: string }): Promise<void> {
  const res = await withRefresh(() =>
    fetch(`${API_URL}/api/v1/auth/preferences`, {
      method: "PATCH",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(prefs),
    }),
  );
  if (!res.ok) throw new Error("I couldn't save your preferences.");
}

export async function apiUpdateProfile(fullName: string): Promise<void> {
  const res = await withRefresh(() =>
    fetch(`${API_URL}/api/v1/auth/me`, {
      method: "PATCH",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ full_name: fullName }),
    }),
  );
  if (!res.ok) throw new Error("I couldn't save your profile.");
}

export async function apiSavePersonalContext(personalContext: string | null): Promise<void> {
  const res = await withRefresh(() =>
    fetch(`${API_URL}/api/v1/auth/me/context`, {
      method: "PATCH",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ personal_context: personalContext || null }),
    }),
  );
  if (!res.ok) throw new Error("I couldn't save that.");
}

// ----- Ollama connection -----

export interface OllamaStatus {
  reachable: boolean;
  reason?: "timeout" | "unreachable";
  detail?: string;
  models?: number;
  sample?: string[];
  latency_ms?: number;
  using_shared_server?: boolean;
  url: string | null;
}

// Save (or clear, with null) this account's own Ollama server address
export async function apiSetOllamaUrl(url: string | null): Promise<{ ollama_url: string | null }> {
  const res = await withRefresh(() =>
    fetch(`${API_URL}/api/v1/auth/me/ollama`, {
      method: "PATCH",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ ollama_url: url }),
    }),
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(typeof err.detail === "string" ? err.detail : "I couldn't save that server address.");
  }
  return res.json();
}

// Reachability of the server this account currently uses
export async function apiOllamaStatus(): Promise<OllamaStatus> {
  const res = await withRefresh(() =>
    fetch(`${API_URL}/api/v1/ollama/status`, { headers: authHeaders() }),
  );
  if (!res.ok) throw new Error("I couldn't check the server right now.");
  return res.json();
}

// Probe a candidate address without saving it
export async function apiTestOllamaUrl(url: string): Promise<OllamaStatus> {
  const res = await withRefresh(() =>
    fetch(`${API_URL}/api/v1/ollama/test`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ ollama_url: url }),
    }),
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(typeof err.detail === "string" ? err.detail : "That test didn't work.");
  }
  return res.json();
}

export async function apiGetMyFeatures(): Promise<Record<string, boolean>> {
  const res = await withRefresh(() =>
    fetch(`${API_URL}/api/v1/auth/features`, { headers: authHeaders() }),
  );
  if (!res.ok) return {};
  return res.json();
}

export async function apiGetGuestFeatures(): Promise<Record<string, boolean>> {
  const res = await fetch(`${API_URL}/api/v1/auth/features/guest`);
  if (!res.ok) return {};
  return res.json();
}

// Delete the current user account and all their data
export async function apiDeleteAccount(): Promise<void> {
  const res = await withRefresh(() =>
    fetch(`${API_URL}/api/v1/auth/account`, {
      method: "DELETE",
      headers: authHeaders(),
    }),
  );
  if (!res.ok) throw new Error("I couldn't delete the account. Try again in a moment.");
}

// Delete a chat and all its messages
export async function apiDeleteChat(chatId: string): Promise<void> {
  const res = await withRefresh(() =>
    fetch(`${API_URL}/api/v1/chats/${chatId}`, {
      method: "DELETE",
      headers: authHeaders(),
    }),
  );
  if (!res.ok) throw new Error("I couldn't delete that chat.");
}

// ----- Messages -----

// A single turn in a conversation
export interface Message {
  role: "user" | "assistant";
  content: string;
  created_at?: string;
  images?: string[];
  thinking?: string;
  image_context?: string;
  search_context?: string;
}

// Fetch the full message history for a chat, ordered by creation time
export async function apiGetMessages(chatId: string): Promise<Message[]> {
  const res = await withRefresh(() =>
    fetch(`${API_URL}/api/v1/chats/${chatId}/messages`, {
      headers: authHeaders(),
    }),
  );
  if (!res.ok) throw new Error("I couldn't load this conversation.");
  const data = await res.json();
  return data.messages;
}

// ----- Models + Health -----

// Fetch the list of available Ollama models from the backend
export async function apiGetModels(): Promise<{
  models: string[];
  capabilities: Record<string, string[]>;
  /** What chat and the games fall back to when nothing is picked */
  defaults: { chat?: string; game?: string };
}> {
  const res = await withRefresh(() =>
    fetch(`${API_URL}/api/v1/models`, { headers: authHeaders() }),
  );
  if (!res.ok) throw new Error("I couldn't load the models.");
  const data = await res.json();
  const all: string[] = (data.models ?? []).filter(
    (m: string) => !m.startsWith("nomic-embed-text"),
  );
  const capabilities: Record<string, string[]> = data.capabilities ?? {};
  return { models: all, capabilities, defaults: data.defaults ?? {} };
}

export interface RateLimits {
  chat: string;
  guest_chat: string;
  guest_daily: string;
}

// Public endpoint - guests need these too.
export async function apiGetLimits(): Promise<RateLimits | null> {
  try {
    const res = await fetch(`${API_URL}/api/v1/limits`);
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
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

// ----- Documents -----

export interface DocumentMeta {
  id: string;
  filename: string;
  chunk_count: number;
  created_at: string;
}

export async function apiListDocuments(
  chatId: string,
): Promise<DocumentMeta[]> {
  const res = await withRefresh(() =>
    fetch(`${API_URL}/api/v1/chats/${chatId}/documents`, {
      headers: authHeaders(),
    }),
  );
  if (!res.ok) throw new Error("I couldn't load your documents.");
  const data = await res.json();
  return data.documents;
}

export async function apiUploadDocument(
  chatId: string,
  file: File,
): Promise<DocumentMeta> {
  const form = new FormData();
  form.append("file", file);
  const res = await withRefresh(() =>
    fetch(`${API_URL}/api/v1/chats/${chatId}/documents`, {
      method: "POST",
      headers: authHeaders(),
      body: form,
    }),
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "That upload didn't go through.");
  }
  return res.json();
}

export async function apiDeleteDocument(docId: string): Promise<void> {
  const res = await withRefresh(() =>
    fetch(`${API_URL}/api/v1/documents/${docId}`, {
      method: "DELETE",
      headers: authHeaders(),
    }),
  );
  if (!res.ok) throw new Error("I couldn't remove that document.");
}

// ----- Streaming -----

// Send a guest chat message, no auth required, history is passed by the caller
// Returns the raw Response so the caller can read the SSE stream directly
export async function apiGuestChatStream(
  payload: {
    prompt: string;
    messages: Message[];
    model?: string;
    system_prompt?: string;
    temperature?: number;
    top_p?: number;
    num_predict?: number;
    images?: string[];
    /** Reason before answering, for models that can */
    think?: boolean;
  },
  signal?: AbortSignal,
): Promise<Response> {
  const res = await fetch(`${API_URL}/api/v1/chat/guest/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(API_KEY ? { "X-API-Key": API_KEY } : {}) },
    body: JSON.stringify(payload),
    signal,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    if (res.status === 429) {
      const isDaily =
        typeof err.detail === "string" &&
        err.detail.toLowerCase().includes("daily");
      throw new Error(
        isDaily
          ? "Daily guest limit reached - log in or create an account to keep chatting."
          : "Guest limit: 5 messages per minute - wait a moment, or log in for more.",
      );
    }
    throw new Error(err.detail || "I couldn't get a reply. Want to try again?");
  }
  return res;
}

// Send a private chat message: signed in, but nothing is saved, so the caller passes the history
// Returns the raw Response so the caller can read the SSE stream directly
export async function apiPrivateChatStream(
  payload: {
    prompt: string;
    messages: Message[];
    model?: string;
    system_prompt?: string;
    temperature?: number;
    top_p?: number;
    num_predict?: number;
    images?: string[];
    force_search?: boolean;
    /** Reason before answering, for models that can */
    think?: boolean;
  },
  signal?: AbortSignal,
): Promise<Response> {
  // The server loads the last 20 messages of a saved chat; a private one sends the same,
  // each within the prompt limit
  const messages = payload.messages
    .slice(-20)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 10000) }));
  const res = await withRefresh(() =>
    fetch(`${API_URL}/api/v1/chat/private/stream`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ ...payload, messages }),
      signal,
    }),
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "I couldn't get a reply. Want to try again?");
  }
  return res;
}

// Send an authenticated chat message, history is loaded from the DB by the server
// Returns the raw Response so the caller can read the SSE stream directly
export async function apiChatStream(
  payload: {
    prompt: string;
    chat_id: string;
    model?: string;
    system_prompt?: string;
    temperature?: number;
    top_p?: number;
    num_predict?: number;
    images?: string[];
    force_search?: boolean;
    /** Reason before answering, for models that can */
    think?: boolean;
  },
  signal?: AbortSignal,
): Promise<Response> {
  const res = await withRefresh(() =>
    fetch(`${API_URL}/api/v1/chat/stream`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
      signal,
    }),
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "I couldn't get a reply. Want to try again?");
  }
  return res;
}
