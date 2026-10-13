import { useState, useEffect } from "react";
import { type Theme } from "./ChatPreferences";
import { sounds } from "../sounds";

interface WelcomePageProps {
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
  { id: "meadow",  label: "Meadow",  previewClass: "pref-theme-preview-meadow" },
  { id: "dune",    label: "Dune",    previewClass: "pref-theme-preview-dune" },
  { id: "ember",   label: "Ember",   previewClass: "pref-theme-preview-ember" },
];

const STEPS: { n: string; title: string; body: React.ReactNode }[] = [
  {
    n: "1",
    title: "Create an account",
    body: "Your chats, uploaded documents, and preferences are saved to your account so they follow you between devices.",
  },
  {
    n: "2",
    title: "Point it at a model server",
    body: (
      <>
        ModelLoop runs open models through{" "}
        <a href="https://ollama.com" target="_blank" rel="noopener noreferrer">
          Ollama
        </a>
        . Open Preferences, go to the Advanced tab, and paste the address of your
        Ollama server. ModelLoop connects to it from its own server, not from your
        browser, so the address has to be reachable from the internet: a tunnel such
        as ngrok or Tailscale Funnel, or a public host. A plain{" "}
        <code>localhost</code> address will not work, and private or LAN addresses
        are refused.
      </>
    ),
  },
  {
    n: "3",
    title: "Or borrow the test server",
    body: (
      <>
        No server of your own? Leave the field empty and you will use the shared test
        server. It is running, but it sleeps when idle, so the very first reply can
        take a minute or so to arrive while it wakes up. After that it responds
        normally.
      </>
    ),
  },
  {
    n: "4",
    title: "Start chatting",
    body: "Pick a model, attach images or documents, and let it search the web when a question needs current information.",
  },
];

function WelcomePage({ onStart, onTerms, theme, onThemeChange }: WelcomePageProps) {
  const [displayed, setDisplayed] = useState<string[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [currentText, setCurrentText] = useState("");
  const [done, setDone] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const [soundOn, setSoundOn] = useState(() => sounds.isEnabled());
  const [howOpen, setHowOpen] = useState(false);

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

  useEffect(() => {
    if (!howOpen && !themeOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setHowOpen(false);
        setThemeOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [howOpen, themeOpen]);

  return (
    <div className="landing-page welcome-page">
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
          <div className="landing-start-row landing-start-fade">
            <button className="start-button" onClick={onStart}>
              Start Chatting
            </button>
            <button
              type="button"
              className="pref-info-btn welcome-info-btn"
              onClick={() => setHowOpen(true)}
              title="How it works"
              aria-label="How it works"
              aria-haspopup="dialog"
            >
              i
            </button>
          </div>
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
            </span>{" "}
            •{" "}
            <span
              className="landing-footer-link"
              role="switch"
              aria-checked={soundOn}
              onClick={() => {
                const next = !soundOn;
                sounds.setEnabled(next);
                setSoundOn(next);
                if (next) sounds.play("done");
              }}
            >
              Sound: {soundOn ? "On" : "Off"}
            </span>
          </p>
          <p>
            ModelLoop can make mistakes. Please verify any critical information
            it provides.
          </p>
        </div>
      </div>

      {howOpen && (
        <div
          className="chat-preferences-modal-overlay"
          onClick={() => setHowOpen(false)}
        >
          <div
            className="landing-theme-modal welcome-how-modal"
            role="dialog"
            aria-modal="true"
            aria-label="How ModelLoop works"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="landing-theme-modal-header">
              <span>How it works</span>
              <button
                className="landing-theme-modal-close"
                onClick={() => setHowOpen(false)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <div className="welcome-how">
              <ol className="welcome-steps">
                {STEPS.map((step) => (
                  <li key={step.n} className="welcome-step">
                    <span className="welcome-step-num">{step.n}</span>
                    <div className="welcome-step-text">
                      <h3 className="welcome-step-title">{step.title}</h3>
                      <p className="welcome-step-body">{step.body}</p>
                    </div>
                  </li>
                ))}
              </ol>
              <div className="welcome-notice">
                <strong>About the shared test server:</strong> it is free to use and
                shared with everyone, so it can be slow under load and needs a moment
                to wake from idle. For consistent speed, connect your own Ollama
                server in Preferences, under Advanced.
              </div>
            </div>
          </div>
        </div>
      )}

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

export default WelcomePage;
