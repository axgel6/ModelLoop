import { useEffect, useState } from "react";
import {
  apiHealth,
  apiLogin,
  apiRegister,
  scheduleProactiveRefresh,
} from "./api";
import ConnectionBanner from "./ConnectionBanner";
import { StretchyLogo } from "./StretchyLogo";
import { type Theme } from "./ChatPreferences";
import HowItWorksModal from "./HowItWorksModal";
import { Notice } from "./Notice";
import ThemePickerModal from "./ThemePickerModal";
import { hasGuestConversation } from "./guestConversation";

// How long a sign-up-only field takes to slide shut (matches .login-collapse in App.css)
const COLLAPSE_MS = 380;

// Slides a sign-up-only field open or shut as the mode changes. Once shut, the field leaves
// the page: password managers treat a form with a hidden "new password" box as a sign-up
// form and stop filling the saved password. `inert` keeps a closing field out of reach.
function Collapse({ open, children }: { open: boolean; children: React.ReactNode }) {
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);

  useEffect(() => {
    if (open) return;
    const t = setTimeout(() => setMounted(false), COLLAPSE_MS);
    return () => clearTimeout(t);
  }, [open]);

  return (
    <div className={`login-collapse${open ? " is-open" : ""}`} inert={!open}>
      <div className="login-collapse-inner">{mounted && children}</div>
    </div>
  );
}

interface LoginProps {
  onLogin: () => void;
  onGuest: () => void;
  onTerms: () => void;
  theme: Theme;
  onThemeChange: (t: Theme) => void;
}

// Matches the backend (schemas.py Username); it lowercases before saving
const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,30}$/;

function Login({ onLogin, onGuest, onTerms, theme, onThemeChange }: LoginProps) {
  const [mode, setMode] = useState<"login" | "register">("login");
  // Sign in takes a username or email; sign up takes a username, plus an optional email
  const [identifier, setIdentifier] = useState("");
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  // One password box with a reveal toggle, in place of typing it twice
  const [showPassword, setShowPassword] = useState(false);
  const [howOpen, setHowOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  // A guest who came here from their chat goes back to it, not to a fresh one
  const [returningGuest] = useState(hasGuestConversation);
  const [error, setError] = useState("");
  // Counts failed tries, so the same mistake twice shakes the notice again
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(false);
  const [isConnected, setIsConnected] = useState(false);

  // Poll backend health every 5s until connected, then stop
  useEffect(() => {
    const check = async () => {
      const ok = await apiHealth();
      if (ok) {
        setIsConnected(true);
        clearInterval(interval);
      }
    };

    // Started before the first check, so a check that finds the backend up can always stop it
    const interval = setInterval(check, 5000);
    check();
    return () => clearInterval(interval);
  }, []);

  const isLogin = mode === "login";

  // ----- Handlers -----

  const fail = (message: string) => {
    setError(message);
    setAttempt((n) => n + 1);
  };

  const handleSubmit = async () => {
    setError("");

    if (!identifier.trim() || !password.trim()) {
      fail(isLogin ? "Add your username and password to continue." : "Pick a username and password to continue.");
      return;
    }

    if (!isLogin && !USERNAME_PATTERN.test(identifier.trim())) {
      fail("Usernames are 3 to 30 letters, numbers, or underscores.");
      return;
    }

    if (!isLogin && password.length < 8) {
      fail("Your password needs at least 8 characters.");
      return;
    }

    if (!isLogin && !fullName.trim()) {
      fail("What should we call you? Add a name to continue.");
      return;
    }

    setLoading(true);
    try {
      const { token, refresh_token } = isLogin
        ? await apiLogin(identifier.trim(), password)
        : await apiRegister(identifier.trim(), password, fullName.trim(), email.trim());

      localStorage.setItem("token", token);
      localStorage.setItem("refresh_token", refresh_token);
      scheduleProactiveRefresh();
      onLogin();
    } catch (err) {
      fail(err instanceof Error ? err.message : "That didn't go through. Want to try again?");
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
    setEmail("");
    setPassword("");
    setShowPassword(false);
  };

  return (
    <>
      {!isConnected && <ConnectionBanner />}
      {/* One centered column on the page itself, no card: the wordmark, the fields, the two
          ways in, and a single line to switch between signing in and signing up. Labels are
          kept for screen readers; the placeholders carry them on screen. */}
      <div className="login-container">
        <div className="login-stack">
          <div className="login-header">
            <h1 className="login-logo">
              <StretchyLogo stacked={false} />
            </h1>
            <p key={mode} className="login-subtitle login-swap">
              {isLogin ? "Pick up where you left off." : "Save your chats, themes, and games."}
            </p>
          </div>

          <div className="login-form">
            <Collapse open={!isLogin}>
              <div className="login-field">
                <label htmlFor="fullName" className="login-sr-only">Name</label>
                <input
                  id="fullName"
                  type="text"
                  placeholder="Name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={loading}
                  autoComplete="name"
                  required
                />
              </div>
            </Collapse>
            <div className="login-field">
              <label htmlFor="identifier" className="login-sr-only">
                {isLogin ? "Username or email" : "Username"}
              </label>
              <input
                id="identifier"
                type="text"
                placeholder={isLogin ? "Username or email" : "Username"}
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={loading}
                autoFocus
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={isLogin ? 254 : 30}
              />
            </div>

            <Collapse open={!isLogin}>
              <div className="login-field">
                <label htmlFor="email" className="login-sr-only">Email (optional)</label>
                <input
                  id="email"
                  type="email"
                  placeholder="Email (optional)"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={loading}
                  autoComplete="email"
                />
              </div>
            </Collapse>

            <div className="login-field">
              <label htmlFor="password" className="login-sr-only">Password</label>
              <div className="login-password">
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder={isLogin ? "Password" : "Password, 8 or more characters"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={loading}
                  autoComplete={isLogin ? "current-password" : "new-password"}
                />
                <button
                  type="button"
                  className="login-reveal-btn"
                  onClick={() => setShowPassword((v) => !v)}
                  disabled={loading}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-pressed={showPassword}
                  title={showPassword ? "Hide password" : "Show password"}
                >
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
                    <circle cx="12" cy="12" r="3" />
                    {showPassword && <line x1="3" y1="3" x2="21" y2="21" />}
                  </svg>
                </button>
              </div>
            </div>

            <button
              className="login-submit"
              onClick={handleSubmit}
              disabled={loading}
            >
              {loading ? (
                <span className="btn-spinner" />
              ) : (
                <span key={mode} className="login-swap">
                  {isLogin ? "Sign in" : "Create account"}
                </span>
              )}
            </button>

            <button
              className="login-guest-btn"
              onClick={onGuest}
              disabled={loading}
            >
              {returningGuest ? "Back to chat" : "Continue as guest"}
            </button>
          </div>

          <p className="login-toggle">
            <span key={mode} className="login-swap">
              {isLogin ? "New here?" : "Have an account?"}
            </span>{" "}
            <button
              className="login-toggle-btn"
              onClick={switchMode}
              disabled={loading}
            >
              <span key={mode} className="login-swap">
                {isLogin ? "Create an account" : "Sign in"}
              </span>
            </button>
          </p>
        </div>

        <nav className="login-footer" aria-label="About ModelLoop">
          <button type="button" className="login-footer-link" onClick={() => setHowOpen(true)}>
            How it works
          </button>
          <button type="button" className="login-footer-link" onClick={onTerms}>
            Terms
          </button>
          <a
            className="login-footer-link"
            href="https://github.com/axgel6"
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub
          </a>
          <button type="button" className="login-footer-link" onClick={() => setThemeOpen(true)}>
            Theme
          </button>
        </nav>
      </div>

      <Notice
        message={error}
        kicker={isLogin ? "Sign in" : "Sign up"}
        shake={attempt}
        onDone={() => setError("")}
      />
      {howOpen && <HowItWorksModal onClose={() => setHowOpen(false)} />}
      {themeOpen && (
        <ThemePickerModal
          theme={theme}
          onThemeChange={onThemeChange}
          onClose={() => setThemeOpen(false)}
        />
      )}
    </>
  );
}

export default Login;
