import { useEffect, useRef, useState } from "react";
import ChatPreferences from "./ChatPreferences";
import History from "./History";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import {
  apiChatStream,
  apiCreateChat,
  apiGetMessages,
  apiGetModels,
  apiGuestChatStream,
  apiHealth,
  type Message,
} from "./api";

// Normalize LaTeX delimiters from model output to the format the renderer expects
function fixMathDelimiters(text: string): string {
  return (
    text
      // \[ ... \] → $$ ... $$
      .replace(/\\\[(.+?)\\\]/gs, "$$$$1$$")
      // \( ... \) → $ ... $
      .replace(/\\\((.+?)\\\)/gs, "$$$1$$")
      // [ ... ] with LaTeX commands → $$ ... $$
      .replace(/\[\s*([^[\]]*\\[a-zA-Z]+[^[\]]*)\s*\]/g, "$$$$1$$")
      // [ expr ] simple math expressions → $$ ... $$
      .replace(/\[\s*(\d+[^[\]]*[+\-*/=][^[\]]*\d+[^[\]]*)\s*\]/g, "$$$$1$$")
  );
}

interface ChatProps {
  onBack: () => void;
  activeChatId: string | null; // Controlled by App.tsx
  onChatCreated: (chatId: string) => void; // Notify App when a new chat is created
  onChatsChanged: () => void; // Notify History to refresh its list
  onLogout: () => void; // Clear token and return to landing/login
  historyKey: number; // Incremented by App.tsx to force History to remount/refetch
  isGuest: boolean; // True means no auth and no persistence
}

function Chat({
  onBack,
  activeChatId,
  onChatCreated,
  onChatsChanged,
  onLogout,
  historyKey,
  isGuest,
}: ChatProps) {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [isConnected, setIsConnected] = useState(false);
  const modelsLoadedRef = useRef(false);
  const [systemPrompt, setSystemPrompt] =
    useState(`You are a helpful assistant. Important rules:
1. Always consider the conversation history when answering follow-up questions
2. When the user says "add X" or similar, apply it to the previous result
3. Use $ for inline math and $$ for block math
4. Be concise - don't over-explain simple questions`);
  const [showPreferences, setShowPreferences] = useState(false);
  const [activePreset, setActivePreset] = useState<string>("Default");
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  // Scroll to bottom whenever the messages array changes
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  // Loads models on mount and set up a retry interval + periodic health check
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

    // Retry every 5s until models are successfully loaded
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

    // Lightweight heartbeat — only runs after models are loaded
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

  // Ref mirror of activeChatId so handleAsk always sees the latest value inside async closures
  const activeChatIdRef = useRef<string | null>(activeChatId);
  activeChatIdRef.current = activeChatId;
  const justCreatedChatRef = useRef(false);

  // When activeChatId changes (user selected a chat in History), load its messages
  useEffect(() => {
    if (!activeChatId) {
      setMessages([]);
      return;
    }
    // Doesn't wipe state since chat is new but no messages yet
    // prevents bug that reloads and clears chat after first response
    if (justCreatedChatRef.current) {
      justCreatedChatRef.current = false;
      return;
    }
    const loadMessages = async () => {
      try {
        const msgs = await apiGetMessages(activeChatId);
        setMessages(msgs);
      } catch {
        console.error("Failed to load messages for chat", activeChatId);
      }
    };
    loadMessages();
  }, [activeChatId]);

  // Ensure a chat exists before sending, reads from ref so it always has the latest
  // chat_id even after creation without waiting for a re-render
  const ensureChatId = async (): Promise<string | null> => {
    if (activeChatIdRef.current) return activeChatIdRef.current;
    try {
      const chat = await apiCreateChat();
      activeChatIdRef.current = chat.id;
      justCreatedChatRef.current = true; // Prevent load-messages effect from wiping state
      onChatCreated(chat.id);
      onChatsChanged();
      return chat.id;
    } catch {
      console.error("Failed to create chat");
      return null;
    }
  };

  const handleAsk = async () => {
    if (!input.trim()) return;

    // ----- Slash Commands -----

    if (input.trim().toLowerCase() === "/clear") {
      setMessages([]);
      setInput("");
      onChatCreated(""); // Reset active chat so next message starts a fresh one
      return;
    }

    if (input.trim().toLowerCase() === "/code") {
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

    if (input.trim().toLowerCase() === "/math") {
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

    if (input.trim().toLowerCase() === "/help") {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content:
            "Available commands: /clear, /code, /math, /help\nKeyboard shortcuts: Ctrl+H (History - If logged in), Ctrl+P (Preferences)",
        },
      ]);
      setInput("");
      return;
    }

    // ----- Normal Message Flow -----

    const userMessage = input.trim();

    // Guest: snapshot history before mutating state and skips DB chat creation
    const historyForGuest = isGuest ? [...messages] : null;
    let chatId: string | null = null;
    if (!isGuest) {
      chatId = await ensureChatId();
      if (!chatId) return;
    }

    setMessages((prev) => [...prev, { role: "user", content: userMessage }]);
    setInput("");

    // Add placeholder that will be filled in-place as tokens stream in
    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

    setLoading(true);
    try {
      const response = isGuest
        ? await apiGuestChatStream({
            prompt: userMessage,
            messages: historyForGuest!,
            model: selectedModel || undefined,
            system_prompt: systemPrompt,
          })
        : await apiChatStream({
            prompt: userMessage,
            chat_id: chatId!,
            model: selectedModel || undefined,
            system_prompt: systemPrompt,
          });

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) throw new Error("Failed to get response stream");

      let accumulatedResponse = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));

              if (data.type === "token") {
                accumulatedResponse += data.token;
                // Update the last message (the streaming placeholder) in-place
                setMessages((prev) => {
                  const next = [...prev];
                  next[next.length - 1] = {
                    role: "assistant",
                    content: accumulatedResponse,
                  };
                  return next;
                });
              } else if (data.type === "done") {
                // Backend persisted successfully for authenticated users
                if (!isGuest) onChatsChanged();
              } else if (data.type === "error") {
                throw new Error(data.error);
              }
            } catch (e) {
              // Skip invalid JSON lines (SSE keep-alives etc.)
              if (e instanceof SyntaxError) continue;
              throw e;
            }
          }
        }
      }
    } catch (error) {
      console.error("Error:", error);
      const message =
        error instanceof Error
          ? error.message
          : "Failed to get response from server";
      // Replace the streaming placeholder with the error message
      setMessages((prev) => {
        const next = [...prev];
        if (next.length > 0 && next[next.length - 1].role === "assistant") {
          next[next.length - 1] = {
            role: "assistant",
            content: `Error: ${message}`,
          };
        } else {
          next.push({ role: "assistant", content: `Error: ${message}` });
        }
        return next;
      });
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleAsk();
    }
  };

  // Ctrl+H / Ctrl+P  (open History / Preferences panels)
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey || event.altKey || event.metaKey) return;

      const key = event.key.toLowerCase();
      if (key !== "h" && key !== "p") return;

      // Always suppress the browser default for these combos
      event.preventDefault();

      const isTyping =
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement;
      if (isTyping) return;

      event.stopImmediatePropagation();
      if (key === "h" && !showHistory) setShowHistory(true);
      if (key === "p" && !showPreferences) setShowPreferences(true);
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [showHistory, showPreferences]);

  // Clear local state and reset activeChatId so the next message creates a fresh DB chat
  const handleNewChat = () => {
    setMessages([]);
    setInput("");
    activeChatIdRef.current = null; // Clear ref immediately so ensureChatId creates a new chat
    onChatCreated(""); // Signal App.tsx to clear activeChatId
  };

  // Wipe JWT then hand control back to App.tsx to show Login
  const handleLogout = () => {
    localStorage.removeItem("token");
    onLogout();
  };

  return (
    <>
      {!isConnected && (
        <div className="connection-banner">
          Waiting for backend to wake up... (This may take a moment)
        </div>
      )}
      <div className="chat-header-row">
        <button className="back-to-landing" onClick={onBack}>
          ←
        </button>
        <h1 className="chat-title">ModelLoop/Chat</h1>
        {!isGuest && (
          <button
            className="history-button"
            onClick={() => setShowHistory(true)}
          >
            ↺
          </button>
        )}
        <button
          className="chat-preferences"
          onClick={() => setShowPreferences(true)}
        >
          ⚙︎
        </button>
        <button className="new-chat" onClick={handleNewChat} disabled={loading}>
          New Chat
        </button>
        <select
          value={selectedModel}
          onChange={(e) => setSelectedModel(e.target.value)}
          disabled={loading || models.length === 0}
          aria-label="Select model"
        >
          {models.length === 0 ? (
            <option value="">Please wait...</option>
          ) : (
            models.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))
          )}
        </select>
        <button
          className="logout-button"
          onClick={handleLogout}
          disabled={loading}
        >
          {isGuest ? "Sign In" : "Sign Out"}
        </button>
      </div>

      <div className="chat-container">
        <div className="messages">
          {messages.map((msg, idx) => (
            <div key={idx} className={`message ${msg.role}`}>
              {msg.role === "assistant" ? (
                <div className="assistant-content">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm, remarkMath]}
                    rehypePlugins={[rehypeKatex, rehypeHighlight]}
                  >
                    {fixMathDelimiters(msg.content)}
                  </ReactMarkdown>
                </div>
              ) : (
                msg.content
              )}
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        <div className="input-area">
          <div className="input-wrapper">
            <input
              type="text"
              autoFocus
              placeholder="What's on your mind?"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
            />
            <button className="ask-button" onClick={handleAsk}>
              {loading ? "◌" : "➤"}
            </button>
          </div>
        </div>
      </div>

      <div className="chat-footer">
        <p id="disclaimer">
          ModelLoop can make mistakes. Please verify any critical information it
          provides.
        </p>
      </div>

      {showPreferences && (
        <ChatPreferences
          systemPrompt={systemPrompt}
          setSystemPrompt={setSystemPrompt}
          onClose={() => setShowPreferences(false)}
          activePreset={activePreset}
          setActivePreset={setActivePreset}
        />
      )}
      {showHistory && (
        <History
          key={historyKey}
          onClose={() => setShowHistory(false)}
          activeChatId={activeChatId}
          onSelectChat={(id: string) => {
            onChatCreated(id);
            setShowHistory(false);
          }}
          onNewChat={handleNewChat}
        />
      )}
    </>
  );
}

export default Chat;
