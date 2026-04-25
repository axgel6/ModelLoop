import { useEffect, useRef, useState } from "react";
import ChatPreferences, { type Theme } from "./ChatPreferences";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import {
  apiChatStream,
  apiCreateChat,
  apiDeleteAccount,
  apiDeleteChat,
  apiGetMessages,
  apiGetModels,
  apiGuestChatStream,
  apiHealth,
  apiRenameChat,
  type ChatMeta,
  type Message,
} from "./api";

function fixMathDelimiters(text: string): string {
  // Convert \[...\] and \(...\) to remark-math dollar delimiters
  text = text
    .replace(/\\\[(.+?)\\\]/gs, "$$$$1$$")
    .replace(/\\\((.+?)\\\)/gs, "$$$1$$")
    .replace(/\[\s*([^[\]]*\\[a-zA-Z]+[^[\]]*)\s*\]/g, "$$$$1$$")
    .replace(/\[\s*(\d+[^[\]]*[+\-*/=][^[\]]*\d+[^[\]]*)\s*\]/g, "$$$$1$$");

  // Escape $ signs used as currency so they don't confuse the math parser.
  // Strategy: protect already-valid math spans, then escape lone $ before digits.
  const saved: string[] = [];
  // Protect $$...$$ (display math) first
  text = text.replace(/\$\$[\s\S]+?\$\$/g, (m) => {
    saved.push(m);
    return `\x00${saved.length - 1}\x00`;
  });
  // Protect $...$ (inline math): content must not start/end with whitespace, no newline
  text = text.replace(/\$(?!\s)(?:[^$\n\\]|\\.)+?(?<!\s)\$/g, (m) => {
    saved.push(m);
    return `\x00${saved.length - 1}\x00`;
  });
  // Escape lone $ before a digit (currency like $6, $0.70)
  text = text.replace(/\$(?=\d)/g, "\\$");
  // Restore protected math spans
  text = text.replace(/\x00(\d+)\x00/g, (_, i) => saved[parseInt(i)]);
  return text;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const diffDays = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const SUGGESTIONS = [
  "Explain something complex simply",
  "Help me write clean code",
  "Solve a math problem step by step",
  "Summarize a topic for me",
];

const MANDATORY_SYSTEM_PROMPT_RULES = `Important rules:
1. Always consider the conversation history when answering follow-up questions
2. When the user says "add X" or similar, apply it to the previous result
3. For math expressions use \\( ... \\) for inline math and \\[ ... \\] for display math - never use $ as a math delimiter since it conflicts with currency symbols`;

const DEFAULT_SYSTEM_PROMPT =
  "You are a helpful assistant. Be concise and avoid over-explaining simple questions.";

function withMandatoryPromptRules(prompt: string): string {
  const trimmedPrompt = prompt.trim();
  if (!trimmedPrompt) return MANDATORY_SYSTEM_PROMPT_RULES;
  if (trimmedPrompt.includes(MANDATORY_SYSTEM_PROMPT_RULES))
    return trimmedPrompt;
  return `${MANDATORY_SYSTEM_PROMPT_RULES}\n\n${trimmedPrompt}`;
}

const SLASH_COMMANDS = [
  { cmd: "/clear", desc: "Clear conversation" },
  { cmd: "/code", desc: "Code mode (deepseek-r1)" },
  { cmd: "/math", desc: "Math mode (deepseek-r1)" },
  { cmd: "/help", desc: "Show commands" },
];

// Pre block with per-code-block copy button; defined outside Chat to avoid re-mounting
function Pre({
  children,
  node: _node,
  ...props
}: React.ComponentPropsWithoutRef<"pre"> & { node?: unknown }) {
  const [copied, setCopied] = useState(false);
  const preRef = useRef<HTMLPreElement>(null);

  const handleCopy = () => {
    navigator.clipboard.writeText(preRef.current?.textContent ?? "");
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="code-block-wrapper">
      <pre ref={preRef} {...props}>
        {children}
      </pre>
      <button
        className={`code-copy-btn${copied ? " copied" : ""}`}
        onClick={handleCopy}
        title={copied ? "Copied!" : "Copy code"}
      >
        {copied ? (
          <svg
            viewBox="0 0 24 24"
            width="12"
            height="12"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ) : (
          <svg
            viewBox="0 0 24 24"
            width="12"
            height="12"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        )}
      </button>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const MD_COMPONENTS = { pre: Pre as any };

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
}: ChatProps) {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const thinkingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const messageCache = useRef<Map<string, Message[]>>(new Map());
  const [models, setModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [isConnected, setIsConnected] = useState(false);
  const modelsLoadedRef = useRef(false);
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_SYSTEM_PROMPT);
  const [showPreferences, setShowPreferences] = useState(false);
  const [activePreset, setActivePreset] = useState<string>("Default");
  const [temperature, setTemperature] = useState(0.7);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(window.screen.width >= 1024);
  const [historySearch, setHistorySearch] = useState("");
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [slashIdx, setSlashIdx] = useState(-1);

  const adjustTextareaHeight = () => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 180) + "px";
  };

  const resetTextareaHeight = () => {
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  };

  // Track whether user is near the bottom of the message list
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    const onScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      setShowScrollBtn(scrollHeight - scrollTop - clientHeight > 120);
    };
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => container.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (container)
      container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    const loadModels = async () => {
      try {
        const availableModels = await apiGetModels();
        setModels(availableModels);
        setIsConnected(true);
        modelsLoadedRef.current = true;
        if (availableModels.length > 0) setSelectedModel(availableModels[0]);
      } catch {
        setIsConnected(false);
      }
    };
    loadModels();

    const modelRetryInterval = setInterval(async () => {
      if (modelsLoadedRef.current) {
        clearInterval(modelRetryInterval);
        return;
      }
      try {
        const availableModels = await apiGetModels();
        setModels(availableModels);
        setIsConnected(true);
        modelsLoadedRef.current = true;
        if (availableModels.length > 0) setSelectedModel(availableModels[0]);
        clearInterval(modelRetryInterval);
      } catch {
        setIsConnected(false);
      }
    }, 5000);

    let healthFailures = 0;
    const healthInterval = setInterval(async () => {
      if (!modelsLoadedRef.current) return;
      try {
        const ok = await apiHealth();
        setIsConnected(ok);
        healthFailures = 0;
      } catch {
        healthFailures++;
        if (healthFailures >= 3) setIsConnected(false);
      }
    }, 30000);

    return () => {
      clearInterval(modelRetryInterval);
      clearInterval(healthInterval);
    };
  }, []);

  const activeChatIdRef = useRef<string | null>(activeChatId);
  activeChatIdRef.current = activeChatId;
  const justCreatedChatRef = useRef(false);

  useEffect(() => {
    if (!activeChatId) {
      setMessages([]);
      return;
    }
    if (justCreatedChatRef.current) {
      justCreatedChatRef.current = false;
      return;
    }
    const load = async () => {
      const cached = messageCache.current.get(activeChatId);
      if (cached) setMessages(cached);
      else setMessagesLoading(true);
      try {
        const msgs = await apiGetMessages(activeChatId);
        messageCache.current.set(activeChatId, msgs);
        setMessages(msgs);
      } catch {
        console.error("Failed to load messages for chat", activeChatId);
      } finally {
        setMessagesLoading(false);
      }
    };
    load();
  }, [activeChatId]);

  const ensureChatId = async (): Promise<string | null> => {
    if (activeChatIdRef.current) return activeChatIdRef.current;
    try {
      const chat = await apiCreateChat();
      activeChatIdRef.current = chat.id;
      justCreatedChatRef.current = true;
      onChatCreated(chat.id, chat);
      void onChatsChanged();
      return chat.id;
    } catch {
      console.error("Failed to create chat");
      return null;
    }
  };

  const handleAsk = async (
    overridePrompt?: string,
    historyOverride?: Message[],
  ) => {
    const rawInput = (overridePrompt ?? input).trim();
    if (!rawInput || loading) return;

    // --- Slash commands ---
    if (rawInput === "/clear") {
      setMessages([]);
      setInput("");
      onChatCreated("");
      return;
    }
    if (rawInput === "/code") {
      setSelectedModel("deepseek-r1:1.5b");
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Switched to code mode." },
      ]);
      setSystemPrompt(
        `You are a world-class Software Engineer and Technical Educator. Your goal is to provide the most computationally efficient solution to coding problems while ensuring the logic is crystal clear for other developers to maintain. When providing a solution: 1. Analyze Efficiency: Before writing code, briefly identify the time and space complexity (\$O(n)\$, \$O(\log n)\$, etc.) and explain why this approach is the most optimized. 2. Write Clean, Professional Code: Follow industry standard naming conventions and best practices for the specific programming language requested. 3. Strategic Commenting: Use "why, not what" comments. Do not explain obvious syntax; instead, explain the intent behind complex logic or optimization tricks. 4. Step-by-Step Breakdown: Step 1: The Logic. Explain the mental model or algorithm (e.g., Two Pointers, Dynamic Programming, or Memoization) used to solve the problem. Step 2: The Implementation. Provide the code block with syntax highlighting. Step 3: The "Why". Explain why specific functions or data structures were chosen over less efficient alternatives. 5. Edge Case Handling: Explicitly mention how the code handles null inputs, empty collections, or large-scale data. 6. Summary: Conclude with a "Developer's Note" on the key takeaway or pattern that makes this solution superior to a brute-force approach. Formatting Rules: Use clear headings for each section. Use Markdown code blocks with the correct language tag. Use LaTeX for all complexity analysis and mathematical proofs.`,
      );
      setInput("");
      return;
    }
    if (rawInput === "/math") {
      setSelectedModel("deepseek-r1:1.5b");
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Switched to math mode." },
      ]);
      setSystemPrompt(
        "You are an expert teacher who explains problems clearly and patiently. Your goal is not just to give the answer, but to teach the reasoning behind it. When solving a problem: Break the solution into clear, numbered steps. Each step should be separated and easy to follow. Explain what is happening in each step using simple language. Explain why the step is necessary so the learner understands the logic, not just the procedure. Show the intermediate work, not just the final result. Define any important terms or concepts that appear during the explanation. Use examples or small reminders of rules (formulas, properties, or definitions) when they are applied. After solving the problem, include a short summary of the key idea or pattern that helps recognize similar problems in the future. Formatting rules: Use numbered steps. Keep explanations concise but clear. Separate calculations from explanations when helpful. The goal is to help the learner understand how to think through the problem, not just memorize the answer.",
      );
      setInput("");
      return;
    }
    if (rawInput === "/help") {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content:
            "Commands: /clear, /code, /math, /help\nShortcuts: Ctrl+H (toggle sidebar), Ctrl+P (preferences)",
        },
      ]);
      setInput("");
      return;
    }

    // --- Normal flow ---
    const userMessage = rawInput;
    const historyForGuest = isGuest ? (historyOverride ?? [...messages]) : null;

    setLoading(true);
    setInput("");
    resetTextareaHeight();
    setSlashIdx(-1);
    setMessages((prev) => [
      ...prev,
      {
        role: "user",
        content: userMessage,
        created_at: new Date().toISOString(),
      },
    ]);

    let chatId: string | null = null;
    if (!isGuest) {
      chatId = await ensureChatId();
      if (!chatId) {
        setMessages((prev) => prev.slice(0, -1));
        setLoading(false);
        return;
      }
    }

    setMessages((prev) => [
      ...prev,
      { role: "assistant", content: "", created_at: new Date().toISOString() },
    ]);
    thinkingTimerRef.current = setTimeout(() => setIsThinking(true), 2000);

    const ctrl = new AbortController();
    abortControllerRef.current = ctrl;

    try {
      const response = isGuest
        ? await apiGuestChatStream(
            {
              prompt: userMessage,
              messages: historyForGuest!,
              model: selectedModel || undefined,
              system_prompt: withMandatoryPromptRules(systemPrompt),
              temperature,
            },
            ctrl.signal,
          )
        : await apiChatStream(
            {
              prompt: userMessage,
              chat_id: chatId!,
              model: selectedModel || undefined,
              system_prompt: withMandatoryPromptRules(systemPrompt),
              temperature,
            },
            ctrl.signal,
          );

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error("Failed to get response stream");

      let accumulatedResponse = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const line of decoder
          .decode(value, { stream: true })
          .split("\n")) {
          if (!line.startsWith("data: ")) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === "token") {
              if (thinkingTimerRef.current) {
                clearTimeout(thinkingTimerRef.current);
                thinkingTimerRef.current = null;
              }
              setIsThinking(false);
              accumulatedResponse += data.token;
              setMessages((prev) => {
                const next = [...prev];
                next[next.length - 1] = {
                  ...next[next.length - 1],
                  content: accumulatedResponse,
                };
                return next;
              });
            } else if (data.type === "done") {
              if (!isGuest) onChatsChanged();
            } else if (data.type === "error") {
              throw new Error(data.error);
            }
          } catch (e) {
            if (e instanceof SyntaxError) continue;
            throw e;
          }
        }
      }
    } catch (error) {
      // AbortError = user hit stop; keep whatever streamed so far
      if (error instanceof Error && error.name === "AbortError") {
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
      if (thinkingTimerRef.current) {
        clearTimeout(thinkingTimerRef.current);
        thinkingTimerRef.current = null;
      }
      setIsThinking(false);
      setLoading(false);
      setMessages((prev) => {
        if (activeChatIdRef.current)
          messageCache.current.set(activeChatIdRef.current, prev);
        return prev;
      });
    }
  };

  const handleStop = () => {
    abortControllerRef.current?.abort();
  };

  const handleRetry = () => {
    if (loading) return;
    const msgs = [...messages];
    let cutIdx = msgs.length;
    // Remove trailing assistant messages
    while (cutIdx > 0 && msgs[cutIdx - 1].role === "assistant") cutIdx--;
    // Need a user message just before
    if (cutIdx === 0 || msgs[cutIdx - 1].role !== "user") return;
    const lastUserContent = msgs[cutIdx - 1].content;
    cutIdx--;
    const truncated = msgs.slice(0, cutIdx);
    setMessages(truncated);
    handleAsk(lastUserContent, truncated);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (slashMatches.length > 0) {
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashIdx((i) => (i <= 0 ? slashMatches.length - 1 : i - 1));
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashIdx((i) => (i >= slashMatches.length - 1 ? 0 : i + 1));
        return;
      }
      if (e.key === "Tab" && slashIdx >= 0) {
        e.preventDefault();
        setInput(slashMatches[slashIdx].cmd);
        setSlashIdx(-1);
        return;
      }
      if (e.key === "Enter" && slashIdx >= 0) {
        e.preventDefault();
        setInput(slashMatches[slashIdx].cmd);
        setSlashIdx(-1);
        return;
      }
      if (e.key === "Escape") {
        setSlashIdx(-1);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleAsk();
    }
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey || event.altKey || event.metaKey) return;
      const key = event.key.toLowerCase();
      if (key !== "h" && key !== "p") return;
      event.preventDefault();
      const isTyping =
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement;
      if (isTyping) return;
      event.stopImmediatePropagation();
      if (key === "h") setSidebarOpen((v) => !v);
      if (key === "p" && !showPreferences) setShowPreferences(true);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [showPreferences]);

  const handleNewChat = () => {
    setMessages([]);
    setInput("");
    activeChatIdRef.current = null;
    onChatCreated("");
  };

  const handleLogout = () => {
    localStorage.removeItem("token");
    onLogout();
  };

  const handleCopy = (content: string, idx: number) => {
    navigator.clipboard.writeText(content);
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 1500);
  };

  const handleDeleteChat = async (id: string) => {
    setDeletingIds((prev) => new Set(prev).add(id));
    if (id === activeChatId) handleNewChat();
    try {
      await apiDeleteChat(id);
      await onChatsChanged();
    } catch {
      /* silently ignore */
    } finally {
      setDeletingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const handleRenameCommit = async (id: string) => {
    const trimmed = renameValue.trim();
    setRenamingId(null);
    if (!trimmed) return;
    try {
      await apiRenameChat(id, trimmed);
      await onChatsChanged();
    } catch {
      /* silently ignore */
    }
  };

  const filteredChats = chats.filter((c) =>
    (c.title || "").toLowerCase().includes(historySearch.toLowerCase()),
  );
  const visibleChats = filteredChats.filter((c) => !deletingIds.has(c.id));

  const activeChat = chats.find((c) => c.id === activeChatId);
  const chatTitle = activeChat?.title ?? (activeChatId ? "Chat" : "New Chat");

  // Slash command matches based on current input
  const slashMatches =
    input.startsWith("/") && !loading
      ? SLASH_COMMANDS.filter((c) => c.cmd.startsWith(input.split(" ")[0]))
      : [];

  return (
    <>
      {!isConnected && (
        <div className="connection-banner">
          Waiting for backend to wake up… (This may take a moment)
        </div>
      )}

      <div className="chat-layout">
        {/* ---- Sidebar ---- */}
        {!isGuest && sidebarOpen && (
          <aside className="chat-sidebar">
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
                onClick={() => setSidebarOpen(false)}
                title="Close sidebar"
              >
                ☰
              </button>
            </div>

            <div className="sidebar-history">
              <input
                type="text"
                className="sidebar-search"
                placeholder="Search…"
                value={historySearch}
                onChange={(e) => setHistorySearch(e.target.value)}
              />
              <div className="sidebar-chat-list">
                {chatsLoading && visibleChats.length === 0 && (
                  <span className="sidebar-empty">Loading…</span>
                )}
                {!chatsLoading && visibleChats.length === 0 && (
                  <span className="sidebar-empty">No chats yet</span>
                )}
                {visibleChats.map((c) => (
                  <div
                    key={c.id}
                    className={`sidebar-chat-item${c.id === activeChatId ? " active" : ""}`}
                    onClick={() => {
                      onChatCreated(c.id);
                      if (window.innerWidth < 768) setSidebarOpen(false);
                    }}
                  >
                    <div className="sidebar-chat-info">
                      <span className="sidebar-chat-title">
                        {c.title || "Untitled"}
                      </span>
                      <span className="sidebar-chat-date">
                        {formatDate(c.updated_at)}
                      </span>
                    </div>
                    <button
                      className="sidebar-delete-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteChat(c.id);
                      }}
                      disabled={deletingIds.has(c.id)}
                      title="Delete chat"
                    >
                      {deletingIds.has(c.id) ? "…" : "✕"}
                    </button>
                  </div>
                ))}
              </div>
            </div>
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
                  ☰
                </button>
              )}
            </div>

            {activeChatId && !isGuest && renamingId === activeChatId ? (
              <input
                className="topbar-rename-input"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={() => handleRenameCommit(activeChatId)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleRenameCommit(activeChatId);
                  if (e.key === "Escape") setRenamingId(null);
                  e.stopPropagation();
                }}
                autoFocus
              />
            ) : (
              <span
                className="topbar-title"
                onDoubleClick={() => {
                  if (!activeChatId || isGuest) return;
                  setRenamingId(activeChatId);
                  setRenameValue(activeChat?.title || "");
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
                  title="New chat"
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
                </button>
              )}
              <button
                className="topbar-icon-btn"
                onClick={() => setShowPreferences(true)}
                title="Preferences (Ctrl+P)"
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
              </button>
              <button
                className="topbar-icon-btn"
                onClick={() =>
                  isGuest ? handleLogout() : setShowLogoutConfirm(true)
                }
                title={isGuest ? "Sign In" : "Sign Out"}
                aria-label={isGuest ? "Sign In" : "Sign Out"}
              >
                {isGuest ? (
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
                ) : (
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
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                    <polyline points="16 17 21 12 16 7" />
                    <line x1="21" y1="12" x2="9" y2="12" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          {/* Messages */}
          <div className="messages" ref={messagesContainerRef}>
            {messagesLoading && (
              <p id="disclaimer" className="messages-loading">
                Loading…
              </p>
            )}

            {!messagesLoading && messages.length === 0 && (
              <div className="empty-state">
                <h2 className="empty-title">What can I help with?</h2>
                <div className="suggestion-chips">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      className="suggestion-chip"
                      onClick={() => handleAsk(s)}
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

            {messages.map((msg, idx) => {
              const ts = msg.created_at
                ? new Date(msg.created_at).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : null;
              const isLastAssistant =
                idx === messages.length - 1 && msg.role === "assistant";
              return (
                <div key={idx} className={`message-row ${msg.role}`}>
                  {msg.role === "assistant" ? (
                    <div className="msg-bubble-group">
                      <div className="message assistant">
                        <div className="assistant-content">
                          {msg.content === "" &&
                          isThinking &&
                          idx === messages.length - 1 ? (
                            <div className="thinking-indicator">
                              Thinking
                              <span className="thinking-dot">.</span>
                              <span className="thinking-dot">.</span>
                              <span className="thinking-dot">.</span>
                            </div>
                          ) : (
                            <ReactMarkdown
                              remarkPlugins={[remarkGfm, remarkMath]}
                              rehypePlugins={[rehypeKatex, rehypeHighlight]}
                              components={MD_COMPONENTS}
                            >
                              {fixMathDelimiters(msg.content)}
                            </ReactMarkdown>
                          )}
                        </div>
                      </div>
                      <div className="msg-meta">
                        {ts && <span className="msg-timestamp">{ts}</span>}
                        <div className="msg-actions">
                          {msg.content && (
                            <button
                              className={`copy-btn${copiedIdx === idx ? " copied" : ""}`}
                              onClick={() => handleCopy(msg.content, idx)}
                              title={copiedIdx === idx ? "Copied!" : "Copy"}
                            >
                              {copiedIdx === idx ? (
                                <svg
                                  viewBox="0 0 24 24"
                                  width="13"
                                  height="13"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2.5"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                >
                                  <polyline points="20 6 9 17 4 12" />
                                </svg>
                              ) : (
                                <svg
                                  viewBox="0 0 24 24"
                                  width="13"
                                  height="13"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="1.8"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                >
                                  <rect
                                    x="9"
                                    y="9"
                                    width="13"
                                    height="13"
                                    rx="2"
                                    ry="2"
                                  />
                                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                                </svg>
                              )}
                            </button>
                          )}
                          {isLastAssistant && msg.content && !loading && (
                            <button
                              className="retry-btn"
                              onClick={handleRetry}
                              title="Retry"
                            >
                              <svg
                                viewBox="0 0 24 24"
                                width="13"
                                height="13"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.8"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              >
                                <polyline points="1 4 1 10 7 10" />
                                <path d="M3.51 15a9 9 0 1 0 .49-4" />
                              </svg>
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="message user">{msg.content}</div>
                  )}
                  {msg.role === "user" && ts && (
                    <div className="msg-timestamp">{ts}</div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Scroll to bottom button */}
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

          {/* Input */}
          <div className="input-area">
            {/* Slash command autocomplete */}
            {slashMatches.length > 0 && (
              <div className="slash-dropdown">
                {slashMatches.map((item, i) => (
                  <div
                    key={item.cmd}
                    className={`slash-item${slashIdx === i ? " active" : ""}`}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setInput(item.cmd);
                      setSlashIdx(-1);
                      textareaRef.current?.focus();
                    }}
                    onMouseEnter={() => setSlashIdx(i)}
                  >
                    <span className="slash-item-cmd">{item.cmd}</span>
                    <span className="slash-item-desc">{item.desc}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="input-wrapper">
              <textarea
                ref={textareaRef}
                className="chat-textarea"
                autoFocus
                rows={1}
                placeholder="What's on your mind?"
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  adjustTextareaHeight();
                  if (!e.target.value.startsWith("/")) setSlashIdx(-1);
                }}
                onKeyDown={handleKeyDown}
                disabled={loading}
              />
              <button
                className={`ask-button${loading ? " stopping" : ""}`}
                onClick={loading ? handleStop : () => handleAsk()}
                disabled={!loading && !input.trim()}
                title={loading ? "Stop generation" : "Send (Enter)"}
              >
                {loading ? (
                  <svg
                    viewBox="0 0 24 24"
                    width="14"
                    height="14"
                    fill="currentColor"
                  >
                    <rect x="4" y="4" width="16" height="16" rx="2" />
                  </svg>
                ) : (
                  <span style={{ paddingTop: "2px" }}>➤</span>
                )}
              </button>
            </div>
          </div>
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

      {showPreferences && (
        <ChatPreferences
          systemPrompt={systemPrompt}
          setSystemPrompt={setSystemPrompt}
          onClose={() => setShowPreferences(false)}
          activePreset={activePreset}
          setActivePreset={setActivePreset}
          theme={theme}
          setTheme={setTheme}
          temperature={temperature}
          setTemperature={setTemperature}
          models={models}
          selectedModel={selectedModel}
          setSelectedModel={setSelectedModel}
          onDeleteAccount={async () => {
            await apiDeleteAccount();
            localStorage.removeItem("token");
            localStorage.removeItem("refresh_token");
            onBack();
          }}
        />
      )}
    </>
  );
}

export default Chat;
