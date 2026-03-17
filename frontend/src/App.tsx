import { useState } from "react";
import "./App.css";
import LandingPage from "./components/LandingPage";
import Chat from "./components/Chat";
import Login from "./components/Login";

type View = "landing" | "login" | "chat";

function App() {
  // Sets view to login page or chat based on presence of JWT token in localStorage
  const [view, setView] = useState<View>(
    localStorage.getItem("token") ? "chat" : "landing",
  );
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [isGuest, setIsGuest] = useState(false);

  // ----- Auth Handlers -----

  const handleLogin = () => {
    // Token is already stored in localStorage by Login.tsx before this is called
    setIsGuest(false);
    setView("chat");
  };

  const handleGuest = () => {
    setIsGuest(true);
    setView("chat");
  };

  const handleLogout = () => {
    localStorage.removeItem("token");
    setActiveChatId(null);
    const wasGuest = isGuest;
    setIsGuest(false);
    setView(wasGuest ? "login" : "landing");
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
        />
      )}
    </>
  );
}

export default App;
