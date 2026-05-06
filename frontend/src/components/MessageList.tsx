import { memo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { type Message } from "./api";
import { fixMathDelimiters, fmtTime } from "./utils/chatUtils";

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

const THINKING_PHRASES = [
  "Let me think about that…",
  "On it…",
  "Just a moment…",
  "Thinking this through…",
  "Putting it together…",
  "Give me a second…",
  "Let me work through this…",
  "Almost ready…",
];

export const AssistantMessage = memo(function AssistantMessage({
  msg,
  isLast,
  canRetry,
  isThinking,
  activeTool,
  onRetry,
}: {
  msg: Message;
  isLast: boolean;
  canRetry: boolean;
  isThinking: boolean;
  activeTool: string | null;
  onRetry: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [thinkingOpen, setThinkingOpen] = useState(false);
  const thinkingPhrase = useRef(
    THINKING_PHRASES[Math.floor(Math.random() * THINKING_PHRASES.length)],
  );
  const ts = fmtTime(msg.created_at);

  const handleCopy = () => {
    navigator.clipboard.writeText(msg.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const showThinking = msg.content === "" && isThinking && isLast;
  const showToolUse = isLast && !!activeTool && msg.content === "";

  return (
    <div className="msg-bubble-group">
      <div className="message assistant">
        <div className="assistant-content">
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
          {showToolUse ? (
            <span className="thinking-phrase">Thinking even harder…</span>
          ) : showThinking ? (
            <span className="thinking-phrase">{thinkingPhrase.current}</span>
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
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="23 4 23 10 17 10" />
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
              </svg>
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
