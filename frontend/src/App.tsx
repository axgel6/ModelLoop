import { useEffect, useState } from "react";
import "./App.css";
import LandingPage from "./components/LandingPage";
import Chat from "./components/Chat";
import Login from "./components/Login";
import DownPage from "./components/DownPage";
import TermsOfService from "./components/TermsOfService";
import {
  apiListChats,
  apiLogout,
  setUnauthorizedHandler,
  type ChatMeta,
} from "./components/api";
import { type Theme } from "./components/ChatPreferences";

const IS_DOWN = import.meta.env.VITE_IS_DOWN === "true";

type View = "landing" | "login" | "chat" | "terms";

const THEME_TO_DATA: Record<Theme, string> = {
  "ocean-glass": "ocean",
  "gruvbox-flat": "flat",
};

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
    } catch {
      /* ignore */
    } finally {
      setChatsLoading(false);
    }
  };

  // Pre-fetch chat list whenever the user enters chat view
  useEffect(() => {
    if (view === "chat" && !isGuest) refreshChats();
  }, [view, isGuest]);

  const [theme, setTheme] = useState<Theme>(() => {
    const stored = localStorage.getItem("theme");
    const valid: Theme[] = ["ocean-glass", "gruvbox-flat"];
    // Migrate old theme keys to the two remaining themes
    if (
      stored === "ocean" ||
      stored === "ocean-glass" ||
      stored === "ocean-flat" ||
      stored === "glassy"
    )
      return "ocean-glass";
    if (
      stored === "glass" ||
      stored === "gruvbox-glass" ||
      stored === "flat" ||
      stored === "gruvbox-flat"
    )
      return "gruvbox-flat";
    return valid.includes(stored as Theme) ? (stored as Theme) : "gruvbox-flat";
  });

  useEffect(() => {
    document.documentElement.dataset.theme = THEME_TO_DATA[theme];
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
  // Empty string resets to "no active chat" so the next message starts a fresh one.
  // If chat metadata is provided, insert it immediately so sidebar updates instantly.
  const handleChatCreated = (chatId: string, chatMeta?: ChatMeta) => {
    if (chatMeta) {
      setChats((prev) => [
        chatMeta,
        ...prev.filter((c) => c.id !== chatMeta.id),
      ]);
    }
    setActiveChatId(chatId || null);
  };

  const handleChatsChanged = () => refreshChats();

  if (IS_DOWN) return <DownPage />;

  return (
    <>
      {view === "terms" ? (
        <TermsOfService onBack={() => setView("landing")} />
      ) : view === "login" ? (
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
          onTerms={() => setView("terms")}
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
