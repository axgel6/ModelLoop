import { memo, useEffect, useMemo, useReducer, useRef, useState } from "react";
import ChatPreferences, {
  type Theme,
  type Section as PrefSection,
} from "./ChatPreferences";
import ChatInput from "./ChatInput";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { useChatSession } from "./hooks/useChatSession";
import { useChatSettings } from "./hooks/useChatSettings";
import { useChatUI } from "./hooks/useChatUI";
import {
  apiChatStream,
  apiCreateChat,
  apiDeleteAccount,
  apiDeleteChat,
  apiGuestChatStream,
  apiListDocuments,
  apiUploadDocument,
  apiDeleteDocument,
  apiRenameChat,
  type ChatMeta,
  type DocumentMeta,
  type Message,
} from "./api";

function fixMathDelimiters(text: string): string {
  text = text
    .replace(/\\\[(.+?)\\\]/gs, (_, c) => `$$${c.trim()}$$`)
    .replace(/\\\((.+?)\\\)/gs, (_, c) => `$${c.trim()}$`)
    .replace(
      /\[\s*([^[\]]*\\[a-zA-Z]+[^[\]]*)\s*\]/g,
      (_, c) => `$$${c.trim()}$$`,
    )
    .replace(
      /\[\s*(\d+[^[\]]*[+\-*/=][^[\]]*\d+[^[\]]*)\s*\]/g,
      (_, c) => `$$${c.trim()}$$`,
    );

  const saved: string[] = [];
  text = text.replace(/\$\$[\s\S]+?\$\$/g, (m) => {
    saved.push(m);
    return `\x00${saved.length - 1}\x00`;
  });
  text = text.replace(/\$(?!\s)(?:[^$\n\\]|\\.)+?(?<!\s)\$/g, (m) => {
    saved.push(m);
    return `\x00${saved.length - 1}\x00`;
  });
  text = text.replace(/\$(?=\d)/g, "\\$");
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

function fmtTime(iso: string | undefined): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

const SUGGESTIONS = [
  "Explain something complex simply",
  "Help me write clean code",
  "Solve a math problem step by step",
  "Summarize a topic for me",
];

const GREETINGS = [
  "The destination is up to you.",
  "What will you discover today?",
  "Where shall we take you next?",
  "The world is at your fingertips.",
  "Your next move starts here.",
  "Which path will you choose?",
  "What can I help with?",
];

const MANDATORY_SYSTEM_PROMPT_RULES = `Important rules:
1. Always consider the conversation history when answering follow-up questions
2. When the user says "add X" or similar, apply it to the previous result
3. For math expressions use \\( ... \\) for inline math and \\[ ... \\] for display math -/ never use $ as a math delimiter since it conflicts with currency symbols`;

function withMandatoryPromptRules(prompt: string): string {
  const trimmedPrompt = prompt.trim();
  if (!trimmedPrompt) return MANDATORY_SYSTEM_PROMPT_RULES;
  if (trimmedPrompt.includes(MANDATORY_SYSTEM_PROMPT_RULES))
    return trimmedPrompt;
  return `${MANDATORY_SYSTEM_PROMPT_RULES}\n\n${trimmedPrompt}`;
}

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

// ── Sub-components ────────────────────────────────────────────────────────────

const AssistantMessage = memo(function AssistantMessage({
  msg,
  isLast,
  canRetry,
  isThinking,
  onRetry,
}: {
  msg: Message;
  isLast: boolean;
  canRetry: boolean;
  isThinking: boolean;
  onRetry: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const ts = fmtTime(msg.created_at);

  const handleCopy = () => {
    navigator.clipboard.writeText(msg.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="msg-bubble-group">
      <div className="message assistant">
        <div className="assistant-content">
          {msg.content === "" && isThinking && isLast ? (
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
              className={`copy-btn${copied ? " copied" : ""}`}
              onClick={handleCopy}
              title={copied ? "Copied!" : "Copy"}
            >
              {copied ? (
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
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              )}
            </button>
          )}
          {canRetry && (
            <button className="retry-btn" onClick={onRetry} title="Retry">
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
  );
});

const UserMessage = memo(function UserMessage({
  msg,
  isEditing,
  editValue,
  canEdit,
  onEditStart,
  onEditChange,
  onEditSubmit,
  onEditCancel,
}: {
  msg: Message;
  isEditing: boolean;
  editValue: string;
  canEdit: boolean;
  onEditStart: () => void;
  onEditChange: (v: string) => void;
  onEditSubmit: () => void;
  onEditCancel: () => void;
}) {
  const ts = fmtTime(msg.created_at);

  return (
    <div className="msg-bubble-group user-group">
      {isEditing ? (
        <div className="user-edit-wrapper">
          <textarea
            className="user-edit-textarea"
            value={editValue}
            autoFocus
            onChange={(e) => onEditChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onEditSubmit();
              }
              if (e.key === "Escape") onEditCancel();
              e.stopPropagation();
            }}
          />
          <div className="edit-actions">
            <button className="edit-cancel-btn" onClick={onEditCancel}>
              Cancel
            </button>
            <button className="edit-save-btn" onClick={onEditSubmit}>
              Send
            </button>
          </div>
        </div>
      ) : (
        <div className="message user">
          {msg.images && msg.images.length > 0 && (
            <div className="user-message-images">
              {msg.images.map((img, i) => (
                <img
                  key={i}
                  src={`data:image/png;base64,${img}`}
                  alt="attachment"
                  className="user-message-image"
                />
              ))}
            </div>
          )}
          {msg.content}
        </div>
      )}
      <div className="msg-meta user-meta">
        {ts && <span className="msg-timestamp">{ts}</span>}
        {canEdit && (
          <div className="msg-actions">
            <button
              className="edit-msg-btn"
              onClick={onEditStart}
              title="Edit message"
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
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
            </button>
          </div>
        )}
      </div>
    </div>
  );
});

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
}

type EditState = { idx: number; value: string };
type RenameState = { id: string; value: string };

type ChatInteractionState = {
  deletingIds: Set<string>;
  renameState: RenameState | null;
  editState: EditState | null;
};

type ChatInteractionAction =
  | { type: "delete_start"; id: string }
  | { type: "delete_finish"; id: string }
  | { type: "rename_start"; id: string; value: string }
  | { type: "rename_update"; value: string }
  | { type: "rename_cancel" }
  | { type: "edit_start"; idx: number; value: string }
  | { type: "edit_update"; value: string }
  | { type: "edit_cancel" };

const initialChatInteractionState: ChatInteractionState = {
  deletingIds: new Set(),
  renameState: null,
  editState: null,
};

function chatInteractionReducer(
  state: ChatInteractionState,
  action: ChatInteractionAction,
): ChatInteractionState {
  switch (action.type) {
    case "delete_start": {
      const nextDeletingIds = new Set(state.deletingIds);
      nextDeletingIds.add(action.id);
      return { ...state, deletingIds: nextDeletingIds };
    }
    case "delete_finish": {
      const nextDeletingIds = new Set(state.deletingIds);
      nextDeletingIds.delete(action.id);
      return { ...state, deletingIds: nextDeletingIds };
    }
    case "rename_start":
      return { ...state, renameState: { id: action.id, value: action.value } };
    case "rename_update":
      if (!state.renameState) return state;
      return {
        ...state,
        renameState: { ...state.renameState, value: action.value },
      };
    case "rename_cancel":
      return { ...state, renameState: null };
    case "edit_start":
      return { ...state, editState: { idx: action.idx, value: action.value } };
    case "edit_update":
      if (!state.editState) return state;
      return {
        ...state,
        editState: { ...state.editState, value: action.value },
      };
    case "edit_cancel":
      return { ...state, editState: null };
    default:
      return state;
  }
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
  const {
    messages,
    setMessages,
    loading,
    setLoading,
    isThinking,
    setIsThinking,
    messagesLoading,
    thinkingTimerRef,
    messageCache,
    abortControllerRef,
    activeChatIdRef,
    justCreatedChatRef,
  } = useChatSession(activeChatId);

  const {
    models,
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
  } = useChatUI(messages);

  const inputFocusRef = useRef<(() => void) | null>(null);
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
      if (key === "p" && !showPreferences) setShowPreferences(true);
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
    prompt: string,
    historyOverride?: Message[],
    images?: string[],
  ) => {
    const rawInput = prompt.trim();
    if (!rawInput || loading) return;

    if (rawInput === "/clear") {
      setMessages([]);
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
      return;
    }
    if (rawInput === "/ratelimit") {
      const info = isGuest
        ? "**Rate limits (guest)**\nMessages: 3 per minute, 30 per day\n\nLog in or create an account to increase your limit to 10 messages per minute."
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
            "Commands: /clear, /code, /math, /ratelimit, /help\nShortcuts: Ctrl+H (toggle sidebar), Ctrl+P (preferences)",
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
              images,
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
              images,
            },
            ctrl.signal,
          );

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error("Failed to get response stream");

      let accumulatedResponse = "";
      let bufferedTokens = "";
      let rafId: number | null = null;

      const flushBufferedTokens = () => {
        if (!bufferedTokens) return;
        accumulatedResponse += bufferedTokens;
        bufferedTokens = "";
        setMessages((prev) => {
          const next = [...prev];
          next[next.length - 1] = {
            ...next[next.length - 1],
            content: accumulatedResponse,
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
            if (data.type === "token") {
              if (thinkingTimerRef.current) {
                clearTimeout(thinkingTimerRef.current);
                thinkingTimerRef.current = null;
              }
              setIsThinking(false);
              bufferedTokens += data.token;
              scheduleFlush();
            } else if (data.type === "done") {
              flushAndCancelPendingFrame();
              if (!isGuest) onChatsChanged();
            } else if (data.type === "error") {
              flushAndCancelPendingFrame();
              throw new Error(data.error);
            }
          } catch (e) {
            if (e instanceof SyntaxError) continue;
            throw e;
          }
        }
      }
      flushAndCancelPendingFrame();
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
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

  const handleStop = () => abortControllerRef.current?.abort();

  const handleEditSubmit = () => {
    if (!editState) return;
    const { idx, value } = editState;
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
    const { id, value } = renameState;
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

  const visibleChats = useMemo(
    () =>
      chats
        .filter((c) =>
          (c.title || "").toLowerCase().includes(historySearch.toLowerCase()),
        )
        .filter((c) => !deletingIds.has(c.id)),
    [chats, historySearch, deletingIds],
  );

  const activeChat = chats.find((c) => c.id === activeChatId);
  const chatTitle = activeChat?.title ?? (activeChatId ? "Chat" : "New Chat");

  return (
    <>
      {!isConnected && (
        <div className="connection-banner">
          Initializing backend services. Estimated wait time: ~1 minute.
        </div>
      )}

      <div className="chat-layout">
        {/* ---- Sidebar ---- */}
        {!isGuest && sidebarOpen && (
          <div
            className="sidebar-backdrop"
            onClick={() => setSidebarOpen(false)}
          />
        )}
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
                <h2 className="empty-title">{chatGreeting}</h2>
                <div className="suggestion-chips">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      className="suggestion-chip"
                      onClick={() => void handleAsk(s)}
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
                      isThinking={isThinking}
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
            selectedModel={selectedModel}
            setSelectedModel={setSelectedModel}
            onOpenPreferences={(section) => {
              if (section) setPrefSection(section as PrefSection);
              setShowPreferences(true);
            }}
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
          initialSection={prefSection}
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
