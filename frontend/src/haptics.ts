import { WebHaptics } from "web-haptics";
import { sounds, type SoundName } from "./sounds";

// Each kind of touch feedback has a matching calm tone (see sounds.ts).
const HAPTIC_SOUND: Record<string, SoundName> = {
  selection: "tick",
  light: "tick",
  medium: "pop",
  warning: "warn",
  rigid: "stop",
};

// iPad (iOS 13+) reports as MacIntel with touch points
const isIOS =
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.userAgent));

class HapticsManager {
  private webHaptics = new WebHaptics();
  private iosLabel: HTMLLabelElement | null = null;

  constructor() {
    if (isIOS) this.initIOSSwitch();
  }

  private initIOSSwitch() {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.setAttribute("switch", "");
    // Reset all styles first (same as web-haptics), then restore native appearance
    input.style.cssText = "all:initial;appearance:auto;-webkit-appearance:auto;";

    const label = document.createElement("label");
    // In-viewport but invisible — iOS won't animate (and therefore won't haptic)
    // elements that are off-screen or display:none
    label.style.cssText =
      "position:fixed;bottom:0;right:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none;";
    label.appendChild(input);
    document.body.appendChild(label);
    this.iosLabel = label;
  }

  // `silent` skips the tone, for feedback that repeats too fast to voice (streaming
  // tokens) or that plays its own named sound instead.
  trigger(_type: Parameters<WebHaptics["trigger"]>[0], opts?: { silent?: boolean }) {
    if (!opts?.silent && typeof _type === "string" && HAPTIC_SOUND[_type]) {
      sounds.play(HAPTIC_SOUND[_type]);
    }
    if (this.iosLabel) {
      // Clicking the label toggles the native iOS switch, which fires a UIKit haptic.
      // The element must be in-viewport (not off-screen or display:none) for the
      // animation — and therefore the haptic — to actually run.
      this.iosLabel.click();
    } else {
      void this.webHaptics.trigger(_type);
    }
  }
}

export const haptics = new HapticsManager();
