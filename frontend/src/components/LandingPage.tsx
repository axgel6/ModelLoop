interface LandingPageProps {
  onStart: () => void;
}

function LandingPage({ onStart }: LandingPageProps) {
  return (
    <div className="landing-page">
      <div className="landing-content">
        <h1>ModelLoop</h1>
        <p className="landing-tagline">Self-hosted AI chat powered by Ollama</p>

        <div className="landing-features">
          <div className="feature">
            <h3>Powered by Ollama</h3>
            <p>Self-hosted AI chat experience</p>
          </div>
          <div className="feature">
            <h3>Multiple Models</h3>
            <p>Choose from various LLMs running locally</p>
          </div>
          <div className="feature">
            <h3>Ongoing Development</h3>
            <p>Built with React, Flask, and Python</p>
          </div>
          <div className="feature">
            <h3>Warning</h3>
            <p>Backend is hosted on Render so it may take some time to load</p>
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
        </div>
      </div>
    </div>
  );
}

export default LandingPage;
