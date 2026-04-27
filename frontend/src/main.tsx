import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import "katex/dist/katex.min.css";
import "highlight.js/styles/github-dark.css";
import App from "./App.tsx";
import { haptics } from "./haptics";

document.addEventListener("click", (e) => {
  const target = e.target as HTMLElement;

  // ---- Buttons ----
  const btn = target.closest("button:not(:disabled)") as HTMLElement | null;
  if (btn) {
    if (btn.classList.contains("pref-confirm-yes") || btn.classList.contains("logout-confirm-yes")) {
      haptics.trigger("warning");        // destructive confirmations
    } else if (btn.classList.contains("stopping")) {
      haptics.trigger("rigid");          // stop generation
    } else if (btn.classList.contains("ask-button")) {
      haptics.trigger("medium");         // send message
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
