import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { haptics } from "../haptics";
import { sounds } from "../sounds";
import { uiScale } from "../uiScale";
import { festiveTheme } from "../festive";
import ChatPreferences, {
  type Theme,
  type Font,
  type Section as PrefSection,
} from "./ChatPreferences";
import ChatInput from "./ChatInput";
import { useChatSession } from "./hooks/useChatSession";
import { useChatSettings } from "./hooks/useChatSettings";
import { useChatUI } from "./hooks/useChatUI";
import { useVoiceConversation } from "./hooks/useVoiceConversation";
import {
  apiChatStream,
  apiGetProject,
  apiGetProjectVersion,
  apiReportProjectCheck,
  apiRestoreProjectVersion,
  type StoredProject,
  apiCreateChat,
  apiDeleteAccount,
  apiDeleteChat,
  apiGetMe,
  apiGetMyFeatures,
  apiGetGuestFeatures,
  apiGetLimits,
  apiGuestChatStream,
  apiPrivateChatStream,
  apiListDocuments,
  apiUploadDocument,
  apiDeleteDocument,
  apiRenameChat,
  type ChatMeta,
  type DocumentMeta,
  type Message,
  type RateLimits,
} from "./api";
import { AssistantMessage, UserMessage } from "./MessageList";
import {
  chatInteractionReducer,
  initialChatInteractionState,
  type EditState,
  type RenameState,
} from "./chatReducer";
import {
  formatDate,
  pickSuggestions,
  greetingLines,
  PERSONALITY_TIP,
  timeGreeting,
  friendlyError,
  readableTextOn,
  withMandatoryPromptRules,
  toLyricText,
} from "./utils/chatUtils";
import ConnectionBanner from "./ConnectionBanner";
import { StretchyLogo } from "./StretchyLogo";
import { GamesHub, GamesIcon } from "../games/GamesHub";
import { inGamesPath, replacePath } from "../subroute";
import { FocusedReaderMenu } from "./FocusedReaderMenu";
import { VoiceMatrix } from "./VoiceMatrix";
import {
  PROJECT_TOOL_PHRASES,
  WebDevContext,
  timeAgo,
  withLiveFiles,
  type LiveFiles,
  type StudioMessage,
  type StudioProject,
  type WebDevContextValue,
} from "../webdev/context";
import { WebDevStudio } from "../webdev/WebDevStudio";
import { runPreviewCheck } from "../webdev/check";
import { READER_SIZES, useReaderPrefs } from "./readerPrefs";
import { splitParas, useFocusedNav } from "./useFocusedNav";

// ── Sidebar chat item ─────────────────────────────────────────────────────────

interface SidebarChatItemProps {
  c: ChatMeta;
  activeChatId: string | null;
  pinned: boolean;
  deleting: boolean;
  onSelect: () => void;
  onPin: (e: React.MouseEvent) => void;
  onDelete: (e: React.MouseEvent) => void;
}

function SidebarChatItem({
  c,
  activeChatId,
  pinned,
  deleting,
  onSelect,
  onPin,
  onDelete,
}: SidebarChatItemProps) {
  return (
    <div
      className={`sidebar-chat-item${c.id === activeChatId ? " active" : ""}${pinned ? " pinned" : ""}`}
      onClick={onSelect}
    >
      <div className="sidebar-chat-info">
        <span className="sidebar-chat-title">
          {c.title || "Untitled"}
        </span>
        <span className="sidebar-chat-date">{formatDate(c.updated_at)}</span>
      </div>
      <button
        className="sidebar-pin-btn"
        onClick={onPin}
        title={pinned ? "Unpin chat" : "Pin chat"}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill={pinned ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <line x1="12" y1="17" x2="12" y2="22" />
          <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z" />
        </svg>
      </button>
      <button
        className="sidebar-delete-btn"
        onClick={onDelete}
        disabled={deleting}
        title="Delete chat"
      >
        {deleting ? (
          "…"
        ) : (
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        )}
      </button>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface ChatProps {
  onBack: () => void;
  activeChatId: string | null;
  onChatCreated: (chatId: string, chatMeta?: ChatMeta) => void;
  onChatsChanged: () => void | Promise<void>;
  onLogout: () => void;
  chats: ChatMeta[];
  chatsLoading: boolean;
  isGuest: boolean;
  theme: Theme;
  setTheme: (theme: Theme) => void;
  font: Font;
  setFont: (font: Font) => void;
  avatarColor: string | null;
  setAvatarColor: (c: string | null) => void;
}

function Chat({
  onBack,
  activeChatId,
  onChatCreated,
  onChatsChanged,
  onLogout,
  chats,
  chatsLoading,
  isGuest,
  theme,
  setTheme,
  font,
  setFont,
  avatarColor,
  setAvatarColor,
}: ChatProps) {
  const [isMobileViewport, setIsMobileViewport] = useState(
    () => window.innerWidth <= 640,
  );

  useEffect(() => {
    const onResize = () => setIsMobileViewport(window.innerWidth <= 640);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const {
    messages,
    setMessages,
    loading,
    setLoading,
    isThinking,
    setIsThinking,
    messagesLoading,
    messageCache,
    abortControllerRef,
    activeChatIdRef,
    justCreatedChatRef,
  } = useChatSession(activeChatId);

  const {
    models,
    modelCapabilities,
    gameModel,
    setGameModel,
    studioModel,
    setStudioModel,
    serverDefaults,
    thinking,
    setThinking,
    selectedModel,
    setSelectedModel,
    isConnected,
    systemPrompt,
    setSystemPrompt,
    showPreferences,
    setShowPreferences,
    activePreset,
    setActivePreset,
    temperature,
    setTemperature,
    topP,
    setTopP,
    numPredict,
    setNumPredict,
    speechRate,
    setSpeechRate,
  } = useChatSettings();
  // Thinking is offered only for a model that can do it, as Ollama reports
  const canThink = (modelCapabilities[selectedModel] ?? []).includes("thinking");
  // A section to open Preferences on; none opens the list of sections on phones, Model elsewhere
  const [prefSection, setPrefSection] = useState<PrefSection | undefined>(undefined);

  const {
    sidebarOpen,
    setSidebarOpen,
    historySearch,
    setHistorySearch,
    showSearch,
    setShowSearch,
    showLogoutConfirm,
    setShowLogoutConfirm,
    showScrollBtn,
    messagesContainerRef,
    scrollToBottom,
  } = useChatUI(messages, loading);

  const [sidebarClosing, setSidebarClosing] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  // Escape closes the account menu
  useEffect(() => {
    if (!showUserMenu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowUserMenu(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showUserMenu]);
  // A refresh on /games/... comes back to the games
  const [showGames, setShowGames] = useState(() => inGamesPath());
  // Bumped on every click of the sidebar's Games entry, which remounts the hub
  const [gamesVisit, setGamesVisit] = useState(0);
  // A private chat is never saved: it lives only on screen, and a refresh ends it
  const [privateMode, setPrivateMode] = useState(false);
  // Opening a saved chat leaves private mode
  useEffect(() => {
    if (activeChatId) setPrivateMode(false);
  }, [activeChatId]);

  // The address bar follows what is on screen, so a refresh lands back here. Inside the games,
  // the hub and each game keep their own deeper part of the path.
  useEffect(() => {
    if (showGames) {
      if (!inGamesPath()) replacePath("/games");
    } else {
      replacePath(activeChatId ? `/chat/${encodeURIComponent(activeChatId)}` : "/chat");
    }
  }, [showGames, activeChatId]);
  const [searchIndex, setSearchIndex] = useState(0);

  const closeSidebar = () => {
    if (isMobileViewport) {
      setSidebarOpen(false);
      return;
    }
    setSidebarClosing(true);
    setTimeout(() => {
      setSidebarOpen(false);
      setSidebarClosing(false);
    }, 200);
  };

  const inputFocusRef = useRef<(() => void) | null>(null);
  const inputSetRef = useRef<((value: string) => void) | null>(null);
  const footerWrapperRef = useRef<HTMLDivElement>(null);
  const [activeTool, setActiveTool] = useState<string | null>(null);
  useEffect(() => {
    scrollToBottom();
  }, [activeTool, scrollToBottom]);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userName, setUserName] = useState<string | null>(null);
  const [features, setFeatures] = useState<Record<string, boolean>>({});
  const [limits, setLimits] = useState<RateLimits | null>(null);

  useEffect(() => {
    apiGetLimits().then(setLimits);
  }, []);

  useEffect(() => {
    if (isGuest) {
      apiGetGuestFeatures()
        .then(setFeatures)
        .catch(() => {});
      return;
    }
    apiGetMe()
      .then((me) => {
        setUserEmail(me.email);
        setUserName(me.full_name);
      })
      .catch(() => {});
    apiGetMyFeatures()
      .then(setFeatures)
      .catch(() => {});
  }, [isGuest]);

  const [documents, setDocuments] = useState<DocumentMeta[]>([]);
  const [docsUploading, setDocsUploading] = useState(false);
  const [docUploadError, setDocUploadError] = useState<string | null>(null);

  const [interactionState, dispatchInteraction] = useReducer(
    chatInteractionReducer,
    initialChatInteractionState,
  );
  const { deletingIds, renameState, editState } = interactionState;

  // A festive theme (Halloween, say) brings its own words and Olly's voice for it (see festive.ts)
  const festive = festiveTheme(theme);

  const assistantName = activePreset === "Olly" ? "Olly" : "ModelLoop";

  const chatSubline = useMemo(() => {
    const lines = festive
      ? festive.lines
      : isGuest
        ? greetingLines()
        : [...greetingLines(), PERSONALITY_TIP];
    return lines[Math.floor(Math.random() * lines.length)];
  }, [isGuest, festive]);

  const chatSuggestions = useMemo(() => pickSuggestions(4, festive?.suggestions), [festive]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const isTyping =
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement;
      if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key === "/" && !isTyping) {
        inputFocusRef.current?.();
        return;
      }
      if (!e.ctrlKey || e.altKey || e.metaKey) return;
      const key = e.key.toLowerCase();
      if (key !== "h" && key !== "p" && key !== "k") return;
      e.preventDefault();
      if (isTyping && key !== "k") return;
      // The sidebar and chat search stay out of a private chat
      if (privateMode && (key === "h" || key === "k")) return;
      if (key === "k") {
        if (!isGuest) { setShowSearch(true); setSidebarOpen(true); }
        return;
      }
      if (isTyping) return;
      e.stopImmediatePropagation();
      if (key === "h") setSidebarOpen((v) => !v);
      if (key === "p" && !showPreferences && !isGuest) setShowPreferences(true);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [showPreferences, isGuest, privateMode]);

  useEffect(() => {
    if (!activeChatId || isGuest) {
      setDocuments([]);
      return;
    }
    apiListDocuments(activeChatId)
      .then(setDocuments)
      .catch(() => setDocuments([]));
  }, [activeChatId, isGuest]);

  const handleDocUpload = async (file: File) => {
    if (!activeChatId) return;
    setDocsUploading(true);
    setDocUploadError(null);
    try {
      const doc = await apiUploadDocument(activeChatId, file);
      setDocuments((prev) => [doc, ...prev]);
    } catch (err) {
      setDocUploadError(err instanceof Error ? err.message : "That upload didn't go through.");
      setTimeout(() => setDocUploadError(null), 5000);
    } finally {
      setDocsUploading(false);
    }
  };

  const handleDocDelete = async (docId: string) => {
    try {
      await apiDeleteDocument(docId);
      setDocuments((prev) => prev.filter((d) => d.id !== docId));
    } catch {
      /* silent */
    }
  };

  const ensureChatId = async (firstPrompt?: string): Promise<string | null> => {
    if (activeChatIdRef.current) return activeChatIdRef.current;
    try {
      const chat = await apiCreateChat();
      activeChatIdRef.current = chat.id;
      justCreatedChatRef.current = true;
      onChatCreated(
        chat.id,
        firstPrompt ? { ...chat, title: firstPrompt.slice(0, 60) } : chat,
      );
      void onChatsChanged();
      return chat.id;
    } catch {
      console.error("Failed to create chat");
      return null;
    }
  };

  const handleAsk = async (
    prompt: string,
    historyOverride?: Message[],
    images?: string[],
    options?: { forceSearch?: boolean; project?: boolean },
  ) => {
    const rawInput = prompt.trim();
    if (!rawInput || loading) return;

    if (rawInput === "/clear") {
      setMessages([]);
      onChatCreated("");
      return;
    }
    if (rawInput.startsWith("/search ") || rawInput === "/search") {
      if (!features.actions) {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: "Web search is not available on your current plan.",
          },
        ]);
        return;
      }
      if (rawInput === "/search") {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content:
              "Usage: `/search <query>` — forces a web search regardless of the query type.",
          },
        ]);
        return;
      }
      const query = rawInput.slice("/search ".length).trim();
      if (!query) return;
      void handleAsk(query, undefined, undefined, { forceSearch: true });
      return;
    }
    if (rawInput === "/code") {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Switched to code mode." },
      ]);
      setSystemPrompt(
        `You are a world-class Software Engineer and Technical Educator. Your goal is to provide the most computationally efficient solution to coding problems while ensuring the logic is crystal clear for other developers to maintain. When providing a solution: 1. Analyze Efficiency: Before writing code, briefly identify the time and space complexity ($O(n)$, $O(\\log n)$, etc.) and explain why this approach is the most optimized. 2. Write Clean, Professional Code: Follow industry standard naming conventions and best practices for the specific programming language requested. 3. Strategic Commenting: Use "why, not what" comments. Do not explain obvious syntax; instead, explain the intent behind complex logic or optimization tricks. 4. Step-by-Step Breakdown: Step 1: The Logic. Explain the mental model or algorithm (e.g., Two Pointers, Dynamic Programming, or Memoization) used to solve the problem. Step 2: The Implementation. Provide the code block with syntax highlighting. Step 3: The "Why". Explain why specific functions or data structures were chosen over less efficient alternatives. 5. Edge Case Handling: Explicitly mention how the code handles null inputs, empty collections, or large-scale data. 6. Summary: Conclude with a "Developer's Note" on the key takeaway or pattern that makes this solution superior to a brute-force approach. Formatting Rules: Use clear headings for each section. Use Markdown code blocks with the correct language tag. Use LaTeX for all complexity analysis and mathematical proofs.`,
      );
      return;
    }
    if (rawInput === "/math") {
      // Working a problem through is what thinking is for
      if (canThink) setThinking(true);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: canThink ? "Switched to math mode, with thinking on." : "Switched to math mode." },
      ]);
      setSystemPrompt(
        "You are an expert teacher who explains problems clearly and patiently. Your goal is not just to give the answer, but to teach the reasoning behind it. When solving a problem: Break the solution into clear, numbered steps. Each step should be separated and easy to follow. Explain what is happening in each step using simple language. Explain why the step is necessary so the learner understands the logic, not just the procedure. Show the intermediate work, not just the final result. Define any important terms or concepts that appear during the explanation. Use examples or small reminders of rules (formulas, properties, or definitions) when they are applied. After solving the problem, include a short summary of the key idea or pattern that helps recognize similar problems in the future. Formatting rules: Use numbered steps. Keep explanations concise but clear. Separate calculations from explanations when helpful. The goal is to help the learner understand how to think through the problem, not just memorize the answer.",
      );
      return;
    }
    if (rawInput === "/think") {
      const on = canThink && !thinking;
      if (canThink) setThinking(on);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: !canThink
            ? `${selectedModel} cannot think. Pick a model that can, such as qwen3.5, in Preferences.`
            : on
              ? "Thinking on. I will reason through it before answering."
              : "Thinking off.",
        },
      ]);
      return;
    }
    if (rawInput === "/fast") {
      setThinking(false);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Fast mode: thinking off." },
      ]);
      return;
    }
    if (rawInput === "/ratelimit") {
      const fmt = (v: string) => v.replace("/", " per ");
      const info = !limits
        ? "Rate limits are unavailable right now."
        : isGuest
          ? `**Rate limits (guest)**\nMessages: ${fmt(limits.guest_chat)}, ${fmt(limits.guest_daily)}\n\nLog in or create an account to raise your limit to ${fmt(limits.chat)}.`
          : `**Rate limits (account)**\nMessages: ${fmt(limits.chat)}`;
      setMessages((prev) => [...prev, { role: "assistant", content: info }]);
      return;
    }
    if (rawInput === "/web" || rawInput.startsWith("/web ")) {
      const brief = rawInput.slice("/web".length).trim();
      const reason = isGuest
        ? "Projects are saved with the chat, so they need an account. Log in to build a website."
        : privateMode
          ? "Projects are saved with the chat, so they can't be built in a private chat."
          : !brief
            ? "Describe the site to start a project, for example `/web a landing page for a bakery`. After that, every message in this chat works on the project."
            : null;
      if (reason) {
        setMessages((prev) => [...prev, { role: "assistant", content: reason }]);
        return;
      }
      void handleAsk(brief, undefined, undefined, { project: true });
      return;
    }
    if (rawInput === "/help") {
      const searchCmd = features.actions ? ", /search <query>" : "";
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content:
            `Commands: /clear${searchCmd}, /code, /math, /think, /fast, /ratelimit, /web <site>, /help\nShortcuts: Ctrl+H (toggle sidebar), Ctrl+K (search chats), Ctrl+P (preferences)`,
        },
      ]);
      return;
    }

    const userMessage = rawInput;
    // Guests and private chats have no saved history, so it is sent with the message
    const unsaved = isGuest || privateMode;
    const historyForGuest = unsaved ? (historyOverride ?? [...messages]) : null;

    setLoading(true);
    setMessages((prev) => [
      ...prev,
      {
        role: "user",
        content: userMessage,
        created_at: new Date().toISOString(),
        ...(images && images.length > 0 ? { images } : {}),
      },
      { role: "assistant", content: "", created_at: new Date().toISOString() },
    ]);
    setIsThinking(true);

    let chatId: string | null = null;
    if (!unsaved) {
      chatId = await ensureChatId(userMessage);
      if (!chatId) {
        setMessages((prev) => prev.slice(0, -2));
        setIsThinking(false);
        setLoading(false);
        return;
      }
    }

    const ctrl = new AbortController();
    abortControllerRef.current = ctrl;

    try {
      const response = isGuest
        ? await apiGuestChatStream(
            {
              prompt: userMessage,
              messages: historyForGuest!,
              model: selectedModel || undefined,
              system_prompt: systemPrompt.trim()
                ? withMandatoryPromptRules(systemPrompt)
                : undefined,
              temperature,
              top_p: topP,
              num_predict: numPredict,
              images,
              think: thinking && canThink,
              festive: festive?.id,
            },
            ctrl.signal,
          )
        : privateMode
        ? await apiPrivateChatStream(
            {
              prompt: userMessage,
              messages: historyForGuest!,
              model: selectedModel || undefined,
              system_prompt: systemPrompt.trim()
                ? withMandatoryPromptRules(systemPrompt)
                : undefined,
              temperature,
              top_p: topP,
              num_predict: numPredict,
              images,
              think: thinking && canThink,
              festive: festive?.id,
              force_search: options?.forceSearch,
            },
            ctrl.signal,
          )
        : await apiChatStream(
            {
              prompt: userMessage,
              chat_id: chatId!,
              model: selectedModel || undefined,
              system_prompt: systemPrompt.trim()
                ? withMandatoryPromptRules(systemPrompt)
                : undefined,
              temperature,
              top_p: topP,
              num_predict: numPredict,
              images,
              think: thinking && canThink,
              festive: festive?.id,
              force_search: options?.forceSearch,
              project: options?.project,
              project_model: studioModel || undefined,
            },
            ctrl.signal,
          );

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error("Failed to get response stream");

      let accumulatedResponse = "";
      let accumulatedThinking = "";
      let bufferedTokens = "";
      let bufferedThinking = "";
      let rafId: number | null = null;
      let tokenHapticCounter = 0;
      let localIsThinking = true;
      let localActiveTool: string | null = null;

      const flushBufferedTokens = () => {
        const hasContent = !!bufferedTokens;
        const hasThinking = !!bufferedThinking;
        if (!hasContent && !hasThinking) return;
        if (hasContent) {
          accumulatedResponse += bufferedTokens;
          bufferedTokens = "";
        }
        if (hasThinking) {
          accumulatedThinking += bufferedThinking;
          bufferedThinking = "";
        }
        setMessages((prev) => {
          const next = [...prev];
          next[next.length - 1] = {
            ...next[next.length - 1],
            content: accumulatedResponse,
            ...(accumulatedThinking ? { thinking: accumulatedThinking } : {}),
          };
          return next;
        });
      };

      const scheduleFlush = () => {
        if (rafId !== null) return;
        rafId = window.requestAnimationFrame(() => {
          rafId = null;
          flushBufferedTokens();
        });
      };

      const flushAndCancelPendingFrame = () => {
        if (rafId !== null) {
          window.cancelAnimationFrame(rafId);
          rafId = null;
        }
        flushBufferedTokens();
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const line of decoder
          .decode(value, { stream: true })
          .split("\n")) {
          if (!line.startsWith("data: ")) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === "thinking_token") {
              bufferedThinking += data.token;
              scheduleFlush();
              if (++tokenHapticCounter % 2 === 0)
                haptics.trigger("light", { silent: true });
            } else if (data.type === "token") {
              if (localIsThinking || localActiveTool !== null) {
                localIsThinking = false;
                localActiveTool = null;
                setIsThinking(false);
                setActiveTool(null);
              }
              bufferedTokens += data.token;
              scheduleFlush();
              sounds.babble();
              if (++tokenHapticCounter % 2 === 0)
                haptics.trigger(
                  tokenHapticCounter % 10 === 0 ? "selection" : "light",
                  { silent: true },
                );
            } else if (data.type === "tool_use") {
              localActiveTool = data.tool ?? null;
              setActiveTool(data.tool ?? null);
              haptics.trigger("selection");
            } else if (data.type === "image_context") {
              setMessages((prev) => {
                const next = [...prev];
                next[next.length - 1] = {
                  ...next[next.length - 1],
                  image_context: data.context,
                };
                return next;
              });
            } else if (data.type === "widgets") {
              setMessages((prev) => {
                const next = [...prev];
                next[next.length - 1] = {
                  ...next[next.length - 1],
                  widgets: data.widgets,
                };
                return next;
              });
            } else if (data.type === "project_check" && chatId) {
              // The turn's checker waits for this: run the new files hidden and report their errors.
              // Not awaited, so the stream keeps reading meanwhile.
              const checkChat = chatId;
              void runPreviewCheck(data.files ?? [])
                .then((errors) => apiReportProjectCheck(checkChat, data.check_id, errors))
                .catch(() => {});
            } else if (data.type === "project_turn" || data.type === "project_step") {
              if (data.type === "project_turn") liveSavedRef.current = false;
              const file = data.file as { path: string; content: string | null } | undefined;
              if (file) {
                const chatId = activeChatIdRef.current;
                setLiveFiles((live) => ({
                  chatId,
                  files: { ...(live?.chatId === chatId ? live.files : {}), [file.path]: file.content },
                }));
              }
              setMessages((prev) => {
                const next = [...prev];
                const last = next[next.length - 1];
                next[next.length - 1] = {
                  ...last,
                  steps: data.step ? [...(last.steps ?? []), data.step] : (last.steps ?? []),
                };
                return next;
              });
            } else if (data.type === "project_changes") {
              // The turn is saved by now, so the card and studio can pick up its files
              if (data.changes?.version != null) {
                // The live files stay on screen until the saved ones load
                liveSavedRef.current = true;
                setProjectTick((t) => t + 1);
              }
              setMessages((prev) => {
                const next = [...prev];
                next[next.length - 1] = {
                  ...next[next.length - 1],
                  project_changes: data.changes,
                };
                return next;
              });
            } else if (data.type === "search_context") {
              setMessages((prev) => {
                const next = [...prev];
                next[next.length - 1] = {
                  ...next[next.length - 1],
                  search_context: data.context,
                };
                return next;
              });
            } else if (data.type === "done") {
              setActiveTool(null);
              setIsThinking(false);
              flushAndCancelPendingFrame();
              setLoading(false);
              // No tone here: a chime after every reply wears thin quickly.
              haptics.trigger("medium", { silent: true });
              if (!unsaved) onChatsChanged();
            } else if (data.type === "error") {
              flushAndCancelPendingFrame();
              haptics.trigger("warning");
              throw new Error(data.error);
            }
          } catch (e) {
            if (e instanceof SyntaxError) continue;
            throw e;
          }
        }
      }
      flushAndCancelPendingFrame();
      setLoading(false);
      setIsThinking(false);
      setActiveTool(null);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      // withRefresh fires handleLogout on 401 for authenticated users — strip the bubble and bail
      // For guests the API key mismatch also surfaces as "Unauthorized access" but no logout fires,
      // so guests fall through to show the error message instead of silently clearing.
      if (
        !isGuest &&
        error instanceof Error &&
        error.message === "Unauthorized access"
      ) {
        setMessages((prev) => prev.slice(0, -2));
        return;
      }
      const message =
        error instanceof Error
          ? error.message
          : "Failed to get response";
      setMessages((prev) => {
        const next = [...prev];
        if (next.length > 0 && next[next.length - 1].role === "assistant") {
          next[next.length - 1] = {
            ...next[next.length - 1],
            content: friendlyError(message),
          };
        } else {
          next.push({ role: "assistant", content: friendlyError(message) });
        }
        return next;
      });
    } finally {
      setIsThinking(false);
      setActiveTool(null);
      setLoading(false);
      // A turn that saved nothing (stopped, failed or no changes) leaves the project as it was
      if (!liveSavedRef.current) setLiveFiles(null);
      setMessages((prev) => {
        if (activeChatIdRef.current)
          messageCache.current.set(activeChatIdRef.current, prev);
        return prev;
      });
    }
  };

  const handleStop = () => abortControllerRef.current?.abort();

  const lastAssistantText = useMemo(() => {
    const last = messages[messages.length - 1];
    return last?.role === "assistant" ? (last.content ?? "") : "";
  }, [messages]);

  const voice = useVoiceConversation({
    onSubmit: (text) => void handleAsk(text),
    loading,
    lastResponseText: lastAssistantText,
    speechRate,
  });

  // ── Focused mode ─────────────────────────────────────────────────────────
  const [focusedMode, setFocusedMode] = useState(false);
  // ── Web studio ───────────────────────────────────────────────────────────
  // Open on the chat's project, at a file when given one
  const [studio, setStudio] = useState<{ path?: string } | null>(null);
  const closeStudio = useCallback(() => setStudio(null), [setStudio]);
  const openStudio = useCallback((options?: { path?: string }) => setStudio({ path: options?.path }), [setStudio]);
  // A chat has a project once a reply carries project changes (the turn that starts one always does)
  const hasProject = useMemo(() => messages.some((m) => m.project_changes), [messages]);
  const [storedProject, setStoredProject] = useState<{ chatId: string; data: StoredProject } | null>(null);
  // Bumped when a turn saves a version, to load the new files
  const [projectTick, setProjectTick] = useState(0);
  // Files the running turn has changed so far ({path: contents, or null when deleted}), so the
  // preview follows each step instead of waiting for the turn to end
  const [liveFiles, setLiveFiles] = useState<{ chatId: string | null; files: LiveFiles } | null>(null);
  // The running turn saved a version, so its live files give way once the saved ones load
  const liveSavedRef = useRef(false);
  useEffect(() => {
    if (!activeChatId || !hasProject || isGuest || privateMode) return;
    let cancelled = false;
    const chatId = activeChatId;
    apiGetProject(chatId)
      .then((data) => {
        if (cancelled) return;
        setStoredProject({ chatId, data });
        if (liveSavedRef.current) {
          liveSavedRef.current = false;
          setLiveFiles(null);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [activeChatId, hasProject, isGuest, privateMode, projectTick]);
  // Another chat's studio never stays open over this one
  const [studioChat, setStudioChat] = useState(activeChatId);
  if (studioChat !== activeChatId) {
    setStudioChat(activeChatId);
    setStudio(null);
  }

  const project = useMemo<StudioProject | null>(() => {
    if (!storedProject || storedProject.chatId !== activeChatId || !hasProject) return null;
    const { data } = storedProject;
    const last = [...messages].reverse().find((m) => m.project_changes?.files.length);
    return {
      name: data.name,
      version: data.version,
      files: liveFiles?.chatId === activeChatId ? withLiveFiles(data.files, liveFiles.files) : data.files,
      versions: data.versions.map((v) => ({ version: v.version, label: v.label, when: timeAgo(v.created_at) })),
      lastChanges: last?.project_changes?.files ?? [],
      restoredFrom: data.versions[0]?.restored_from,
    };
  }, [storedProject, activeChatId, hasProject, messages, liveFiles]);
  const studioMessages = useMemo<StudioMessage[]>(
    () =>
      messages.map((m) => ({
        role: m.role,
        text: m.content,
        changes: m.project_changes?.files,
        version: m.project_changes?.version,
        steps: m.steps,
        createdAt: m.created_at,
      })),
    [messages],
  );
  const loadVersion = useCallback(
    (version: number) => apiGetProjectVersion(activeChatIdRef.current!, version),
    [activeChatIdRef],
  );
  const restoreVersion = useCallback(
    async (version: number) => {
      await apiRestoreProjectVersion(activeChatIdRef.current!, version);
      setProjectTick((t) => t + 1);
    },
    [activeChatIdRef],
  );
  const webDev = useMemo<WebDevContextValue>(() => ({ project, open: openStudio }), [project, openStudio]);
  const [readerPrefs, setReaderPrefs] = useReaderPrefs();
  const [focusedLines, setFocusedLines] = useState<
    { role: "user" | "assistant"; text: string }[]
  >([]);
  const [focusedInput, setFocusedInput] = useState("");
  const focusedTextareaRef = useRef<HTMLTextAreaElement>(null);
  const focusedScrollRef = useRef<HTMLDivElement>(null);
  const prevLoadingRef = useRef(loading);
  const focusedPendingUserText = useRef("");

  // The live reply puts each word in its own span so it comes into focus as it lands, the same
  // as in the chat. Words keep their place as the text grows, so only new ones play the effect.
  const renderWords = (text: string) =>
    text.split(/(\s+)/).map((part, i) =>
      /^\s*$/.test(part) ? part : (
        <span key={i} className="stream-word">
          {part}
        </span>
      ),
    );

  const renderLyric = (text: string, streaming = false) => {
    if (!text.includes("[code]")) return streaming ? renderWords(text) : text;
    const parts = text.split("[code]");
    return parts.map((part, i) => (
      <span key={i}>
        {streaming ? renderWords(part) : part}
        {i < parts.length - 1 && (
          <span className="focused-code-pill">{"{ }"}</span>
        )}
      </span>
    ));
  };

  const scrollFocusedToBottom = (delay = 0) =>
    setTimeout(() => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (focusedScrollRef.current)
            focusedScrollRef.current.scrollTop =
              focusedScrollRef.current.scrollHeight;
        });
      });
    }, delay);

  useEffect(() => {
    if (!focusedMode) {
      setFocusedLines([]);
      setFocusedInput("");
      return;
    }
    const history = messages.map((m) => ({
      role: m.role as "user" | "assistant",
      text:
        m.role === "assistant" ? toLyricText(m.content ?? "") : (m.content ?? ""),
    }));
    setFocusedLines(history);
    scrollFocusedToBottom();
    setTimeout(() => focusedTextareaRef.current?.focus(), 50);
  }, [focusedMode]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const wasLoading = prevLoadingRef.current;
    prevLoadingRef.current = loading;
    if (wasLoading && !loading && focusedMode) {
      const last = messages[messages.length - 1];
      if (last?.role === "assistant" && last.content) {
        setFocusedLines((ls) => [
          ...ls,
          { role: "assistant" as const, text: toLyricText(last.content!) },
        ]);
        scrollFocusedToBottom();
      }
      setTimeout(() => focusedTextareaRef.current?.focus(), 50);
    }
  }, [loading, focusedMode, messages]);

  // Every line in focused mode, with the reply that's still arriving as the last one
  const focusedLive = loading && lastAssistantText ? toLyricText(lastAssistantText) : null;
  const focusedAll =
    focusedLive === null
      ? focusedLines
      : [...focusedLines, { role: "assistant" as const, text: focusedLive }];

  const focusNav = useFocusedNav({
    active: focusedMode,
    lines: focusedAll,
    scrollRef: focusedScrollRef,
    textareaRef: focusedTextareaRef,
    inputEmpty: focusedInput === "",
  });

  // Follow the reply as it streams, unless the user has stepped back to read something else
  useEffect(() => {
    if (focusedMode && loading && !focusNav.navigating) scrollFocusedToBottom();
  }, [lastAssistantText, focusedMode, loading, focusNav.navigating]);

  // The field grows with what is typed, up to a few lines, then scrolls
  useEffect(() => {
    const el = focusedTextareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [focusedInput, focusedMode, readerPrefs.size, readerPrefs.font]);

  const submitFocused = () => {
    const text = focusedInput.trim();
    if (!text || loading) return;
    focusedPendingUserText.current = text;
    focusNav.backToLatest();
    setFocusedLines((ls) => [...ls, { role: "user" as const, text }]);
    scrollFocusedToBottom();
    setFocusedInput("");
    void handleAsk(text);
  };

  // Space pauses and resumes listening in voice mode (unless typing somewhere)
  useEffect(() => {
    if (!voice.isActive) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== " " || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, [contenteditable='true'], button")) return;
      e.preventDefault();
      voice.togglePause();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [voice.isActive, voice.togglePause]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Voice lyrics history ──────────────────────────────────────────────────
  type VoiceLine = { role: "user" | "assistant"; text: string };
  const [voiceLines, setVoiceLines] = useState<VoiceLine[]>([]);
  const prevVoiceTranscriptRef = useRef("");
  const prevSpeakingTextRef = useRef("");

  useEffect(() => {
    if (!voice.isActive) {
      setVoiceLines([]);
      return;
    }
  }, [voice.isActive]);

  // Capture completed user utterance when transcript clears on submit
  useEffect(() => {
    const prev = prevVoiceTranscriptRef.current;
    prevVoiceTranscriptRef.current = voice.transcript;
    if (prev && !voice.transcript && voice.status === "processing") {
      setVoiceLines((ls) =>
        [...ls, { role: "user" as const, text: prev }].slice(-6),
      );
    }
  }, [voice.transcript, voice.status]);

  // Capture each assistant sentence as it finishes (sentence N ends when sentence N+1 starts)
  useEffect(() => {
    const prev = prevSpeakingTextRef.current;
    prevSpeakingTextRef.current = voice.speakingText;
    if (prev && voice.speakingText !== prev) {
      setVoiceLines((ls) =>
        [...ls, { role: "assistant" as const, text: prev }].slice(-6),
      );
    }
  }, [voice.speakingText]);

  const handleEditSubmit = () => {
    if (!editState) return;
    const { idx, value } = editState as EditState;
    const trimmed = value.trim();
    dispatchInteraction({ type: "edit_cancel" });
    if (!trimmed) return;
    const truncated = messages.slice(0, idx);
    setMessages(truncated);
    handleAsk(trimmed, truncated);
  };

  const handleRetry = () => {
    if (loading) return;
    const msgs = [...messages];
    let cutIdx = msgs.length;
    while (cutIdx > 0 && msgs[cutIdx - 1].role === "assistant") cutIdx--;
    if (cutIdx === 0 || msgs[cutIdx - 1].role !== "user") return;
    const lastUserContent = msgs[cutIdx - 1].content;
    cutIdx--;
    const truncated = msgs.slice(0, cutIdx);
    setMessages(truncated);
    handleAsk(lastUserContent, truncated);
  };

  const handleNewChat = () => {
    setShowGames(false);
    setMessages([]);
    activeChatIdRef.current = null;
    onChatCreated("");
  };

  // Either way the conversation on screen is left behind: a private one is gone for good
  const handleTogglePrivate = () => {
    handleNewChat();
    sounds.play(privateMode ? "unlock" : "lock");
    setPrivateMode(!privateMode);
  };

  const handleLogout = () => {
    localStorage.removeItem("token");
    onLogout();
  };

  const handleDeleteChat = async (id: string) => {
    dispatchInteraction({ type: "delete_start", id });
    if (id === activeChatId) handleNewChat();
    try {
      await apiDeleteChat(id);
      await onChatsChanged();
    } catch {
      /* silently ignore */
    } finally {
      dispatchInteraction({ type: "delete_finish", id });
    }
  };

  const handleRenameCommit = async () => {
    if (!renameState) return;
    const { id, value } = renameState as RenameState;
    const trimmed = value.trim();
    dispatchInteraction({ type: "rename_cancel" });
    if (!trimmed) return;
    try {
      await apiRenameChat(id, trimmed);
      await onChatsChanged();
    } catch {
      /* silently ignore */
    }
  };

  const [pinnedIds, setPinnedIds] = useState<Set<string>>(
    () => new Set(JSON.parse(localStorage.getItem("pinned_chats") || "[]")),
  );

  const togglePin = (id: string) => {
    setPinnedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      localStorage.setItem("pinned_chats", JSON.stringify([...next]));
      return next;
    });
  };

  const visibleChats = useMemo(() => {
    const filtered = chats.filter((c) => !deletingIds.has(c.id));
    const pinned = filtered.filter((c) => pinnedIds.has(c.id));
    const rest = filtered.filter((c) => !pinnedIds.has(c.id));
    return { pinned, rest };
  }, [chats, deletingIds, pinnedIds]);

  const searchResults = useMemo(() => {
    if (!historySearch.trim()) return [];
    return chats
      .filter((c) =>
        (c.title || "").toLowerCase().includes(historySearch.toLowerCase()),
      )
      .filter((c) => !deletingIds.has(c.id))
      .slice(0, 9);
  }, [chats, historySearch, deletingIds]);

  const activeChat = chats.find((c) => c.id === activeChatId);
  const chatTitle = privateMode
    ? "Private Chat"
    : activeChat?.title ?? (activeChatId ? "Chat" : "New Chat");

  const estimatedTokens = useMemo(
    () =>
      messages.length === 0
        ? 0
        : Math.round(
            messages.reduce(
              (sum, m) => sum + m.content.length + (m.thinking?.length ?? 0),
              0,
            ) / 4,
          ),
    [messages],
  );

  return (
    <WebDevContext.Provider value={webDev}>
      {!isConnected && <ConnectionBanner />}
      {studio && project && (
        <WebDevStudio
          project={project}
          messages={studioMessages}
          busy={loading}
          activity={
            activeTool ? (PROJECT_TOOL_PHRASES[activeTool] ?? "Working on it") : isThinking ? "Thinking" : null
          }
          onSend={(text) => void handleAsk(text)}
          onStop={handleStop}
          loadVersion={loadVersion}
          onRestore={restoreVersion}
          initialPath={studio.path}
          onClose={closeStudio}
        />
      )}

      {/* Inert under voice mode: the mic button that started Talk would otherwise keep focus
          behind the overlay, and a stray Space or Enter would press it and end the conversation */}
      <div className="chat-layout" inert={voice.isActive}>
        {/* ---- Sidebar ---- */}
        {/* Hidden in a private chat, along with the history it lists */}
        {!isGuest && !privateMode && (sidebarOpen || sidebarClosing || isMobileViewport) && (
          <div
            className={`sidebar-backdrop${sidebarOpen ? " open" : ""}`}
            onClick={closeSidebar}
          />
        )}
        {!isGuest && !privateMode && (sidebarOpen || sidebarClosing || isMobileViewport) && (
          <aside
            className={`chat-sidebar${sidebarOpen ? " open" : ""}${sidebarClosing ? " closing" : ""}`}
          >
            <div className="sidebar-brand">
              <span className="sidebar-logo"><StretchyLogo stacked={false} /></span>
              <div className="sidebar-brand-actions">
                <button
                  className="sidebar-brand-btn"
                  onClick={() => setShowSearch(true)}
                  title="Search chats (Ctrl+K)"
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
                  >
                    <circle cx="11" cy="11" r="8" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                </button>
                <button
                  className="sidebar-brand-btn"
                  onClick={closeSidebar}
                  title="Close sidebar"
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
                  >
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <path d="M9 3v18" />
                    <path d="M16 9l-3 3 3 3" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="sidebar-nav">
              <button
                className={`sidebar-nav-btn${showGames ? " active" : ""}`}
                onClick={() => {
                  setShowGames(true);
                  // Always lands on the game selection, even from inside a game
                  replacePath("/games");
                  setGamesVisit((n) => n + 1);
                  if (window.innerWidth < 768) closeSidebar();
                }}
              >
                <GamesIcon />
                Games
              </button>
            </div>

            <div className="sidebar-history">
              <div className="sidebar-chat-list">
                {chatsLoading &&
                  visibleChats.pinned.length === 0 &&
                  visibleChats.rest.length === 0 && (
                    <div className="sidebar-skeleton">
                      {Array.from({ length: 6 }).map((_, i) => (
                        <div key={i} className="sidebar-skeleton-item">
                          <div
                            className="sidebar-skeleton-title"
                            style={{ width: `${55 + (i % 3) * 15}%` }}
                          />
                          <div className="sidebar-skeleton-date" />
                        </div>
                      ))}
                    </div>
                  )}
                {!chatsLoading &&
                  visibleChats.pinned.length === 0 &&
                  visibleChats.rest.length === 0 && (
                    <span className="sidebar-empty">
                      Start a conversation to see it here
                    </span>
                  )}
                {visibleChats.pinned.length > 0 && (
                  <>
                    <span className="sidebar-section-label">Pinned</span>
                    {visibleChats.pinned.map((c) => (
                      <SidebarChatItem
                        key={c.id}
                        c={c}
                        activeChatId={showGames ? null : activeChatId}
                        pinned
                        deleting={deletingIds.has(c.id)}
                        onSelect={() => {
                          setShowGames(false);
                          onChatCreated(c.id);
                          if (window.innerWidth < 768) closeSidebar();
                        }}
                        onPin={(e) => {
                          e.stopPropagation();
                          togglePin(c.id);
                        }}
                        onDelete={(e) => {
                          e.stopPropagation();
                          handleDeleteChat(c.id);
                        }}
                      />
                    ))}
                    {visibleChats.rest.length > 0 && (
                      <div className="sidebar-section-divider" />
                    )}
                  </>
                )}
                {visibleChats.rest.map((c) => (
                  <SidebarChatItem
                    key={c.id}
                    c={c}
                    activeChatId={showGames ? null : activeChatId}
                    pinned={false}
                    deleting={deletingIds.has(c.id)}
                    onSelect={() => {
                      setShowGames(false);
                      onChatCreated(c.id);
                      if (window.innerWidth < 768) closeSidebar();
                    }}
                    onPin={(e) => {
                      e.stopPropagation();
                      togglePin(c.id);
                    }}
                    onDelete={(e) => {
                      e.stopPropagation();
                      handleDeleteChat(c.id);
                    }}
                  />
                ))}
              </div>
            </div>

            {(userEmail || userName) && (
              <div className="sidebar-footer-wrapper" ref={footerWrapperRef}>
                {showUserMenu &&
                  (() => {
                    const rect =
                      footerWrapperRef.current?.getBoundingClientRect();
                    // On the body, not in the sidebar: the sidebar's own blur stops any blur
                    // inside it from seeing what is beneath, so the menu would show the chat
                    // list sharp through its glass
                    return createPortal(
                      <>
                        <div
                          className="sidebar-user-menu-backdrop"
                          onClick={() => setShowUserMenu(false)}
                        />
                        <div
                          className="sidebar-user-menu"
                          role="menu"
                          aria-label="Account"
                          onClick={(e) => e.stopPropagation()}
                          style={
                            rect
                              ? {
                                  position: "fixed",
                                  bottom: `calc((100vh - ${rect.top}px) / ${uiScale.scale()} + 8px)`,
                                  left: rect.left / uiScale.scale() + 8,
                                  width: rect.width / uiScale.scale() - 16,
                                }
                              : undefined
                          }
                        >
                          <button
                            className="sidebar-user-menu-item"
                            role="menuitem"
                            onClick={() => {
                              setShowUserMenu(false);
                              setPrefSection("account");
                              setShowPreferences(true);
                            }}
                          >
                            <svg
                              viewBox="0 0 24 24"
                              width="16"
                              height="16"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                              <circle cx="12" cy="7" r="4" />
                            </svg>
                            Account settings
                          </button>
                          <div className="sidebar-user-menu-sep" role="separator" />
                          <button
                            className="sidebar-user-menu-item"
                            role="menuitem"
                            onClick={() => {
                              setShowUserMenu(false);
                              setShowLogoutConfirm(true);
                            }}
                          >
                            <svg
                              viewBox="0 0 24 24"
                              width="16"
                              height="16"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                              <polyline points="16 17 21 12 16 7" />
                              <line x1="21" y1="12" x2="9" y2="12" />
                            </svg>
                            Sign out
                          </button>
                        </div>
                      </>,
                      document.body,
                    );
                  })()}
                <div
                  className="sidebar-footer"
                  role="button"
                  aria-haspopup="menu"
                  aria-expanded={showUserMenu}
                  onClick={() => setShowUserMenu((v) => !v)}
                  style={{ cursor: "pointer" }}
                >
                  <div
                    className="sidebar-user-avatar"
                    style={
                      avatarColor
                        ? { background: avatarColor, color: readableTextOn(avatarColor) }
                        : undefined
                    }
                  >
                    {(userName ?? userEmail ?? "?")[0].toUpperCase()}
                  </div>
                  <span
                    className="sidebar-user-email"
                    title={userName ?? userEmail ?? ""}
                  >
                    {userName ?? userEmail ?? ""}
                  </span>
                </div>
              </div>
            )}
          </aside>
        )}

        {/* ---- Main area ---- */}
        <div className={`chat-main${showGames ? " games-open" : privateMode ? " is-private" : ""}`}>
          {/* Topbar */}
          <div className="chat-topbar">
            <div className="topbar-left">
              {!isGuest && !privateMode && !sidebarOpen && (
                <button
                  className="topbar-icon-btn"
                  onClick={() => setSidebarOpen((v) => !v)}
                  title="Toggle sidebar (Ctrl+H)"
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
                  >
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <path d="M9 3v18" />
                    <path d="M13 9l3 3-3 3" />
                  </svg>
                </button>
              )}
            </div>

            {activeChatId && !isGuest && renameState?.id === activeChatId ? (
              <input
                className="topbar-rename-input"
                value={renameState.value}
                onChange={(e) =>
                  dispatchInteraction({
                    type: "rename_update",
                    value: e.target.value,
                  })
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleRenameCommit();
                  if (e.key === "Escape") dispatchInteraction({ type: "rename_cancel" });
                  e.stopPropagation();
                }}
                onBlur={handleRenameCommit}
                autoFocus
                placeholder="Chat name"
              />
            ) : (
              <span
                className="topbar-title"
                onClick={() => {
                  if (!activeChatId || isGuest || showGames) return;
                  dispatchInteraction({
                    type: "rename_start",
                    id: activeChatId,
                    value: activeChat?.title || "",
                  });
                }}
                title={activeChatId && !isGuest && !showGames ? "Click to rename" : undefined}
              >
                {showGames ? "" : chatTitle}
              </span>
            )}

            {showSearch && !isGuest &&
              createPortal(
                <div className="spotlight-overlay">
                  <div
                    className="spotlight-dismiss"
                    onMouseDown={() => { setShowSearch(false); setHistorySearch(""); setSearchIndex(0); }}
                  />
                  <div className={`spotlight-box${searchResults.length > 0 ? " has-results" : ""}`}>
                    <div className="spotlight-input-row">
                      <input
                        className="spotlight-input"
                        value={historySearch}
                        onChange={(e) => { setHistorySearch(e.target.value); setSearchIndex(0); }}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") {
                            setShowSearch(false);
                            setHistorySearch("");
                            setSearchIndex(0);
                          } else if (e.key === "ArrowDown") {
                            e.preventDefault();
                            setSearchIndex((i) => Math.min(i + 1, searchResults.length - 1));
                          } else if (e.key === "ArrowUp") {
                            e.preventDefault();
                            setSearchIndex((i) => Math.max(i - 1, 0));
                          } else if (e.key === "Enter" && searchResults.length > 0) {
                            setShowGames(false);
                            onChatCreated(searchResults[searchIndex].id);
                            setShowSearch(false);
                            setHistorySearch("");
                            setSearchIndex(0);
                          }
                          e.stopPropagation();
                        }}
                        autoFocus
                        placeholder="Search chats"
                      />
                    </div>
                    {searchResults.length > 0 && (
                      <div className="spotlight-results">
                        {searchResults.map((c, i) => (
                          <div
                            key={c.id}
                            className={`spotlight-result-item${i === searchIndex ? " active" : ""}`}
                            onMouseEnter={() => setSearchIndex(i)}
                            onMouseDown={() => {
                              setShowGames(false);
                              onChatCreated(c.id);
                              setShowSearch(false);
                              setHistorySearch("");
                              setSearchIndex(0);
                            }}
                          >
                            <svg
                              className="spotlight-result-icon"
                              width="16"
                              height="16"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                            </svg>
                            <span className="spotlight-result-title">{c.title || "Untitled"}</span>
                            <span className="spotlight-result-date">{formatDate(c.updated_at)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>,
                document.body
              )
            }

            <div className="topbar-right">
              {!isGuest && (
                <button
                  className="topbar-icon-btn"
                  onClick={handleNewChat}
                  disabled={loading}
                  title=""
                >
                  <svg
                    viewBox="0 0 24 24"
                    width="18"
                    height="18"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                  <span className="topbar-dock-label">New chat</span>
                </button>
              )}
              {!isGuest && (
                <button
                  className={`topbar-icon-btn private-toggle${privateMode ? " is-private" : ""}`}
                  onClick={handleTogglePrivate}
                  disabled={loading}
                  title=""
                  aria-pressed={privateMode}
                >
                  <svg
                    viewBox="0 0 24 24"
                    width="18"
                    height="18"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M5 21V10a7 7 0 0 1 14 0v11l-2.33-2-2.34 2L12 19l-2.33 2-2.34-2z" />
                    <line x1="9.5" y1="10" x2="9.51" y2="10" />
                    <line x1="14.5" y1="10" x2="14.51" y2="10" />
                  </svg>
                  <span className="topbar-dock-label">
                    {privateMode ? "Leave private" : "Private chat"}
                  </span>
                </button>
              )}
              {!isGuest && (
                <button
                  className="topbar-icon-btn"
                  onClick={() => setShowPreferences(true)}
                  title=""
                >
                  <svg
                    viewBox="0 0 24 24"
                    width="18"
                    height="18"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                  <span className="topbar-dock-label">Preferences</span>
                </button>
              )}
              {isGuest && (
                <button
                  className="topbar-icon-btn"
                  onClick={handleLogout}
                  title=""
                  aria-label="Sign In"
                >
                  <svg
                    viewBox="0 0 24 24"
                    width="18"
                    height="18"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
                    <polyline points="10 17 15 12 10 7" />
                    <line x1="15" y1="12" x2="3" y2="12" />
                  </svg>
                  <span className="topbar-dock-label">Sign In</span>
                </button>
              )}
            </div>
          </div>

          {/* The games play with their own model, picked in Advanced settings or the server's GAME_MODEL */}
          {showGames && <GamesHub key={gamesVisit} model={gameModel || undefined} />}

          {/* Messages */}
          <div
            className="messages"
            ref={messagesContainerRef}
            style={voice.isActive ? { visibility: "hidden" } : undefined}
          >
            {messagesLoading && (
              <p id="disclaimer" className="messages-loading">
                Fetching your conversation…
              </p>
            )}

            {!messagesLoading && messages.length === 0 && (
              <div className="empty-state">
                <h2 className="empty-title">
                  {privateMode ? "Off the record." : timeGreeting(userName, new Date(), festive)}
                </h2>
                <p className="empty-subline">
                  {privateMode
                    ? "This chat is private. It won't be saved to your history, and it's gone once you leave or refresh."
                    : chatSubline}
                </p>
                <div className="suggestion-chips">
                  {chatSuggestions.map((s) => (
                    <button
                      key={s}
                      className="suggestion-chip"
                      onClick={() => inputSetRef.current?.(s)}
                      disabled={loading}
                    >
                      {s}
                    </button>
                  ))}
                </div>
                <p className="empty-hint">
                  ModelLoop can make mistakes. Verify critical information.
                </p>
              </div>
            )}

            {(() => {
              const lastUserIdx = messages.reduce(
                (last, m, i) => (m.role === "user" ? i : last),
                -1,
              );
              // One project card per chat, on the latest project reply
              const lastProjectIdx = project
                ? messages.reduce((last, m, i) => (m.project_changes ? i : last), -1)
                : -1;
              return messages.map((msg, idx) => (
                <div key={idx} className={`message-row ${msg.role}`}>
                  {msg.role === "assistant" ? (
                    <AssistantMessage
                      msg={msg}
                      showProjectCard={idx === lastProjectIdx}
                      isLast={idx === messages.length - 1}
                      canRetry={
                        idx === messages.length - 1 && !!msg.content && !loading
                      }
                      isThinking={idx === messages.length - 1 && isThinking}
                      activeTool={
                        idx === messages.length - 1 ? activeTool : null
                      }
                      streaming={idx === messages.length - 1 && loading}
                      onRetry={handleRetry}
                    />
                  ) : (
                    <UserMessage
                      msg={msg}
                      isEditing={editState?.idx === idx}
                      editValue={editState?.idx === idx ? editState.value : ""}
                      canEdit={
                        editState === null && idx === lastUserIdx && !loading
                      }
                      onEditStart={() =>
                        dispatchInteraction({
                          type: "edit_start",
                          idx,
                          value: msg.content,
                        })
                      }
                      onEditChange={(v) =>
                        dispatchInteraction({ type: "edit_update", value: v })
                      }
                      onEditSubmit={handleEditSubmit}
                      onEditCancel={() =>
                        dispatchInteraction({ type: "edit_cancel" })
                      }
                    />
                  )}
                </div>
              ));
            })()}
          </div>

          {showScrollBtn && (
            <button
              className="scroll-to-bottom-btn"
              onClick={() => {
                const c = messagesContainerRef.current;
                if (c) c.scrollTo({ top: c.scrollHeight, behavior: "smooth" });
              }}
              title="Scroll to bottom"
            >
              <svg
                viewBox="0 0 24 24"
                width="18"
                height="18"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
          )}

          <ChatInput
            loading={loading}
            assistantName={assistantName}
            placeholder={festive?.placeholder(assistantName)}
            onAsk={(prompt, images) => handleAsk(prompt, undefined, images)}
            onStop={handleStop}
            onRegisterFocus={(focusFn) => {
              inputFocusRef.current = focusFn;
            }}
            onRegisterSetInput={(setFn) => {
              inputSetRef.current = setFn;
            }}
            selectedModel={selectedModel}
            models={models}
            modelCapabilities={modelCapabilities}
            setSelectedModel={setSelectedModel}
            estimatedTokens={estimatedTokens}
            messageCount={messages.length}
            photoUploadEnabled={features.photo_upload ?? true}
            ragEnabled={features.rag ?? false}
            quickModelsEnabled={features.quick_models ?? false}
            voiceActive={voice.isActive}
            voiceStatus={voice.status}
            voiceStatusLabel={voice.statusLabel}
            voiceTranscript={voice.transcript}
            voiceError={voice.error}
            onVoiceToggle={voice.toggle}
            focusedMode={focusedMode}
            onFocusedModeToggle={() => setFocusedMode((f) => !f)}
            thinking={thinking && canThink}
            onThinkingToggle={canThink ? () => setThinking(!thinking) : undefined}
            {...(!isGuest && activeChatId
              ? {
                  documents,
                  docsUploading,
                  docUploadError,
                  onDocUpload: handleDocUpload,
                  onDocDelete: handleDocDelete,
                }
              : {})}
          />
        </div>
      </div>

      {showLogoutConfirm && (
        <div
          className="logout-confirm-overlay"
          onClick={() => setShowLogoutConfirm(false)}
        >
          <div
            className="logout-confirm-dialog"
            onClick={(e) => e.stopPropagation()}
          >
            <p>Heading out? You can sign back in any time.</p>
            <div className="logout-confirm-actions">
              <button
                className="logout-confirm-cancel"
                onClick={() => setShowLogoutConfirm(false)}
              >
                Cancel
              </button>
              <button className="logout-confirm-yes" onClick={handleLogout}>
                Sign Out
              </button>
            </div>
          </div>
        </div>
      )}

      {voice.isActive && (
        <div className="voice-overlay">
          {/* ── X close button ── */}
          <button
            className="voice-close-btn"
            onClick={voice.toggle}
            aria-label="End conversation"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 18 18"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
            >
              <line x1="2" y1="2" x2="16" y2="16" />
              <line x1="16" y1="2" x2="2" y2="16" />
            </svg>
          </button>

          {/* ── Glow matrix ── */}
          <VoiceMatrix
            status={voice.status}
            onWord={voice.onWord}
            onTap={voice.status === "speaking" ? voice.interrupt : undefined}
          />

          <div className="voice-lyrics">
            {voiceLines.map((line, i) => {
              const age = voiceLines.length - 1 - i;
              return (
                <p
                  key={i}
                  className={`voice-lyric voice-lyric--age-${Math.min(age, 3)} voice-lyric--${line.role}`}
                >
                  {line.text}
                </p>
              );
            })}
            {voice.transcript && (
              <p
                className="voice-lyric voice-lyric--current voice-lyric--user"
                key="user-live"
              >
                {voice.transcript}
              </p>
            )}
            {voice.speakingText && (
              <p
                className="voice-lyric voice-lyric--current voice-lyric--assistant"
                key="assistant-live"
              >
                {voice.speakingText}
              </p>
            )}
          </div>

          {/* Pause stops listening and lets go of the mic; a reply already under way finishes
              first. Space does the same. */}
          <div className="voice-controls">
            {voice.paused && voice.status !== "paused" && (
              <span className="voice-controls-note">Pauses after this reply</span>
            )}
            <button
              type="button"
              className={`voice-pause-btn${voice.paused ? " is-paused" : ""}`}
              onClick={voice.togglePause}
              aria-pressed={voice.paused}
              title={voice.paused ? "Resume listening (Space)" : "Pause listening (Space)"}
            >
              {voice.paused ? (
                <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
                  <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
                  <rect x="6" y="5" width="4" height="14" rx="1.5" />
                  <rect x="14" y="5" width="4" height="14" rx="1.5" />
                </svg>
              )}
              {voice.paused ? "Resume" : "Pause"}
              <kbd>Space</kbd>
            </button>
          </div>
        </div>
      )}

      {focusedMode && (
        <div
          className="voice-overlay focused-overlay"
          data-reader-theme={readerPrefs.theme}
          data-reader-font={readerPrefs.font}
          data-reader-width={readerPrefs.width}
          style={{ "--reader-scale": READER_SIZES[readerPrefs.size] } as React.CSSProperties}
        >
          <FocusedReaderMenu prefs={readerPrefs} onChange={setReaderPrefs} />
          <button
            className="voice-close-btn"
            onClick={() => setFocusedMode(false)}
            aria-label="Exit focused mode"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 18 18"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
            >
              <line x1="2" y1="2" x2="16" y2="16" />
              <line x1="16" y1="2" x2="2" y2="16" />
            </svg>
          </button>

          <div className="focused-scroll" ref={focusedScrollRef}>
            <div className="voice-lyrics">
              {focusedAll.map((line, i) => {
                // Lines step down by distance from the focused one (the latest, unless the user
                // has moved the focus with the arrow keys)
                const distance = Math.abs(i - focusNav.current);
                const isLive = focusedLive !== null && i === focusedAll.length - 1;
                const ageClass =
                  distance === 0 && isLive
                    ? "voice-lyric--current"
                    : distance <= 2
                      ? `voice-lyric--age-${distance}`
                      : "voice-lyric--history";
                const paraFocus = distance === 0 && focusNav.para !== null;
                return (
                  <p
                    key={isLive ? "assistant-live" : i}
                    data-line={i}
                    className={`voice-lyric ${ageClass} voice-lyric--${line.role}${paraFocus ? " has-para-focus" : ""}${focusNav.speaking === i ? " is-speaking" : ""}`}
                    onClick={() => {
                      // Selecting text shouldn't move the focus
                      if (!window.getSelection()?.toString()) focusNav.goTo(i);
                    }}
                  >
                    {paraFocus
                      ? splitParas(line.text).map((part, k, all) => (
                          <span key={k}>
                            <span
                              data-para={k}
                              className={`lyric-para${k === focusNav.para ? " is-focus" : ""}`}
                            >
                              {renderLyric(part, isLive)}
                            </span>
                            {k < all.length - 1 && "\n\n"}
                          </span>
                        ))
                      : renderLyric(line.text, isLive)}
                  </p>
                );
              })}
            </div>
          </div>

          {/* Where the focus is in the conversation: a tick per message, shown while
              navigating. Clicking a tick jumps there. */}
          <div
            className={`focused-rail${focusNav.navigating ? " is-visible" : ""}`}
            style={{ height: `min(56vh, ${focusedAll.length * 12}px)` }}
            aria-hidden={!focusNav.navigating}
          >
            {focusedAll.map((line, i) => (
              <button
                key={i}
                type="button"
                className={`focused-rail-tick is-${line.role}${i === focusNav.current ? " is-on" : ""}`}
                onClick={() => focusNav.goTo(i)}
                tabIndex={focusNav.navigating ? 0 : -1}
                aria-label={`Go to message ${i + 1}`}
              />
            ))}
          </div>

          {focusNav.toast && (
            <div className="focused-toast" role="status">
              {focusNav.toast}
            </div>
          )}

          <div className="focused-input-wrap">
            {focusNav.navigating && (
              <button
                type="button"
                className="focused-latest-chip"
                onClick={focusNav.backToLatest}
                title="Back to the latest (Esc)"
              >
                {focusNav.hasNew && <span className="focused-latest-dot" aria-hidden="true" />}
                <svg
                  viewBox="0 0 24 24"
                  width="16"
                  height="16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <polyline points="6 13 12 19 18 13" />
                </svg>
                Latest
                <kbd>Esc</kbd>
              </button>
            )}
            <div className={`focused-input-row${loading ? " thinking" : ""}`}>
              <textarea
                ref={focusedTextareaRef}
                className="focused-textarea"
                value={focusedInput}
                onChange={(e) => setFocusedInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    submitFocused();
                  }
                }}
                placeholder="Type your message…"
                rows={1}
                disabled={loading}
              />
              {/* One button that is whatever the moment needs: stop while a reply comes in,
                  send once there is something to send, and Talk when the field is empty */}
              {loading ? (
                <button
                  key="stop"
                  type="button"
                  className="focused-action-btn"
                  onClick={handleStop}
                  title="Stop generation"
                  aria-label="Stop generation"
                >
                  <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor">
                    <rect x="5" y="5" width="14" height="14" rx="3" />
                  </svg>
                </button>
              ) : focusedInput.trim() ? (
                <button
                  key="send"
                  type="button"
                  className="focused-action-btn is-send"
                  onClick={submitFocused}
                  title="Send (Enter)"
                  aria-label="Send"
                >
                  <svg
                    viewBox="0 0 24 24"
                    width="16"
                    height="16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <line x1="12" y1="19" x2="12" y2="5" />
                    <polyline points="6 11 12 5 18 11" />
                  </svg>
                </button>
              ) : (
                <button
                  key="talk"
                  type="button"
                  className="focused-action-btn"
                  onClick={() => {
                    setFocusedMode(false);
                    if (!voice.isActive) voice.toggle();
                  }}
                  title="Switch to Talk"
                  aria-label="Switch to Talk"
                >
                  <svg
                    viewBox="0 0 24 24"
                    width="16"
                    height="16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <rect x="9" y="2" width="6" height="11" rx="3" />
                    <path d="M5 10a7 7 0 0 0 14 0" />
                    <line x1="12" y1="17" x2="12" y2="21" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {showPreferences && (
        <ChatPreferences
          systemPrompt={systemPrompt}
          setSystemPrompt={setSystemPrompt}
          onClose={() => {
            setShowPreferences(false);
            setPrefSection(undefined);
          }}
          activePreset={activePreset}
          setActivePreset={setActivePreset}
          theme={theme}
          setTheme={setTheme}
          font={font}
          setFont={setFont}
          avatarColor={avatarColor}
          setAvatarColor={setAvatarColor}
          temperature={temperature}
          setTemperature={setTemperature}
          topP={topP}
          setTopP={setTopP}
          numPredict={numPredict}
          setNumPredict={setNumPredict}
          speechRate={speechRate}
          setSpeechRate={setSpeechRate}
          models={models}
          modelCapabilities={modelCapabilities}
          selectedModel={selectedModel}
          setSelectedModel={setSelectedModel}
          gameModel={gameModel}
          setGameModel={setGameModel}
          studioModel={studioModel}
          setStudioModel={setStudioModel}
          serverGameModel={serverDefaults.game}
          initialSection={prefSection}
          onNameChange={(name) => setUserName(name)}
          onLogout={() => {
            setShowPreferences(false);
            setShowLogoutConfirm(true);
          }}
          onDeleteAccount={async () => {
            await apiDeleteAccount();
            localStorage.removeItem("token");
            localStorage.removeItem("refresh_token");
            onBack();
          }}
          onClearAllChats={async () => {
            await Promise.all(chats.map((c) => apiDeleteChat(c.id)));
            handleNewChat();
            await onChatsChanged();
          }}
        />
      )}
    </WebDevContext.Provider>
  );
}

export default Chat;
