import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5001";

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
        if (availableModels.length > 0) {
          setSelectedModel(availableModels[0]);
        }
      } catch (error) {
        console.error("Error fetching models:", error);
      }
    };

    loadModels();
  }, []);

  const handleAsk = async () => {
    if (!input.trim()) return;

    if (input.trim().toLowerCase() === "clear") {
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
      return;
    }

    const userMessage = input.trim();
    setMessages((prev) => [...prev, { role: "user", content: userMessage }]);
    setInput("");

    setLoading(true);
    try {
      const payload: { prompt: string; model?: string } = {
        prompt: userMessage,
      };
      if (selectedModel) {
        payload.model = selectedModel;
      }

      const response = await fetch(`${API_URL}/api/chat`, {
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

      const data = await response.json();
      setMessages(data.history);
    } catch (error) {
      console.error("Error:", error);
      const message =
        error instanceof Error
          ? error.message
          : "Failed to get response from server";
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Error: ${message}` },
      ]);
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
      <h1>ModelLoop</h1>
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
                    {msg.content}
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
              <option value="">No models found</option>
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
            placeholder="Ask StarAI"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={loading}
          />
          <button onClick={handleAsk} disabled={loading}>
            {loading ? "Generating..." : "Ask"}
          </button>
          <button onClick={handleClear} disabled={loading}>
            Clear
          </button>
        </div>
      </div>
      <div className="chat-footer">
        <button className="back-to-landing" onClick={onBack}>
          ← Back to Home
        </button>
      </div>
    </>
  );
}

export default Chat;
