import { useEscapeKey } from "./useEscapeKey";

// What ModelLoop needs and how to start, opened from the sign-in page
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

function HowItWorksModal({ onClose }: { onClose: () => void }) {
  useEscapeKey(onClose);
  return (
    <div className="chat-preferences-modal-overlay" onClick={onClose}>
      <div
        className="landing-theme-modal welcome-how-modal login-modal"
        role="dialog"
        aria-modal="true"
        aria-label="How ModelLoop works"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="landing-theme-modal-header">
          <span>How it works</span>
          <button className="landing-theme-modal-close" onClick={onClose} aria-label="Close">
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
  );
}

export default HowItWorksModal;
