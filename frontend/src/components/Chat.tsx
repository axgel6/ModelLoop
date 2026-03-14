import { useEffect, useRef, useState } from "react";
import ChatPreferences from "./ChatPreferences";
import History from "./History";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";
const API_KEY = import.meta.env.VITE_API_KEY;

const AUTH_HEADERS = {
  "X-API-Key": API_KEY,
};

// Fix math delimiters from model output to proper LaTeX format
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

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface ChatProps {
  onBack: () => void;
}

function Chat({ onBack }: ChatProps) {
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

  // Scroll to bottom when messages change
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  useEffect(() => {
    const loadModels = async () => {
      try {
        const response = await fetch(`${API_URL}/api/models`, {
          credentials: "include",
          headers: AUTH_HEADERS,
        });
        if (!response.ok) {
          throw new Error("Failed to fetch models");
        }

        const data = await response.json();
        const availableModels: string[] = data.models ?? [];
        setModels(availableModels);
        setIsConnected(true);
        modelsLoadedRef.current = true;
        if (availableModels.length > 0) {
          setSelectedModel(availableModels[0]);
        }
      } catch (error) {
        console.error("Error fetching models:", error);
        setIsConnected(false);
      }
    };

    const loadHistory = async () => {
      try {
        const response = await fetch(`${API_URL}/api/history`, {
          credentials: "include",
          headers: AUTH_HEADERS,
        });
        if (response.ok) {
          const data = await response.json();
          if (data.history?.length > 0) {
            setMessages(data.history);
          }
        }
      } catch (error) {
        console.error("Error loading history:", error);
      }
    };

    loadModels();
    loadHistory();

    // Periodically check connection and retry loading models if needed
    const interval = setInterval(async () => {
      try {
        const response = await fetch(`${API_URL}/api/models`, {
          credentials: "include",
          headers: AUTH_HEADERS,
        });
        if (response.ok) {
          setIsConnected(true);
          if (modelsLoadedRef.current) {
            clearInterval(interval); // Stops checking once models are loaded
            return;
          }
          if (!modelsLoadedRef.current) {
            const data = await response.json();
            const availableModels: string[] = data.models ?? [];
            setModels(availableModels);
            modelsLoadedRef.current = true;
            if (availableModels.length > 0) {
              setSelectedModel(availableModels[0]);
            }
          }
        } else {
          setIsConnected(false);
        }
      } catch {
        setIsConnected(false);
      }
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  const handleAsk = async () => {
    if (!input.trim()) return;

    if (input.trim().toLowerCase() === "/clear") {
      try {
        await fetch(`${API_URL}/api/history`, {
          method: "DELETE",
          credentials: "include",
          headers: AUTH_HEADERS,
        });
        setMessages([
          { role: "assistant", content: "Chat history cleared successfully." },
        ]);
        setInput("");
      } catch (error) {
        console.error("Error clearing history:", error);
      }
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

    const userMessage = input.trim();
    setMessages((prev) => [...prev, { role: "user", content: userMessage }]);
    setInput("");

    // Add placeholder for streaming response
    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

    setLoading(true);
    try {
      const payload: {
        prompt: string;
        model?: string;
        system_prompt?: string;
      } = {
        prompt: userMessage,
        system_prompt: systemPrompt,
      };
      if (selectedModel) {
        payload.model = selectedModel;
      }

      const response = await fetch(`${API_URL}/api/chat/stream`, {
        method: "POST",
        headers: {
          ...AUTH_HEADERS,
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to get response");
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error("Failed to get response stream");
      }

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
                setMessages((prev) => {
                  const newMessages = [...prev];
                  newMessages[newMessages.length - 1] = {
                    role: "assistant",
                    content: accumulatedResponse,
                  };
                  return newMessages;
                });
              } else if (data.type === "done") {
                // Backend responded successfully - mark as connected
                setIsConnected(true);
                // Update with final trimmed response (server has canonical version)
                if (data.history?.length >= 2) {
                  const lastAssistant = data.history[data.history.length - 1];
                  setMessages((prev) => {
                    const newMessages = [...prev];
                    newMessages[newMessages.length - 1] = lastAssistant;
                    return newMessages;
                  });
                }
              } else if (data.type === "error") {
                throw new Error(data.error);
              }
            } catch (e) {
              // Skip invalid JSON lines
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
      setMessages((prev) => {
        // Replace the last message (empty placeholder) with error
        const newMessages = [...prev];
        if (
          newMessages.length > 0 &&
          newMessages[newMessages.length - 1].role === "assistant"
        ) {
          newMessages[newMessages.length - 1] = {
            role: "assistant",
            content: `Error: ${message}`,
          };
        } else {
          newMessages.push({ role: "assistant", content: `Error: ${message}` });
        }
        return newMessages;
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

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // 1. Only trigger if  ontrol + 'h' is pressed
      if (
        event.key.toLowerCase() === "h" &&
        event.ctrlKey &&
        !event.altKey &&
        !event.metaKey
      ) {
        // 2. IMPORTANT: Don't trigger if the user is already typing in an input
        const isTyping =
          event.target instanceof HTMLInputElement ||
          event.target instanceof HTMLTextAreaElement;

        // 3. Only open if not already typing elsewhere AND modal isn't already open
        if (!isTyping && !showHistory) {
          event.preventDefault();
          event.stopImmediatePropagation(); // Forcefully stop other listeners
          setShowHistory(true);
        }
      }
      if (event.ctrlKey && event.key.toLowerCase() === "h") {
        event.preventDefault();
      }
    };

    // Use 'capture' phase (true) to catch the event before it reaches elements
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [showHistory, setShowHistory]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key.toLowerCase() === "p" &&
        event.ctrlKey &&
        !event.altKey &&
        !event.metaKey
      ) {
        const isTyping =
          event.target instanceof HTMLInputElement ||
          event.target instanceof HTMLTextAreaElement;

        if (!isTyping && !showPreferences) {
          event.preventDefault();
          event.stopImmediatePropagation();
          setShowPreferences(true);
        }
      }
      if (event.ctrlKey && event.key.toLowerCase() === "p") {
        event.preventDefault();
      }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [showPreferences, setShowPreferences]);

  const handleClear = async () => {
    try {
      await fetch(`${API_URL}/api/history`, {
        method: "DELETE",
        credentials: "include",
        headers: AUTH_HEADERS,
      });
      setMessages([]);
      setInput("");
    } catch (error) {
      console.error("Error clearing history:", error);
    }
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
        <button className="history-button" onClick={() => setShowHistory(true)}>
          ↺
        </button>
        <button
          className="chat-preferences"
          onClick={() => setShowPreferences(true)}
        >
          ⚙︎
        </button>
        <button className="new-chat" onClick={handleClear} disabled={loading}>
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
              disabled={loading}
            />
            <button
              className="ask-button"
              onClick={handleAsk}
              disabled={loading}
            >
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
      {showHistory && <History onClose={() => setShowHistory(false)} />}
    </>
  );
}

export default Chat;
