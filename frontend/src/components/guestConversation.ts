// What a guest's browser session remembers, in sessionStorage only (never sent anywhere).
//
// A guest's conversation lives only in the chat screen, so going to the sign-in page would
// lose it. It is held here for the trip, so "Back to chat" on the sign-in page can bring it back.
import type { Message } from "./api";

const CONVERSATION_KEY = "guest_conversation";
const SIGN_IN_HINT_KEY = "sign_in_hint_shown";

/** True the first time in a session, when the sign-in chip may show: a nudge, not a nag. */
export function claimSignInHint(): boolean {
  try {
    if (sessionStorage.getItem(SIGN_IN_HINT_KEY) === "1") return false;
    sessionStorage.setItem(SIGN_IN_HINT_KEY, "1");
  } catch {
    /* storage blocked: show it */
  }
  return true;
}

/** Keep the guest's conversation for the trip to the sign-in page. */
export function saveGuestConversation(messages: Message[]): void {
  // A reply still being written has no content yet, and the hint is only for the moment it appeared
  const kept = messages
    .filter((m) => m.content.trim())
    .map(({ sign_in_hint: _hint, steps: _steps, ...m }) => m);
  if (kept.length === 0) return;
  try {
    sessionStorage.setItem(CONVERSATION_KEY, JSON.stringify(kept));
  } catch {
    // Over the storage quota, most likely from attached images: keep the words at least
    try {
      sessionStorage.setItem(
        CONVERSATION_KEY,
        JSON.stringify(kept.map(({ images: _images, ...m }) => m)),
      );
    } catch {
      /* nothing kept: "Back to chat" will not show */
    }
  }
}

/** The kept conversation, if there is one. Reading leaves it in place (see clearGuestConversation). */
export function readGuestConversation(): Message[] | null {
  try {
    const raw = sessionStorage.getItem(CONVERSATION_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) && parsed.length > 0 ? (parsed as Message[]) : null;
  } catch {
    return null;
  }
}

export function hasGuestConversation(): boolean {
  return readGuestConversation() !== null;
}

export function clearGuestConversation(): void {
  try {
    sessionStorage.removeItem(CONVERSATION_KEY);
  } catch {
    /* storage blocked: nothing was kept */
  }
}
