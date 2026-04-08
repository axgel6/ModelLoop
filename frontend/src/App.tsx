import { useEffect, useState } from "react";
import "./App.css";
import LandingPage from "./components/LandingPage";
import Chat from "./components/Chat";
import Login from "./components/Login";
import { apiListChats, apiLogout, setUnauthorizedHandler, type ChatMeta } from "./components/api";

type View = "landing" | "login" | "chat";
type Theme = "glass" | "flat";

function App() {
  // Sets view to login page or chat based on presence of JWT token in localStorage
  const [view, setView] = useState<View>(
    localStorage.getItem("token") ? "chat" : "landing",
  );
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [isGuest, setIsGuest] = useState(false);
  const [chats, setChats] = useState<ChatMeta[]>([]);
  const [chatsLoading, setChatsLoading] = useState(false);

  const refreshChats = async () => {
    setChatsLoading(true);
    try {
      setChats(await apiListChats());
    } catch { /* ignore */ }
    finally { setChatsLoading(false); }
  };

  // Pre-fetch chat list whenever the user enters chat view
  useEffect(() => {
    if (view === "chat" && !isGuest) refreshChats();
  }, [view, isGuest]);

  const [theme, setTheme] = useState<Theme>(() => {
    const stored = localStorage.getItem("theme");
    return (stored === "glassy" ? "glass" : stored as Theme) || "glass";
  });

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

  const handleChatsChanged = () => refreshChats();

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
          chats={chats}
          chatsLoading={chatsLoading}
          onChatsChanged={handleChatsChanged}
          isGuest={isGuest}
          theme={theme}
          setTheme={setTheme}
        />
      )}
    </>
  );
}

export default App;
