import { WebHaptics } from "web-haptics";

// iPad (iOS 13+) reports as MacIntel with touch points
const isIOS =
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.userAgent));

class HapticsManager {
  private webHaptics = new WebHaptics();
  private iosSwitch: HTMLInputElement | null = null;

  constructor() {
    if (isIOS) this.initIOSSwitch();
  }

  private initIOSSwitch() {
    const el = document.createElement("input");
    el.type = "checkbox";
    el.setAttribute("switch", "");
    // Off-screen but rendered — display:none suppresses the UIKit haptic
    el.style.cssText =
      "position:fixed;left:-9999px;top:-9999px;opacity:0;pointer-events:none;appearance:auto;";
    document.body.appendChild(el);
    this.iosSwitch = el;
  }

  trigger(_type: Parameters<WebHaptics["trigger"]>[0]) {
    if (this.iosSwitch) {
      // Toggling a native iOS switch fires a UIKit haptic without a gesture requirement
      this.iosSwitch.click();
    } else {
      this.webHaptics.trigger(_type);
    }
  }
}

export const haptics = new HapticsManager();
