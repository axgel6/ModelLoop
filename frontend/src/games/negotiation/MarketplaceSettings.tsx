import { useState } from "react";
import { createPortal } from "react-dom";
import { useEscapeKey } from "../../components/useEscapeKey";
import { isCleanLanguage, setCleanLanguage } from "./settings";
import "./negotiation.css";

/** The Marketplace's own settings, opened from the gear on its card */
export function MarketplaceSettings({ onClose }: { onClose: () => void }) {
  useEscapeKey(onClose);
  // Shown as the opposite of the stored Clean language setting, so earlier choices carry over
  const [strong, setStrong] = useState(() => !isCleanLanguage());

  return createPortal(
    <div className="chat-preferences-modal-overlay" onClick={onClose}>
      <div
        className="landing-theme-modal neg-browser neg-settings"
        role="dialog"
        aria-label="Marketplace settings"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="landing-theme-modal-header">
          <span>Marketplace settings</span>
          <button type="button" className="landing-theme-modal-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="neg-setting">
          <div className="neg-setting-text">
            <span className="pref-item-name">Strong language</span>
            <span className="pref-setting-hint">
              Lets Unhinged buyers and sellers swear freely. Turn it off and they keep their loud, chaotic energy
              without the swearing. Everyone else is clean either way.
            </span>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={strong}
            aria-label="Strong language"
            className={`neg-switch${strong ? " is-on" : ""}`}
            onClick={() => {
              setCleanLanguage(strong);
              setStrong(!strong);
            }}
          >
            <span className="neg-switch-knob" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
