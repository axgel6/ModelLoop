import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { haptics } from "../haptics";
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
  apiCreateChat,
  apiDeleteAccount,
  apiDeleteChat,
  apiGetMe,
  apiGetMyFeatures,
  apiGetGuestFeatures,
  apiGuestChatStream,
  apiListDocuments,
  apiUploadDocument,
  apiDeleteDocument,
  apiRenameChat,
  type ChatMeta,
  type DocumentMeta,
  type Message,
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
  GREETINGS,
  withMandatoryPromptRules,
} from "./utils/chatUtils";
import ConnectionBanner from "./ConnectionBanner";

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
        <span className="sidebar-chat-title">{c.title || "Untitled"}</span>
        <span className="sidebar-chat-date">{formatDate(c.updated_at)}</span>
      </div>
      <button
        className="sidebar-pin-btn"
        onClick={onPin}
        title={pinned ? "Unpin chat" : "Pin chat"}
      >
        <svg
          width="11"
          height="11"
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
        {deleting ? "…" : "✕"}
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
  const [prefSection, setPrefSection] = useState<PrefSection>("model");

  const {
    sidebarOpen,
    setSidebarOpen,
    historySearch,
    setHistorySearch,
    showLogoutConfirm,
    setShowLogoutConfirm,
    showScrollBtn,
    messagesContainerRef,
    scrollToBottom,
  } = useChatUI(messages, loading);

  const [sidebarClosing, setSidebarClosing] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);

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
  useEffect(() => { scrollToBottom(); }, [activeTool, scrollToBottom]);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [userName, setUserName] = useState<string | null>(null);
  const [features, setFeatures] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (isGuest) {
      apiGetGuestFeatures()
        .then(setFeatures)
        .catch(() => {});
      return;
    }
    apiGetMe()
      .then((me) => {
        setUserRole(me.role);
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

  const chatGreeting = useMemo(
    () => GREETINGS[Math.floor(Math.random() * GREETINGS.length)],
    [],
  );

  const chatSuggestions = useMemo(() => pickSuggestions(4), []);

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
      if (key !== "h" && key !== "p") return;
      e.preventDefault();
      if (isTyping) return;
      e.stopImmediatePropagation();
      if (key === "h") setSidebarOpen((v) => !v);
      if (key === "p" && !showPreferences && !isGuest) setShowPreferences(true);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [showPreferences]);

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
      setDocUploadError(err instanceof Error ? err.message : "Upload failed");
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
    options?: { forceSearch?: boolean },
  ) => {
    const rawInput = prompt.trim();
    if (!rawInput || loading) return;

    if (rawInput === "/clear") {
      setMessages([]);
      onChatCreated("");
      return;
    }
    if (rawInput.startsWith("/search ")) {
      const query = rawInput.slice("/search ".length).trim();
      if (!query) return;
      void handleAsk(query, undefined, undefined, { forceSearch: true });
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
    if (rawInput === "/code") {
      setSelectedModel("qwen2.5-coder:7b");
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Switched to code mode." },
      ]);
      setSystemPrompt(
        `You are a world-class Software Engineer and Technical Educator. Your goal is to provide the most computationally efficient solution to coding problems while ensuring the logic is crystal clear for other developers to maintain. When providing a solution: 1. Analyze Efficiency: Before writing code, briefly identify the time and space complexity (\$O(n)\$, \$O(\log n)\$, etc.) and explain why this approach is the most optimized. 2. Write Clean, Professional Code: Follow industry standard naming conventions and best practices for the specific programming language requested. 3. Strategic Commenting: Use "why, not what" comments. Do not explain obvious syntax; instead, explain the intent behind complex logic or optimization tricks. 4. Step-by-Step Breakdown: Step 1: The Logic. Explain the mental model or algorithm (e.g., Two Pointers, Dynamic Programming, or Memoization) used to solve the problem. Step 2: The Implementation. Provide the code block with syntax highlighting. Step 3: The "Why". Explain why specific functions or data structures were chosen over less efficient alternatives. 5. Edge Case Handling: Explicitly mention how the code handles null inputs, empty collections, or large-scale data. 6. Summary: Conclude with a "Developer's Note" on the key takeaway or pattern that makes this solution superior to a brute-force approach. Formatting Rules: Use clear headings for each section. Use Markdown code blocks with the correct language tag. Use LaTeX for all complexity analysis and mathematical proofs.`,
      );
      return;
    }
    if (rawInput === "/math") {
      setSelectedModel("deepseek-r1:7b");
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Switched to math mode." },
      ]);
      setSystemPrompt(
        "You are an expert teacher who explains problems clearly and patiently. Your goal is not just to give the answer, but to teach the reasoning behind it. When solving a problem: Break the solution into clear, numbered steps. Each step should be separated and easy to follow. Explain what is happening in each step using simple language. Explain why the step is necessary so the learner understands the logic, not just the procedure. Show the intermediate work, not just the final result. Define any important terms or concepts that appear during the explanation. Use examples or small reminders of rules (formulas, properties, or definitions) when they are applied. After solving the problem, include a short summary of the key idea or pattern that helps recognize similar problems in the future. Formatting rules: Use numbered steps. Keep explanations concise but clear. Separate calculations from explanations when helpful. The goal is to help the learner understand how to think through the problem, not just memorize the answer.",
      );
      return;
    }
    if (rawInput === "/think") {
      setSelectedModel("deepseek-r1:7b");
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Switched to thinking mode." },
      ]);
      return;
    }
    if (rawInput === "/fast") {
      setSelectedModel("llama3.1:8b");
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Switched to fast mode." },
      ]);
      return;
    }
    if (rawInput === "/ratelimit") {
      const info = isGuest
        ? "**Rate limits (guest)**\nMessages: 5 per minute, 50 per day\n\nLog in or create an account to increase your limit to 10 messages per minute."
        : "**Rate limits (account)**\nMessages: 10 per minute";
      setMessages((prev) => [...prev, { role: "assistant", content: info }]);
      return;
    }
    if (rawInput === "/help") {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content:
            "Commands: /clear, /search <query>, /code, /math, /think, /fast, /ratelimit, /help\nShortcuts: Ctrl+H (toggle sidebar), Ctrl+P (preferences)",
        },
      ]);
      return;
    }

    const userMessage = rawInput;
    const historyForGuest = isGuest ? (historyOverride ?? [...messages]) : null;

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
    if (!isGuest) {
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
              system_prompt: systemPrompt.trim() ? withMandatoryPromptRules(systemPrompt) : undefined,
              temperature,
              top_p: topP,
              num_predict: numPredict,
              images,
            },
            ctrl.signal,
          )
        : await apiChatStream(
            {
              prompt: userMessage,
              chat_id: chatId!,
              model: selectedModel || undefined,
              system_prompt: systemPrompt.trim() ? withMandatoryPromptRules(systemPrompt) : undefined,
              temperature,
              top_p: topP,
              num_predict: numPredict,
              images,
              force_search: options?.forceSearch,
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
              if (++tokenHapticCounter % 2 === 0) haptics.trigger("light");
            } else if (data.type === "token") {
              if (localIsThinking || localActiveTool !== null) {
                localIsThinking = false;
                localActiveTool = null;
                setIsThinking(false);
                setActiveTool(null);
              }
              bufferedTokens += data.token;
              scheduleFlush();
              if (++tokenHapticCounter % 2 === 0)
                haptics.trigger(
                  tokenHapticCounter % 10 === 0 ? "selection" : "light",
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
              haptics.trigger("medium");
              if (!isGuest) onChatsChanged();
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
          : "Failed to get response from server";
      setMessages((prev) => {
        const next = [...prev];
        if (next.length > 0 && next[next.length - 1].role === "assistant") {
          next[next.length - 1] = {
            ...next[next.length - 1],
            content: `Error: ${message}`,
          };
        } else {
          next.push({ role: "assistant", content: `Error: ${message}` });
        }
        return next;
      });
    } finally {
      setIsThinking(false);
      setActiveTool(null);
      setLoading(false);
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
    setMessages([]);
    activeChatIdRef.current = null;
    onChatCreated("");
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
    const filtered = chats
      .filter((c) =>
        (c.title || "").toLowerCase().includes(historySearch.toLowerCase()),
      )
      .filter((c) => !deletingIds.has(c.id));
    const pinned = filtered.filter((c) => pinnedIds.has(c.id));
    const rest = filtered.filter((c) => !pinnedIds.has(c.id));
    return { pinned, rest };
  }, [chats, historySearch, deletingIds, pinnedIds]);

  const activeChat = chats.find((c) => c.id === activeChatId);
  const chatTitle = activeChat?.title ?? (activeChatId ? "Chat" : "New Chat");

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
    <>
      {!isConnected && <ConnectionBanner />}

      <div className="chat-layout">
        {/* ---- Sidebar ---- */}
        {!isGuest && (sidebarOpen || sidebarClosing || isMobileViewport) && (
          <div
            className={`sidebar-backdrop${sidebarOpen ? " open" : ""}`}
            onClick={closeSidebar}
          />
        )}
        {!isGuest && (sidebarOpen || sidebarClosing || isMobileViewport) && (
          <aside className={`chat-sidebar${sidebarOpen ? " open" : ""}${sidebarClosing ? " closing" : ""}`}>
            <div className="sidebar-brand">
              <button
                className="sidebar-brand-btn"
                onClick={onBack}
                title="Back to home"
              >
                ←
              </button>
              <span className="sidebar-logo">ModelLoop</span>
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

            <div className="sidebar-history">
              <input
                type="text"
                className="sidebar-search"
                placeholder="Search chats"
                value={historySearch}
                onChange={(e) => setHistorySearch(e.target.value)}
              />
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
                        activeChatId={activeChatId}
                        pinned
                        deleting={deletingIds.has(c.id)}
                        onSelect={() => {
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
                    activeChatId={activeChatId}
                    pinned={false}
                    deleting={deletingIds.has(c.id)}
                    onSelect={() => {
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

            {(userRole || userName) && (
              <div className="sidebar-footer-wrapper" ref={footerWrapperRef}>
                {showUserMenu && (() => {
                  const rect = footerWrapperRef.current?.getBoundingClientRect();
                  return (
                    <>
                      <div
                        className="sidebar-user-menu-backdrop"
                        onClick={() => setShowUserMenu(false)}
                      />
                      <div
                        className="sidebar-user-menu"
                        onClick={(e) => e.stopPropagation()}
                        style={rect ? {
                          position: "fixed",
                          bottom: `calc(100vh - ${rect.top}px + 8px)`,
                          left: rect.left + 8,
                        } : undefined}
                      >
                        <button
                          className="sidebar-user-menu-item"
                          onClick={() => {
                            setShowUserMenu(false);
                            setPrefSection("account");
                            setShowPreferences(true);
                          }}
                        >
                          <svg
                            viewBox="0 0 24 24"
                            width="14"
                            height="14"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                            <circle cx="12" cy="7" r="4" />
                          </svg>
                          Account Settings
                        </button>
                        <button
                          className="sidebar-user-menu-item"
                          onClick={() => {
                            setShowUserMenu(false);
                            setShowLogoutConfirm(true);
                          }}
                        >
                          <svg
                            viewBox="0 0 24 24"
                            width="14"
                            height="14"
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
                          Sign Out
                        </button>
                      </div>
                    </>
                  );
                })()}
                <div
                  className="sidebar-footer"
                  onClick={() => setShowUserMenu((v) => !v)}
                  style={{ cursor: "pointer" }}
                >
                  <div
                    className="sidebar-user-avatar"
                    style={avatarColor ? { background: avatarColor } : undefined}
                  >
                    {(userName ?? userRole ?? "?")[0].toUpperCase()}
                  </div>
                  <span className="sidebar-user-email" title={userName ?? ""}>
                    {userName ?? ""}
                  </span>
                  {userRole && (
                    <span
                      className={`sidebar-role-badge sidebar-role-${userRole}`}
                    >
                      {userRole}
                    </span>
                  )}
                </div>
              </div>
            )}
          </aside>
        )}

        {/* ---- Main area ---- */}
        <div className="chat-main">
          {/* Topbar */}
          <div className="chat-topbar">
            <div className="topbar-left">
              {!isGuest && !sidebarOpen && (
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
                onBlur={handleRenameCommit}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleRenameCommit();
                  if (e.key === "Escape") {
                    dispatchInteraction({ type: "rename_cancel" });
                  }
                  e.stopPropagation();
                }}
                autoFocus
              />
            ) : (
              <span
                className="topbar-title"
                onDoubleClick={() => {
                  if (!activeChatId || isGuest) return;
                  dispatchInteraction({
                    type: "rename_start",
                    id: activeChatId,
                    value: activeChat?.title || "",
                  });
                }}
                title={
                  activeChatId && !isGuest
                    ? "Double-click to rename"
                    : undefined
                }
              >
                {chatTitle}
              </span>
            )}

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
                    width="15"
                    height="15"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.25"
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
                  className="topbar-icon-btn"
                  onClick={() => setShowPreferences(true)}
                  title=""
                >
                  <svg
                    viewBox="0 0 24 24"
                    width="15"
                    height="15"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
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
                    width="15"
                    height="15"
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

          {/* Messages */}
          <div className="messages" ref={messagesContainerRef}>
            {messagesLoading && (
              <p id="disclaimer" className="messages-loading">
                Fetching your conversation…
              </p>
            )}

            {!messagesLoading && messages.length === 0 && (
              <div className="empty-state">
                <h2 className="empty-title">{chatGreeting}</h2>
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
              return messages.map((msg, idx) => (
                <div key={idx} className={`message-row ${msg.role}`}>
                  {msg.role === "assistant" ? (
                    <AssistantMessage
                      msg={msg}
                      isLast={idx === messages.length - 1}
                      canRetry={
                        idx === messages.length - 1 && !!msg.content && !loading
                      }
                      isThinking={idx === messages.length - 1 && isThinking}
                      activeTool={
                        idx === messages.length - 1 ? activeTool : null
                      }
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
                width="15"
                height="15"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
          )}

          <ChatInput
            loading={loading}
            onAsk={(prompt, images) => handleAsk(prompt, undefined, images)}
            onStop={handleStop}
            onRegisterFocus={(focusFn) => {
              inputFocusRef.current = focusFn;
            }}
            onRegisterSetInput={(setFn) => {
              inputSetRef.current = setFn;
            }}
            selectedModel={selectedModel}
            setSelectedModel={setSelectedModel}
            estimatedTokens={estimatedTokens}
            messageCount={messages.length}
            photoUploadEnabled={features.photo_upload ?? true}
            ragEnabled={features.rag ?? false}
            voiceActive={voice.isActive}
            voiceStatus={voice.status}
            voiceStatusLabel={voice.statusLabel}
            voiceTranscript={voice.transcript}
            voiceError={voice.error}
            onVoiceToggle={voice.toggle}
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
            <p>Sign out of ModelLoop?</p>
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
        <div className="voice-overlay" onClick={voice.toggle}>
          <div className={`voice-panel voice-panel--${voice.status}`} onClick={e => e.stopPropagation()}>

            {/* ── Orb ── */}
            <div
              className={`voice-orb-core${voice.status === "speaking" ? " voice-orb-core--interruptible" : ""}`}
              onClick={voice.interrupt}
            >
              <div className="voice-orb-shimmer" aria-hidden="true" />
              <div className="voice-orb-content">
                {voice.status === "listening" && (
                  <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="9" y="2" width="6" height="11" rx="3" />
                    <path d="M5 10a7 7 0 0 0 14 0" />
                    <line x1="12" y1="17" x2="12" y2="21" />
                    <line x1="9" y1="21" x2="15" y2="21" />
                  </svg>
                )}
                {voice.status === "speaking" && (
                  <div className="voice-orb-bars-large">
                    <span /><span /><span /><span /><span />
                  </div>
                )}
              </div>
              <div className="voice-orb-highlight" aria-hidden="true" />
            </div>

            {/* ── Transcript ── */}
            {voice.transcript && (
              <div className="voice-panel-transcript" key={voice.transcript}>
                {voice.transcript}
              </div>
            )}

          </div>
        </div>
      )}

      {showPreferences && (
        <ChatPreferences
          systemPrompt={systemPrompt}
          setSystemPrompt={setSystemPrompt}
          onClose={() => { setShowPreferences(false); setPrefSection("model"); }}
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
    </>
  );
}

export default Chat;
