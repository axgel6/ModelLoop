import { type Theme } from "./ChatPreferences";
import { BASE_THEMES, openFestiveThemes } from "../festive";
import { useEscapeKey } from "./useEscapeKey";

interface ThemePickerModalProps {
  theme: Theme;
  onThemeChange: (t: Theme) => void;
  onClose: () => void;
}

// The theme picker for visitors who have not signed in yet (signed-in users have Preferences)
function ThemePickerModal({ theme, onThemeChange, onClose }: ThemePickerModalProps) {
  useEscapeKey(onClose);
  return (
    <div className="chat-preferences-modal-overlay" onClick={onClose}>
      <div
        className="landing-theme-modal login-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Theme"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="landing-theme-modal-header">
          <span>Theme</span>
          <button className="landing-theme-modal-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="pref-theme-cards">
          {/* The everyday themes, then any festive ones in season (see festive.ts) */}
          {[...BASE_THEMES, ...openFestiveThemes()].map((t) => (
            <div
              key={t.id}
              className={`pref-theme-card${theme === t.id ? " active" : ""}`}
              onClick={() => onThemeChange(t.id)}
            >
              <div className={`pref-theme-preview pref-theme-preview-${t.id}`}>
                <span className="ptc-bar ptc-bar-1" />
                <span className="ptc-bar ptc-bar-2" />
                <span className="ptc-bar ptc-bar-3" />
              </div>
              <span className="pref-theme-label">{t.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default ThemePickerModal;
