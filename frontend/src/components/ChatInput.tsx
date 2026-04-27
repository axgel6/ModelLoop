import { useEffect, useMemo, useRef, useState } from "react";

const SLASH_COMMANDS = [
  { cmd: "/clear", desc: "Clear conversation" },
  { cmd: "/code", desc: "Code mode (deepseek-r1)" },
  { cmd: "/math", desc: "Math mode (deepseek-r1)" },
  { cmd: "/ratelimit", desc: "Show rate limit info" },
  { cmd: "/help", desc: "Show commands" },
];

interface ChatInputProps {
  loading: boolean;
  onAsk: (prompt: string) => Promise<void> | void;
  onStop: () => void;
  onRegisterFocus?: (focusFn: () => void) => void;
}

function ChatInput({
  loading,
  onAsk,
  onStop,
  onRegisterFocus,
}: ChatInputProps) {
  const [input, setInput] = useState("");
  const [slashIdx, setSlashIdx] = useState(-1);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const adjustTextareaHeight = () => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 180) + "px";
  };

  const resetTextareaHeight = () => {
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  };

  const slashMatches = useMemo(
    () =>
      input.startsWith("/") && !loading
        ? SLASH_COMMANDS.filter((c) => c.cmd.startsWith(input.split(" ")[0]))
        : [],
    [input, loading],
  );

  useEffect(() => {
    if (!loading) textareaRef.current?.focus();
  }, [loading]);

  useEffect(() => {
    if (!onRegisterFocus) return;
    onRegisterFocus(() => textareaRef.current?.focus());
  }, [onRegisterFocus]);

  const submit = async (override?: string) => {
    const prompt = (override ?? input).trim();
    if (!prompt || loading) return;
    await onAsk(prompt);
    setInput("");
    setSlashIdx(-1);
    resetTextareaHeight();
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
      if ((e.key === "Tab" || e.key === "Enter") && slashIdx >= 0) {
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
      void submit();
    }
  };

  return (
    <div className="input-area">
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
          onClick={loading ? onStop : () => void submit()}
          disabled={!loading && !input.trim()}
          title={loading ? "Stop generation" : "Send (Enter)"}
        >
          {loading ? (
            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
              <rect x="4" y="4" width="16" height="16" rx="2" />
            </svg>
          ) : (
            <span style={{ paddingTop: "2px" }}>➤</span>
          )}
        </button>
      </div>
    </div>
  );
}

export default ChatInput;
