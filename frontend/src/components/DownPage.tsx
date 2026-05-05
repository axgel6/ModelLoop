function DownPage() {
  return (
    <div className="down-page">
      <div className="down-content">
        <div className="down-icon">⚙</div>
        <h1>ModelLoop is Down</h1>
        <p className="down-subtitle">
          We're currently performing maintenance or experiencing an outage.
        </p>
        <p className="down-body">
          The service will be back online shortly. Thank you for your patience.
        </p>
        <div className="down-footer">
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
