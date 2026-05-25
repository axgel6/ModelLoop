import { useState, useEffect } from "react";

const MESSAGES = [
  "Hey, you caught me at a bad time.",
  "ModelLoop is currently down.",
  "We'll be back online shortly.",
  "Thanks for your patience.",
];

const CHAR_SPEED = 18;
const MESSAGE_GAP = 180;

function DownPage() {
  const [displayed, setDisplayed] = useState<string[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [currentText, setCurrentText] = useState("");

  useEffect(() => {
    if (currentIdx >= MESSAGES.length) return;

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
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}

export default DownPage;
