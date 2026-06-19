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
  apiGetMe,
  apiUpdatePreferences,
  setUnauthorizedHandler,
  type ChatMeta,
} from "./components/api";
import { type Theme, type Font, type TextSize } from "./components/ChatPreferences";

const IS_DOWN = import.meta.env.VITE_IS_DOWN === "true";

type View = "landing" | "login" | "chat" | "terms";

const THEME_TO_DATA: Record<Theme, string> = {
  ocean: "ocean",
  gruvbox: "gruvbox",
  dune: "dune",
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
    const valid: Theme[] = ["ocean", "gruvbox", "dune"];
    // Migrate old theme keys to the two remaining themes
    if (
      stored === "ocean" ||
      stored === "ocean-glass" ||
      stored === "ocean-flat" ||
      stored === "glassy"
    )
      return "ocean";
    if (
      stored === "glass" ||
      stored === "gruvbox-glass" ||
      stored === "flat" ||
      stored === "gruvbox-flat" ||
      stored === "gruvbox"
    )
      return "gruvbox";
    return valid.includes(stored as Theme) ? (stored as Theme) : "ocean";
  });

  useEffect(() => {
    document.documentElement.dataset.theme = THEME_TO_DATA[theme];
    localStorage.setItem("theme", theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.dataset.view = view;
    return () => {
      if (document.documentElement.dataset.view === view) {
        delete document.documentElement.dataset.view;
      }
    };
  }, [view]);

  const [font, setFont] = useState<Font>(() => {
    const stored = localStorage.getItem("font");
    return stored === "mono" ? "mono" : "inter";
  });

  const [textSize, setTextSizeState] = useState<TextSize>(() => {
    const stored = localStorage.getItem("text_size");
    return (["xs", "small", "medium", "large"] as TextSize[]).includes(stored as TextSize)
      ? (stored as TextSize)
      : "medium";
  });

  const setTextSize = (size: TextSize) => {
    setTextSizeState(size);
    localStorage.setItem("text_size", size);
    if (size === "medium") {
      delete document.documentElement.dataset.textSize;
    } else {
      document.documentElement.dataset.textSize = size;
    }
  };

  useEffect(() => {
    if (textSize === "medium") {
      delete document.documentElement.dataset.textSize;
    } else {
      document.documentElement.dataset.textSize = textSize;
    }
  }, []);

  const [avatarColor, setAvatarColorState] = useState<string | null>(() =>
    localStorage.getItem("avatar_color"),
  );

  const handleSetAvatarColor = (color: string | null) => {
    setAvatarColorState(color);
    if (color) localStorage.setItem("avatar_color", color);
    else localStorage.removeItem("avatar_color");
  };

  useEffect(() => {
    if (font === "inter") {
      document.documentElement.dataset.font = "inter";
    } else {
      delete document.documentElement.dataset.font;
    }
    localStorage.setItem("font", font);
  }, [font]);

  const handleSetTheme = (t: Theme) => {
    setTheme(t);
    localStorage.setItem("theme_user_set", "true");
    if (localStorage.getItem("token")) {
      apiUpdatePreferences({ theme: t }).catch(() => {});
    }
  };

  const handleSetFont = (f: Font) => {
    setFont(f);
    localStorage.setItem("font_user_set", "true");
    if (localStorage.getItem("token")) {
      apiUpdatePreferences({ font: f }).catch(() => {});
    }
  };

  // ----- Auth Handlers -----

  const handleLogout = () => {
    apiLogout();
    localStorage.removeItem("theme_user_set");
    localStorage.removeItem("font_user_set");
    setActiveChatId(null);
    const wasGuest = isGuest;
    setIsGuest(false);
    setView(wasGuest ? "login" : "landing");
  };

  // Register the unauthorized handler so the refresh interceptor can trigger logout
  useEffect(() => {
    setUnauthorizedHandler(handleLogout);
  });

  const handleLogin = async () => {
    setIsGuest(false);
    try {
      const me = await apiGetMe();
      const themeUserSet = localStorage.getItem("theme_user_set") === "true";
      const fontUserSet = localStorage.getItem("font_user_set") === "true";

      if (themeUserSet || fontUserSet) {
        // User changed preferences while logged out — push local to DB
        const patch: { theme?: string; font?: string } = {};
        if (themeUserSet) patch.theme = localStorage.getItem("theme") ?? undefined;
        if (fontUserSet) patch.font = localStorage.getItem("font") ?? undefined;
        await apiUpdatePreferences(patch).catch(() => {});
      } else {
        // No local changes — apply DB preferences
        const validThemes: Theme[] = ["ocean", "gruvbox", "dune"];
        const validFonts: Font[] = ["mono", "inter"];
        if (validThemes.includes(me.theme as Theme)) setTheme(me.theme as Theme);
        if (validFonts.includes(me.font as Font)) setFont(me.font as Font);
      }
    } catch {
      // If /me fails just proceed normally
    }
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
          theme={theme}
          onThemeChange={handleSetTheme}
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
          setTheme={handleSetTheme}
          font={font}
          setFont={handleSetFont}
          textSize={textSize}
          setTextSize={setTextSize}
          avatarColor={avatarColor}
          setAvatarColor={handleSetAvatarColor}
        />
      )}
    </>
  );
}

export default App;
