import { memo, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { type Message } from "./api";
import { CheckIcon, CopyIcon, EditIcon, RetryIcon, SpeakerIcon, StopIcon } from "./MessageIcons";
import { speakWithChosenVoice } from "./speechVoice";
import { rehypeStreamWords } from "./utils/rehypeStreamWords";
import { fixMathDelimiters, fmtTime } from "./utils/chatUtils";

function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`]+`/g, "")
    .replace(/#{1,6}\s/gm, "")
    .replace(/\*\*(.+?)\*\*/gs, "$1")
    .replace(/\*(.+?)\*/gs, "$1")
    .replace(/__(.+?)__/gs, "$1")
    .replace(/_(.+?)_/gs, "$1")
    .replace(/\[(.+?)\]\(.+?\)/g, "$1")
    .replace(/^[-*+]\s/gm, "")
    .replace(/^\d+\.\s/gm, "")
    .replace(/^>\s/gm, "")
    .replace(/\n{2,}/g, ". ")
    .replace(/\n/g, " ")
    .trim();
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
        {copied ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
      </button>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const MD_COMPONENTS = { pre: Pre as any };

const REHYPE_PLUGINS = [rehypeKatex, rehypeHighlight];
const REHYPE_PLUGINS_STREAMING = [rehypeKatex, rehypeHighlight, rehypeStreamWords];

// Tokens arrive in bursts. While a reply streams, this shows it flowing out at an even pace
// instead: each frame reveals a share of what is still hidden, so a burst is spread over a few
// frames and a long backlog still catches up quickly. Text that was already there when the
// message appeared (a saved chat) shows at once.
const REVEAL_SHARE = 0.14;
const REVEAL_MIN = 2;

function useSmoothText(text: string, streaming: boolean): string {
  const [shown, setShown] = useState(streaming ? "" : text);
  const target = useRef(text);
  target.current = text;

  // Anything that is not the shown text carrying on (a retry, an edit) starts over
  if (!text.startsWith(shown)) setShown(streaming ? "" : text);

  const behind = shown.length < text.length;
  useEffect(() => {
    if (!behind) return;
    let frame = requestAnimationFrame(function step() {
      setShown((prev) => {
        const full = target.current;
        if (!full.startsWith(prev)) return full;
        const backlog = full.length - prev.length;
        if (backlog <= 0) return prev;
        return full.slice(0, prev.length + Math.max(REVEAL_MIN, Math.ceil(backlog * REVEAL_SHARE)));
      });
      frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
  }, [behind]);

  return shown;
}

// No trailing dots: the swaying leaves next to the phrase do that job.
const THINKING_PHRASES = [
  "Thinking it over",
  "Let me think",
  "One moment",
  "Gathering my thoughts",
  "Working on it",
  "Mulling that over",
];

export const AssistantMessage = memo(function AssistantMessage({
  msg,
  isLast,
  canRetry,
  isThinking,
  activeTool,
  streaming,
  onRetry,
}: {
  msg: Message;
  isLast: boolean;
  canRetry: boolean;
  isThinking: boolean;
  activeTool: string | null;
  streaming: boolean;
  onRetry: () => void;
}) {
  const shownContent = useSmoothText(msg.content, streaming);
  const revealing = streaming || shownContent.length < msg.content.length;
  const [copied, setCopied] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [thinkingOpen, setThinkingOpen] = useState(false);
  const [imageContextOpen, setImageContextOpen] = useState(false);
  const [searchContextOpen, setSearchContextOpen] = useState(false);
  const thinkingPhrase = useRef(
    THINKING_PHRASES[Math.floor(Math.random() * THINKING_PHRASES.length)],
  );
  const ts = fmtTime(msg.created_at);

  const handleCopy = () => {
    navigator.clipboard.writeText(msg.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleListen = () => {
    if (isSpeaking) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
      return;
    }
    const cleaned = stripMarkdown(msg.content);
    if (!cleaned) return;
    // Starting this stops whatever is playing, which fires its onend and resets that
    // message's isSpeaking
    speakWithChosenVoice(cleaned, {
      rate: parseFloat(localStorage.getItem("voice_speech_rate") || "1.0"),
      onEnd: () => setIsSpeaking(false),
    });
    setIsSpeaking(true);
  };

  useEffect(() => {
    return () => { if (isSpeaking) window.speechSynthesis.cancel(); };
  }, [isSpeaking]);

  const showThinking = msg.content === "" && isThinking && isLast;
  const showToolUse = isLast && !!activeTool && msg.content === "";

  return (
    <div className="msg-bubble-group">
      <div className="message assistant">
        <div className={`assistant-content${revealing ? " is-revealing" : ""}`}>
          {msg.thinking && (
            <div className="reasoning-block">
              <button
                className="reasoning-toggle"
                onClick={() => setThinkingOpen((v) => !v)}
              >
                <svg
                  viewBox="0 0 16 16"
                  width="12"
                  height="12"
                  fill="currentColor"
                  style={{
                    transform: thinkingOpen ? "rotate(90deg)" : "none",
                    transition: "transform 0.15s",
                  }}
                >
                  <path d="M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06Z" />
                </svg>
                Reasoning
              </button>
              {thinkingOpen && (
                <div className="reasoning-content">{msg.thinking}</div>
              )}
            </div>
          )}
          {msg.image_context && (
            <div className="reasoning-block">
              <button
                className="reasoning-toggle"
                onClick={() => setImageContextOpen((v) => !v)}
              >
                <svg
                  viewBox="0 0 16 16"
                  width="12"
                  height="12"
                  fill="currentColor"
                  style={{
                    transform: imageContextOpen ? "rotate(90deg)" : "none",
                    transition: "transform 0.15s",
                  }}
                >
                  <path d="M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06Z" />
                </svg>
                Image Analysis
              </button>
              {imageContextOpen && (
                <div className="reasoning-content">{msg.image_context}</div>
              )}
            </div>
          )}
          {msg.search_context && (
            <div className="reasoning-block">
              <button
                className="reasoning-toggle"
                onClick={() => setSearchContextOpen((v) => !v)}
              >
                <svg
                  viewBox="0 0 16 16"
                  width="12"
                  height="12"
                  fill="currentColor"
                  style={{
                    transform: searchContextOpen ? "rotate(90deg)" : "none",
                    transition: "transform 0.15s",
                  }}
                >
                  <path d="M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06Z" />
                </svg>
                Web Search
              </button>
              {searchContextOpen && (
                <div className="reasoning-content">{msg.search_context}</div>
              )}
            </div>
          )}
          {showToolUse || showThinking ? (
            <span className="waiting" role="status">
              <span className="waiting-leaves" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              <span className="thinking-phrase">
                {!showToolUse
                  ? thinkingPhrase.current
                  : activeTool === "web_search"
                    ? "Looking that up"
                    : activeTool === "get_weather"
                      ? "Checking the weather"
                      : "Fetching what I need"}
              </span>
            </span>
          ) : (
            <ReactMarkdown
              remarkPlugins={[remarkGfm, remarkMath]}
              rehypePlugins={revealing ? REHYPE_PLUGINS_STREAMING : REHYPE_PLUGINS}
              components={MD_COMPONENTS}
            >
              {fixMathDelimiters(shownContent)}
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
              {copied ? <CheckIcon /> : <CopyIcon />}
            </button>
          )}
          {msg.content && (
            <button
              className={`listen-btn${isSpeaking ? " speaking" : ""}`}
              onClick={handleListen}
              title={isSpeaking ? "Stop" : "Listen"}
            >
              {isSpeaking ? <StopIcon /> : <SpeakerIcon />}
            </button>
          )}
          {canRetry && (
            <button className="retry-btn" onClick={onRetry} title="Retry">
              <RetryIcon />
            </button>
          )}
        </div>
      </div>
    </div>
  );
});

export const UserMessage = memo(function UserMessage({
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
          <pre
            style={{
              whiteSpace: "pre-wrap",
              wordWrap: "break-word",
              margin: 0,
            }}
          >
            {msg.content}
          </pre>
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
              <EditIcon />
            </button>
          </div>
        )}
      </div>
    </div>
  );
});
