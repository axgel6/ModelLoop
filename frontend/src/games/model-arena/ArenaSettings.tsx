import { useState } from "react";
import { createPortal } from "react-dom";
import { useEscapeKey } from "../../components/useEscapeKey";
import { isUnhingedAllowed, setUnhingedAllowed } from "./settings";
// The settings window and its switch are styled with the Marketplace's
import "../negotiation/negotiation.css";

/** Model Arena's own settings, opened from the gear on its card */
export function ArenaSettings({ onClose }: { onClose: () => void }) {
  useEscapeKey(onClose);
  const [unhinged, setUnhinged] = useState(isUnhingedAllowed);

  return createPortal(
    <div className="chat-preferences-modal-overlay" onClick={onClose}>
      <div
        className="landing-theme-modal neg-browser neg-settings"
        role="dialog"
        aria-label="Model Arena settings"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="landing-theme-modal-header">
          <span>Model Arena settings</span>
          <button type="button" className="landing-theme-modal-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="neg-setting">
          <div className="neg-setting-text">
            <span className="pref-item-name">Unhinged character</span>
            <span className="pref-setting-hint">
              Lets a debater be Unhinged, who swears in every speech and holds nothing back. Turn it off to keep
              every debate clean.
            </span>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={unhinged}
            aria-label="Unhinged character"
            className={`neg-switch${unhinged ? " is-on" : ""}`}
            onClick={() => {
              setUnhingedAllowed(!unhinged);
              setUnhinged(!unhinged);
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
