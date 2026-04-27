import { useState, useEffect } from "react";

interface LandingPageProps {
  onStart: () => void;
  onTerms: () => void;
}

const MESSAGES = [
  "Hello there!",
  "Welcome to ModelLoop!",
  "I can't wait to meet you!",
  "Ask me anything.",
];

const CHAR_SPEED = 18;
const MESSAGE_GAP = 180;

function LandingPage({ onStart, onTerms }: LandingPageProps) {
  const [displayed, setDisplayed] = useState<string[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [currentText, setCurrentText] = useState("");
  const [done, setDone] = useState(false);

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
            </span>
          </p>
          <p>
            ModelLoop can make mistakes. Please verify any critical information
            it provides.
          </p>
        </div>
      </div>
    </div>
  );
}

export default LandingPage;
