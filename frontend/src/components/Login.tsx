import { useEffect, useState } from "react";
import { apiHealth, apiLogin, apiRegister } from "./api";
import ConnectionBanner from "./ConnectionBanner";

interface LoginProps {
  onLogin: () => void;
  onGuest: () => void;
  onBack: () => void;
}

function Login({ onLogin, onGuest, onBack }: LoginProps) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [isConnected, setIsConnected] = useState(false);

  // Poll backend health every 5s until connected, then stop
  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;

    const check = async () => {
      const ok = await apiHealth();
      if (ok) {
        setIsConnected(true);
        clearInterval(interval);
      }
    };

    check();
    interval = setInterval(check, 5000);
    return () => clearInterval(interval);
  }, []);

  const isLogin = mode === "login";

  // ----- Handlers -----

  const handleSubmit = async () => {
    setError("");

    if (!email.trim() || !password.trim()) {
      setError("Email and password are required.");
      return;
    }

    if (!isLogin && password !== confirm) {
      setError("Passwords do not match.");
      return;
    }

    if (!isLogin && password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    if (!isLogin && !fullName.trim()) {
      setError("Name is required.");
      return;
    }

    setLoading(true);
    try {
      const { token, refresh_token } = isLogin
        ? await apiLogin(email.trim(), password)
        : await apiRegister(email.trim(), password, fullName.trim());

      localStorage.setItem("token", token);
      localStorage.setItem("refresh_token", refresh_token);
      onLogin();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSubmit();
  };

  const switchMode = () => {
    setMode(isLogin ? "register" : "login");
    setError("");
    setFullName("");
    setPassword("");
    setConfirm("");
  };

  return (
    <>
      {!isConnected && <ConnectionBanner />}
      <div className="login-container">
        <div className="login-card">
          <button className="back-to-landing" onClick={onBack}>
            ←
          </button>

          <div className="login-header">
            <h1 className="login-logo">ModelLoop</h1>
            <p className="login-subtitle">
              {isLogin ? "Sign in to continue" : "Create an account"}
            </p>
          </div>

          <div className="login-form">
            {!isLogin && (
              <div className="login-field">
                <label htmlFor="fullName">Name</label>
                <input
                  id="fullName"
                  type="text"
                  placeholder="Your name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={loading}
                  autoComplete="name"
                  required
                />
              </div>
            )}
            <div className="login-field">
              <label htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={loading}
                autoFocus
                autoComplete="email"
              />
            </div>

            <div className="login-field">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                placeholder={
                  isLogin ? "Enter your password" : "Min. 8 characters"
                }
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={loading}
                autoComplete={isLogin ? "current-password" : "new-password"}
              />
            </div>

            {!isLogin && (
              <div className="login-field">
                <label htmlFor="confirm">Confirm Password</label>
                <input
                  id="confirm"
                  type="password"
                  placeholder="Re-enter your password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={loading}
                  autoComplete="new-password"
                />
              </div>
            )}

            {error && <p className="login-error">{error}</p>}

            <button
              className="login-submit"
              onClick={handleSubmit}
              disabled={loading}
            >
              {loading ? <span className="btn-spinner" /> : isLogin ? "Sign In" : "Create Account"}
            </button>
          </div>

          <p className="login-toggle">
            {isLogin ? "Don't have an account?" : "Already have an account?"}{" "}
            <button
              className="login-toggle-btn"
              onClick={switchMode}
              disabled={loading}
            >
              {isLogin ? "Sign up" : "Sign in"}
            </button>
          </p>

          <div className="login-divider">
            <span>or</span>
          </div>

          <button
            className="login-guest-btn"
            onClick={onGuest}
            disabled={loading}
          >
            Continue without signing in
          </button>
        </div>
      </div>
    </>
  );
}

export default Login;
