interface LandingPageProps {
  onStart: () => void;
}

function LandingPage({ onStart }: LandingPageProps) {
  return (
    <div className="landing-page">
      <div className="landing-content">
        <h1>ModelLoop/Landing</h1>
        <p className="landing-tagline">Self-hosted AI chat powered by Ollama</p>

        <div className="landing-features">
          <div className="feature">
            <h3>Powered by Ollama, Render, and Ngrok</h3>
            <p>
              React frontend on Render connects to Flask backend on Render,
              which tunnels to self-hosted Ollama server via Ngrok{" "}
            </p>
          </div>
          <div className="feature">
            <h3>Multiple Models</h3>
            <p>Switch between different LLMs available on the server</p>
          </div>
          <div className="feature">
            <h3>Tech Stack</h3>
            <p>Built with React, FastAPI, and Python</p>
          </div>
          <div className="feature">
            <h3>Includes popular LLM models</h3>
            <p>
              deekseep-r1.5b, llama3.1:latest, llama3.2:latest, dolphin3:latest
            </p>
          </div>
          <div className="feature">
            <h3>Note</h3>
            <p>Server may need a moment to wake up on first use</p>
          </div>
        </div>

        <button className="start-button" onClick={onStart}>
          Start Chatting
        </button>

        <div className="landing-footer">
          <p>
            Built by Angel Gutierrez •{" "}
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
