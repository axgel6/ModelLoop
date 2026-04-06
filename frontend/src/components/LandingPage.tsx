interface LandingPageProps {
  onStart: () => void;
}

function LandingPage({ onStart }: LandingPageProps) {
  return (
    <div className="landing-page">
      <div className="landing-content">
        <h1>ModelLoop/Welcome!</h1>
        <p className="landing-tagline">
          Full-stack AI: Streaming, multi-model, persistent.
        </p>

        <div className="landing-features">
          <div className="feature">
            <h3>Real-Time Streaming</h3>
            <p>
              Token-level streaming via Server-Sent Events - Responses appear as
              they're generated, with no waiting for full replies
            </p>
          </div>
          <div className="feature">
            <h3>Guest & Account Modes</h3>
            <p>
              Chat instantly as a guest with no sign-up, or create an account
              for persistent chat history across sessions
            </p>
          </div>
          <div className="feature">
            <h3>Multiple LLMs</h3>
            <p>
              Switch between any Ollama model running on the server - model list
              is fetched live and cached at startup
            </p>
          </div>
          <div className="feature">
            <h3>System Prompts & Shortcuts</h3>
            <p>
              9 preset personalities, slash commands (/clear, /code, /math,
              /help), along with keyboard shortcuts
            </p>
          </div>
          <div className="feature">
            <h3>Stack</h3>
            <p>
              FastAPI + asyncpg + PostgreSQL backend with JWT auth, bcrypt
              password hashing, and rate limiting, React 19 + TypeScript
              frontend
            </p>
          </div>
        </div>

        <button className="start-button" onClick={onStart}>
          Start Chatting
        </button>

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
            <a
              href="https://think-loop-client.onrender.com"
              target="_blank"
              rel="noopener noreferrer"
            >
              ThinkLoop
            </a>
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
