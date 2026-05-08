import { WebHaptics } from "web-haptics";

// iPad (iOS 13+) reports as MacIntel with touch points
const isIOS =
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.userAgent));

class HapticsManager {
  private webHaptics = new WebHaptics();
  private iosInput: HTMLInputElement | null = null;
  private iosSel = 0;

  constructor() {
    if (isIOS) this.initIOSInput();
  }

  private initIOSInput() {
    const el = document.createElement("input");
    el.type = "text";
    el.setAttribute("readonly", "");
    el.setAttribute("inputmode", "none");   // suppress soft keyboard
    el.setAttribute("aria-hidden", "true");
    el.setAttribute("tabindex", "-1");
    el.value = " ";                          // needs a character for selectionRange(0,1)
    el.style.cssText =
      "position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;";
    document.body.appendChild(el);
    this.iosInput = el;
  }

  /**
   * Must be called synchronously inside a user-gesture handler (e.g. the send
   * button's click/touchend) before any awaits.  iOS only allows focus() — and
   * therefore the selection-change haptic trick — from within a gesture context.
   */
  unlock() {
    this.iosInput?.focus({ preventScroll: true });
  }

  /** Call when a streaming session ends to release the hidden input's focus. */
  lock() {
    this.iosInput?.blur();
  }

  trigger(type: Parameters<WebHaptics["trigger"]>[0]) {
    if (this.iosInput) {
      // For sync single-shot haptics (button clicks) focus inline; for streaming
      // the input must already be focused via unlock() called before the first await.
      if (document.activeElement !== this.iosInput) {
        this.iosInput.focus({ preventScroll: true });
      }
      // Toggle selection endpoint — iOS fires its selection haptic on the change.
      this.iosSel ^= 1;
      this.iosInput.setSelectionRange(0, this.iosSel);
    } else {
      this.webHaptics.trigger(type);
    }
  }
}

export const haptics = new HapticsManager();
