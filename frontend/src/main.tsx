import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import "katex/dist/katex.min.css";
import "highlight.js/styles/github-dark.css";
import App from "./App.tsx";
import { haptics } from "./haptics";
import { sounds } from "./sounds";
import { isEmptySpaceClick, sparkleAt } from "./sparkle";
import { initStretchy } from "./stretchy";
import { background } from "./background";
import { uiScale } from "./uiScale";

initStretchy();
background.init();
uiScale.init();

// Sound, haptics and the sparkle for a press. They run the moment the pointer goes down, before
// React re-renders anything: on "click" they waited for the whole screen to update first, which a
// heavy screen turned into an audible lag.
function feedback(e: MouseEvent) {
  const target = e.target as HTMLElement;

  // ---- Buttons ----
  const btn = target.closest("button:not(:disabled)") as HTMLElement | null;
  if (btn) {
    if (btn.classList.contains("pref-confirm-yes") || btn.classList.contains("logout-confirm-yes")) {
      haptics.trigger("warning");        // destructive confirmations
    } else if (btn.classList.contains("stopping")) {
      haptics.trigger("rigid");          // stop generation
    } else if (btn.classList.contains("ask-button")) {
      haptics.trigger("medium", { silent: true }); // send message (ChatInput plays the send tone)
    } else if (btn.classList.contains("private-toggle")) {
      haptics.trigger("selection", { silent: true }); // private chat on or off (Chat plays the lock tones)
    } else if (btn.classList.contains("toolbar-think-btn")) {
      haptics.trigger("selection", { silent: true }); // thinking on or off (its own tones play)
    } else if (btn.classList.contains("edit-save-btn")) {
      haptics.trigger("medium");         // save edit
    } else {
      haptics.trigger("selection");      // all other buttons
    }
    return;
  }

  // ---- Clickable divs ----
  if (target.closest(".pref-theme-card")) {
    haptics.trigger("medium");           // theme toggle
    return;
  }
  if (target.closest(".pref-danger-item")) {
    haptics.trigger("warning");          // delete account row
    return;
  }
  if (target.closest(".pref-list-item")) {
    haptics.trigger("light");            // model / preset selection
    return;
  }
  if (target.closest(".pref-nav-item")) {
    haptics.trigger("selection");        // preferences section tabs
    return;
  }
  if (target.closest(".sidebar-chat-item")) {
    haptics.trigger("selection");        // chat history items
    return;
  }
  if (target.closest(".suggestion-chip")) {
    haptics.trigger("light");            // suggestion chips (divs in some themes)
    return;
  }

  // ---- Overlay dismissals ----
  if (
    target.classList.contains("chat-preferences-modal-overlay") ||
    target.classList.contains("pref-delete-overlay") ||
    target.classList.contains("logout-confirm-overlay") ||
    target.classList.contains("sidebar-backdrop")
  ) {
    haptics.trigger("light");
    return;
  }

  // ---- Empty space ----
  if (isEmptySpaceClick(e)) sparkleAt(e.clientX, e.clientY);
}

// Mouse, touch and pen: on the press itself, in the capture phase so nothing can delay or stop it
document.addEventListener(
  "pointerdown",
  (e) => {
    if (e.isPrimary && e.button === 0) feedback(e);
  },
  { capture: true },
);

// Keyboard (Enter or Space on a button) only reaches "click", and its clicks carry no pointer
// detail, so nothing pressed with a pointer gets its feedback twice
document.addEventListener("click", (e) => {
  if (e.detail === 0) feedback(e);
});

// ---- Typing: a soft tap per key in a text field, when turned on in Preferences ----
const TYPED_FIELD = "textarea, input:not([type]), input[type='text'], input[type='search'], input[type='email'], input[type='password']";
document.addEventListener("keydown", (e) => {
  const target = e.target as HTMLElement;
  if (!target.matches?.(TYPED_FIELD) || e.metaKey || e.ctrlKey || e.altKey) return;
  // Characters, plus the keys that change the text; arrows, Shift, Tab and the rest stay quiet
  if (e.key.length === 1 || e.key === "Backspace" || e.key === "Delete") sounds.key();
});

// ---- Hover: a faint chime on coming onto something pressable, mouse only ----
const HOVERABLE = [
  ".topbar-icon-btn", ".toolbar-icon-btn", ".toolbar-chip-btn", ".ask-button", ".sidebar-chat-item",
  ".game-card", ".game-card-settings", ".suggestion-chip", ".pref-nav-item", ".pref-theme-card",
].join(",");
let hovered: Element | null = null;
document.addEventListener("pointerover", (e) => {
  if (e.pointerType !== "mouse") return;
  const el = (e.target as Element | null)?.closest?.(HOVERABLE) ?? null;
  // Moving between the parts inside one button is still the same button
  if (el === hovered) return;
  hovered = el;
  if (el && !el.matches(":disabled")) sounds.hover();
});

// ---- Sliders: haptic tick on each step change ----
let lastRangeValue = NaN;
document.addEventListener("input", (e) => {
  const target = e.target as HTMLElement;
  if (target instanceof HTMLInputElement && target.type === "range") {
    const value = parseFloat(target.value);
    if (value !== lastRangeValue) {
      lastRangeValue = value;
      haptics.trigger("selection");
    }
  }
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
