import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5001";

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

  useEffect(() => {
    const loadModels = async () => {
      try {
        const response = await fetch(`${API_URL}/api/models`, {
          credentials: "include",
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
        });
        if (response.ok) {
          setIsConnected(true);
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

    const userMessage = input.trim();
    setMessages((prev) => [...prev, { role: "user", content: userMessage }]);
    setInput("");

    // Add placeholder for streaming response
    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

    setLoading(true);
    try {
      const payload: { prompt: string; model?: string } = {
        prompt: userMessage,
      };
      if (selectedModel) {
        payload.model = selectedModel;
      }

      const response = await fetch(`${API_URL}/api/chat/stream`, {
        method: "POST",
        headers: {
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

  const handleClear = async () => {
    try {
      await fetch(`${API_URL}/api/history`, {
        method: "DELETE",
        credentials: "include",
      });
      setMessages([]);
      setInput("");
    } catch (error) {
      console.error("Error clearing history:", error);
    }
  };

  return (
    <>
      <h1>ModelLoop/Chat</h1>
      {!isConnected && (
        <div className="connection-banner">
          Waiting for backend to wake up... (This may take a moment)
        </div>
      )}
      <div className="chat-container">
        <div className="messages">
          {messages.map((msg, idx) => (
            <div key={idx} className={`message ${msg.role}`}>
              <strong>{msg.role === "user" ? "You" : "AI"}:</strong>{" "}
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
        </div>
        <div className="input-area">
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
          <input
            type="text"
            placeholder="What's on your mind?"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={loading}
          />
          <button onClick={handleAsk} disabled={loading}>
            {loading ? "Thinking..." : "Ask"}
          </button>
          <button onClick={handleClear} disabled={loading}>
            Clear
          </button>
        </div>
      </div>
      <div className="chat-footer">
        <button className="back-to-landing" onClick={onBack}>
          ← Back to Landing
        </button>
      </div>
    </>
  );
}

export default Chat;
