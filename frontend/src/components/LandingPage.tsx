import { useState, useEffect } from "react";
import { type Theme } from "./ChatPreferences";

interface LandingPageProps {
  onStart: () => void;
  onTerms: () => void;
  theme: Theme;
  onThemeChange: (t: Theme) => void;
}

const MESSAGES = [
  "Hello there!",
  "Welcome to ModelLoop!",
  "I can't wait to meet you!",
  "Ask me anything.",
];

const CHAR_SPEED = 18;
const MESSAGE_GAP = 180;

const THEMES: { id: Theme; label: string; previewClass: string }[] = [
  { id: "ocean",   label: "Ocean",   previewClass: "pref-theme-preview-ocean" },
  { id: "gruvbox", label: "Gruvbox", previewClass: "pref-theme-preview-gruvbox" },
  { id: "dune",    label: "Dune",    previewClass: "pref-theme-preview-dune" },
];

function LandingPage({ onStart, onTerms, theme, onThemeChange }: LandingPageProps) {
  const [displayed, setDisplayed] = useState<string[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [currentText, setCurrentText] = useState("");
  const [done, setDone] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);

  useEffect(() => {
    if (currentIdx >= MESSAGES.length) {
      setDone(true);
      return;
    }

    const target = MESSAGES[currentIdx];
    let charIdx = 0;

    const charTimer = setInterval(() => {
      charIdx++;
      setCurrentText(target.slice(0, charIdx));
      if (charIdx >= target.length) {
        clearInterval(charTimer);
        setTimeout(() => {
          setDisplayed((prev) => [...prev, target]);
          setCurrentText("");
          setCurrentIdx((prev) => prev + 1);
        }, MESSAGE_GAP);
      }
    }, CHAR_SPEED);

    return () => clearInterval(charTimer);
  }, [currentIdx]);

  return (
    <div className="landing-page">
      <div className="landing-content">
        <div className="landing-messages">
          {displayed.map((msg, i) => (
            <div key={i} className="landing-message">
              {msg}
            </div>
          ))}
          {currentIdx < MESSAGES.length && (
            <div className="landing-message">
              {currentText}
              <span className="landing-cursor" />
            </div>
          )}
        </div>

        {done && (
          <button className="start-button landing-start-fade" onClick={onStart}>
            Start Chatting
          </button>
        )}

        <div className="landing-footer">
          <p>
            Built by{" "}
            <a
              href="https://aynjel.com/"
              target="_blank"
              rel="noopener noreferrer"
            >
              Angel Gutierrez
            </a>{" "}
            •{" "}
            <a
              href="https://github.com/axgel6"
              target="_blank"
              rel="noopener noreferrer"
            >
              GitHub
            </a>{" "}
            •{" "}
            <span className="landing-footer-link" onClick={onTerms}>
              Terms of Service
            </span>{" "}
            •{" "}
            <span className="landing-footer-link" onClick={() => setThemeOpen(true)}>
              Theme
            </span>
          </p>
          <p>
            ModelLoop can make mistakes. Please verify any critical information
            it provides.
          </p>
        </div>
      </div>

      {themeOpen && (
        <div
          className="chat-preferences-modal-overlay"
          onClick={() => setThemeOpen(false)}
        >
          <div
            className="landing-theme-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="landing-theme-modal-header">
              <span>Theme</span>
              <button
                className="landing-theme-modal-close"
                onClick={() => setThemeOpen(false)}
              >
                ✕
              </button>
            </div>
            <div className="pref-theme-cards">
              {THEMES.map((t) => (
                <div
                  key={t.id}
                  className={`pref-theme-card${theme === t.id ? " active" : ""}`}
                  onClick={() => onThemeChange(t.id)}
                >
                  <div className={`pref-theme-preview ${t.previewClass}`}>
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
      )}
    </div>
  );
}

export default LandingPage;
