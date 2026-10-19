import { useEffect, useState } from "react";
import "./App.css";
import WelcomePage from "./components/WelcomePage";
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
  scheduleProactiveRefresh,
  cancelProactiveRefresh,
  type ChatMeta,
} from "./components/api";
import { type Theme, type Font } from "./components/ChatPreferences";
import { useRoute } from "./router";
import { chatIdFromPath } from "./subroute";
import { dayPart } from "./components/utils/chatUtils";
import { background } from "./background";
import { halloweenOpen } from "./season";

const IS_DOWN = import.meta.env.VITE_IS_DOWN === "true";

const THEME_TO_DATA: Record<Theme, string> = {
  ember: "ember",
  frost: "frost",
  dune: "dune",
  meadow: "meadow",
  // Halloween is Frost's layout in its own colours (see themes/halloween.css), so it sets
  // data-theme="frost" and adds data-festive, which only its own rules look for
  halloween: "frost",
};

const FESTIVE: Partial<Record<Theme, string>> = { halloween: "halloween" };

function App() {
  // The URL decides the view; a bare "/" falls back to the session (chat when signed in).
  const [view, setView] = useRoute(
    localStorage.getItem("token") ? "chat" : "welcome",
  );
  const [activeChatId, setActiveChatId] = useState<string | null>(() => chatIdFromPath());
  const [isGuest, setIsGuest] = useState(false);
  const [chats, setChats] = useState<ChatMeta[]>([]);
  const [chatsLoading, setChatsLoading] = useState(false);

  const refreshChats = async () => {
    setChatsLoading(true);
    try {
      const list = await apiListChats();
      setChats(list);
      // A chat named in the address bar that is not yours, or no longer exists, opens nothing
      setActiveChatId((id) => (id && !list.some((c) => c.id === id) ? null : id));
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
    const valid: Theme[] = ["ember", "frost", "dune", "meadow", "halloween"];
    // Ember was called Gruvbox, and had variants before that. Anything else that is
    // no longer a theme (the retired Ocean theme) falls through to the default.
    if (
      stored === "glass" ||
      stored === "gruvbox-glass" ||
      stored === "flat" ||
      stored === "gruvbox-flat" ||
      stored === "gruvbox"
    )
      return "ember";
    if (stored === "halloween" && !halloweenOpen()) return "frost"; // its season is over
    return valid.includes(stored as Theme) ? (stored as Theme) : "meadow";
  });

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = THEME_TO_DATA[theme];
    const festive = FESTIVE[theme];
    if (festive) root.dataset.festive = festive;
    else delete root.dataset.festive;
    localStorage.setItem("theme", theme);
    // A festive theme's background only shows with that theme, so the choice is put back on
    // the page each time the theme changes
    background.init();
  }, [theme]);

  // Lets the Meadow background follow the day (see "Meadow through the day" in App.css).
  useEffect(() => {
    const apply = () => {
      document.documentElement.dataset.daypart = dayPart();
    };
    apply();
    const timer = setInterval(apply, 5 * 60 * 1000);
    return () => clearInterval(timer);
  }, []);

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
    return stored === "mono" || stored === "inter" ? stored : "rounded";
  });


  const [avatarColor, setAvatarColorState] = useState<string | null>(() =>
    localStorage.getItem("avatar_color"),
  );

  const applyAvatarColor = (color: string | null) => {
    setAvatarColorState(color);
    if (color) localStorage.setItem("avatar_color", color);
    else localStorage.removeItem("avatar_color");
  };

  // Saved to the account, so the icon is the same on every device
  const handleSetAvatarColor = (color: string | null) => {
    applyAvatarColor(color);
    if (localStorage.getItem("token")) {
      apiUpdatePreferences({ avatar_color: color ?? "" }).catch(() => {});
    }
  };

  // The account's color wins. An account without one takes the color this browser already had,
  // which is how a color picked before it was saved to the account carries over.
  const syncAvatarColor = (saved: string | null) => {
    if (saved) {
      applyAvatarColor(saved);
      return;
    }
    const local = localStorage.getItem("avatar_color");
    if (local) apiUpdatePreferences({ avatar_color: local }).catch(() => {});
  };

  // Already signed in from an earlier visit: pick up a color changed on another device
  useEffect(() => {
    if (!localStorage.getItem("token")) return;
    apiGetMe()
      .then((me) => syncAvatarColor(me.avatar_color))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (font !== "mono") {
      document.documentElement.dataset.font = font;
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
    cancelProactiveRefresh();
    apiLogout();
    localStorage.removeItem("theme_user_set");
    localStorage.removeItem("font_user_set");
    // It lives on the account now; left here, the next account to sign in would take it
    applyAvatarColor(null);
    setActiveChatId(null);
    const wasGuest = isGuest;
    setIsGuest(false);
    setView(wasGuest ? "login" : "welcome");
  };

  // Register the unauthorized handler so the refresh interceptor can trigger logout
  useEffect(() => {
    setUnauthorizedHandler(handleLogout);
  });

  // Keep an existing session alive across reloads: renew before the access token expires
  // rather than waiting for a wave of 401s.
  useEffect(() => {
    if (localStorage.getItem("token")) scheduleProactiveRefresh();
    return cancelProactiveRefresh;
  }, []);

  const handleLogin = async () => {
    setIsGuest(false);
    scheduleProactiveRefresh();
    try {
      const me = await apiGetMe();
      syncAvatarColor(me.avatar_color);
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
        const validThemes: Theme[] = ["ember", "frost", "dune", "meadow", "halloween"];
        const validFonts: Font[] = ["mono", "inter", "rounded"];
        // Accounts saved before the rename still say "gruvbox".
        let savedTheme = me.theme === "gruvbox" ? "ember" : me.theme;
        if (savedTheme === "halloween" && !halloweenOpen()) savedTheme = "frost"; // its season is over
        if (validThemes.includes(savedTheme as Theme)) setTheme(savedTheme as Theme);
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
        <TermsOfService onBack={() => setView("welcome")} />
      ) : view === "login" ? (
        <Login
          onLogin={handleLogin}
          onGuest={handleGuest}
          onBack={() => setView("welcome")}
        />
      ) : view === "welcome" ? (
        <WelcomePage
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
          onBack={() => setView("welcome")}
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
          avatarColor={avatarColor}
          setAvatarColor={handleSetAvatarColor}
        />
      )}
    </>
  );
}

export default App;
