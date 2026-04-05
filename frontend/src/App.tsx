import { useEffect, useState } from "react";
import "./App.css";
import LandingPage from "./components/LandingPage";
import Chat from "./components/Chat";
import Login from "./components/Login";
import { apiLogout, setUnauthorizedHandler } from "./components/api";

type View = "landing" | "login" | "chat";
type Theme = "glassy" | "flat";

function App() {
  // Sets view to login page or chat based on presence of JWT token in localStorage
  const [view, setView] = useState<View>(
    localStorage.getItem("token") ? "chat" : "landing",
  );
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [isGuest, setIsGuest] = useState(false);

  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem("theme") as Theme) || "flat",
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("theme", theme);
  }, [theme]);

  // ----- Auth Handlers -----

  const handleLogout = () => {
    apiLogout();
    setActiveChatId(null);
    const wasGuest = isGuest;
    setIsGuest(false);
    setView(wasGuest ? "login" : "landing");
  };

  // Register the unauthorized handler so the refresh interceptor can trigger logout
  useEffect(() => {
    setUnauthorizedHandler(handleLogout);
  });

  const handleLogin = () => {
    // Token is already stored in localStorage by Login.tsx before this is called
    setIsGuest(false);
    setView("chat");
  };

  const handleGuest = () => {
    setIsGuest(true);
    setView("chat");
  };

  // ----- Chat Handlers -----

  // Called by Chat when a new chat is created or the user selects one from History.
  // Empty string resets to "no active chat" so the next message starts a fresh one
  const handleChatCreated = (chatId: string) => {
    setActiveChatId(chatId || null);
  };

  // Incrementing this key forces History to remount and re-fetch after any chat change
  const [historyKey, setHistoryKey] = useState(0);
  const handleChatsChanged = () => setHistoryKey((k) => k + 1);

  return (
    <>
      {view === "login" ? (
        <Login
          onLogin={handleLogin}
          onGuest={handleGuest}
          onBack={() => setView("landing")}
        />
      ) : view === "landing" ? (
        <LandingPage
          onStart={() => {
            // If already logged in go straight to chat, otherwise require login
            if (localStorage.getItem("token")) {
              setView("chat");
            } else {
              setView("login");
            }
          }}
        />
      ) : (
        <Chat
          onBack={() => setView("landing")}
          onLogout={handleLogout}
          activeChatId={activeChatId}
          onChatCreated={handleChatCreated}
          onChatsChanged={handleChatsChanged}
          historyKey={historyKey}
          isGuest={isGuest}
          theme={theme}
          setTheme={setTheme}
        />
      )}
    </>
  );
}

export default App;
