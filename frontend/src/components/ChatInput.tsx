import { useEffect, useMemo, useRef, useState } from "react";
import type { DocumentMeta } from "./api";

const TOOLS_ITEMS = [
  { id: "model", label: "Model", desc: "Switch AI model" },
  { id: "presets", label: "Presets", desc: "System prompt personas" },
  { id: "temperature", label: "Temperature", desc: "Response creativity" },
  { id: "appearance", label: "Appearance", desc: "Theme & display" },
  { id: "account", label: "Account", desc: "Account settings" },
] as const;

const SLASH_COMMANDS = [
  { cmd: "/clear", desc: "Clear conversation" },
  { cmd: "/code", desc: "Code mode (deepseek-r1)" },
  { cmd: "/math", desc: "Math mode (deepseek-r1)" },
  { cmd: "/ratelimit", desc: "Show rate limit info" },
  { cmd: "/help", desc: "Show commands" },
];

export const MODEL_PRESETS = [
  { label: "Fast", model: "llama3.2:latest" },
  { label: "Pro", model: "llama3.1:latest" },
  { label: "Thinking", model: "deepseek-r1:1.5b" },
] as const;

export const DEFAULT_MODEL = MODEL_PRESETS[0].model;

interface ChatInputProps {
  loading: boolean;
  onAsk: (prompt: string, images?: string[]) => Promise<void> | void;
  onStop: () => void;
  onRegisterFocus?: (focusFn: () => void) => void;
  selectedModel?: string;
  setSelectedModel?: (model: string) => void;
  onOpenPreferences?: (section?: string) => void;
  documents?: DocumentMeta[];
  docsUploading?: boolean;
  docUploadError?: string | null;
  onDocUpload?: (file: File) => void;
  onDocDelete?: (docId: string) => void;
}

function ChatInput({
  loading,
  onAsk,
  onStop,
  onRegisterFocus,
  selectedModel,
  setSelectedModel,
  onOpenPreferences,
  documents = [],
  docsUploading = false,
  docUploadError,
  onDocUpload,
  onDocDelete,
}: ChatInputProps) {
  const [input, setInput] = useState("");
  const [slashIdx, setSlashIdx] = useState(-1);
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const [toolsDropdownOpen, setToolsDropdownOpen] = useState(false);
  const [docsDropdownOpen, setDocsDropdownOpen] = useState(false);
  const [attachedImage, setAttachedImage] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragCounterRef = useRef(0);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const modelDropdownRef = useRef<HTMLDivElement | null>(null);
  const toolsDropdownRef = useRef<HTMLDivElement | null>(null);
  const docsDropdownRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const docFileInputRef = useRef<HTMLInputElement | null>(null);

  const currentPresetLabel =
    MODEL_PRESETS.find((p) => p.model === selectedModel)?.label ?? "Custom";

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

  useEffect(() => {
    if (!modelDropdownOpen) return;
    const onClickOutside = (e: MouseEvent) => {
      if (!modelDropdownRef.current?.contains(e.target as Node)) {
        setModelDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [modelDropdownOpen]);

  useEffect(() => {
    if (!toolsDropdownOpen) return;
    const onClickOutside = (e: MouseEvent) => {
      if (!toolsDropdownRef.current?.contains(e.target as Node)) {
        setToolsDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [toolsDropdownOpen]);

  useEffect(() => {
    if (!docsDropdownOpen) return;
    const onClickOutside = (e: MouseEvent) => {
      if (!docsDropdownRef.current?.contains(e.target as Node)) {
        setDocsDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [docsDropdownOpen]);

  const handleImageFile = (file: File) => {
    if (
      file.type === "image/heic" ||
      file.type === "image/heif" ||
      file.name.toLowerCase().endsWith(".heic") ||
      file.name.toLowerCase().endsWith(".heif")
    ) {
      setImageError(
        "HEIC images aren't supported. Convert to JPEG or PNG first.",
      );
      setTimeout(() => setImageError(null), 4000);
      return;
    }
    setImageError(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const MAX = 1024;
        const scale = Math.min(1, MAX / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas
          .getContext("2d")!
          .drawImage(img, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.88);
        setAttachedImage(dataUrl.split(",")[1]);
      };
      img.src = e.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    for (const item of Array.from(e.clipboardData.items)) {
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) handleImageFile(file);
        break;
      }
    }
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current++;
    if (
      Array.from(e.dataTransfer.items).some(
        (i) => i.kind === "file" && i.type.startsWith("image/"),
      )
    )
      setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) setIsDragging(false);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current = 0;
    setIsDragging(false);
    const file = Array.from(e.dataTransfer.files).find((f) =>
      f.type.startsWith("image/"),
    );
    if (file) {
      handleImageFile(file);
    } else if (e.dataTransfer.files.length > 0) {
      setImageError("Only image files can be attached.");
      setTimeout(() => setImageError(null), 4000);
    }
  };

  const submit = (override?: string) => {
    const prompt = (override ?? input).trim();
    if (!prompt || loading) return;
    setInput("");
    setSlashIdx(-1);
    setAttachedImage(null);
    resetTextareaHeight();
    void onAsk(prompt, attachedImage ? [attachedImage] : undefined);
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
      <div
        className={`input-wrapper${isDragging ? " drag-over" : ""}`}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleImageFile(file);
            e.target.value = "";
          }}
        />
        {imageError && <div className="image-error-banner">{imageError}</div>}
        {attachedImage && (
          <div className="image-preview-strip">
            <div className="image-preview-thumb-wrap">
              <img
                src={`data:image/png;base64,${attachedImage}`}
                alt="attachment"
                className="image-preview-thumb"
              />
              <button
                className="image-preview-remove"
                type="button"
                onClick={() => setAttachedImage(null)}
                title="Remove image"
              >
                ×
              </button>
            </div>
          </div>
        )}
        <textarea
          ref={textareaRef}
          className="chat-textarea"
          autoFocus
          rows={1}
          placeholder="Ask ModelLoop"
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            adjustTextareaHeight();
            if (!e.target.value.startsWith("/")) setSlashIdx(-1);
          }}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          disabled={loading}
        />
        <div className="input-toolbar">
          <div className="toolbar-left">
            <button
              className="toolbar-icon-btn"
              onClick={() => fileInputRef.current?.click()}
              title="Attach image (analyzed with gemma3)"
              type="button"
              disabled={loading}
            >
              <svg
                viewBox="0 0 24 24"
                width="14"
                height="14"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
            </button>
            {onDocUpload && (
              <div className="tools-dropdown-wrapper" ref={docsDropdownRef}>
                <input
                  ref={docFileInputRef}
                  type="file"
                  accept=".pdf,.txt,.md"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file) onDocUpload(file);
                  }}
                />
                <button
                  className={`toolbar-chip-btn${documents.length > 0 ? " doc-chip-active" : ""}`}
                  onClick={() => setDocsDropdownOpen((v) => !v)}
                  title="Documents (RAG)"
                  type="button"
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
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="16" y1="13" x2="8" y2="13" />
                    <line x1="16" y1="17" x2="8" y2="17" />
                  </svg>
                  {documents.length > 0 && (
                    <span className="doc-chip-count">{documents.length}</span>
                  )}
                </button>
                {docsDropdownOpen && (
                  <div className="tools-dropdown-menu">
                    <button
                      className="tools-dropdown-item"
                      type="button"
                      disabled={docsUploading}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        docFileInputRef.current?.click();
                      }}
                    >
                      <span className="tools-dropdown-item-text">
                        <span className="tools-dropdown-item-label">
                          {docsUploading ? "Uploading…" : "Add file"}
                        </span>
                        <span className="tools-dropdown-item-desc">
                          PDF, TXT, or MD · enables RAG
                        </span>
                      </span>
                    </button>
                    {docUploadError && (
                      <div
                        className="tools-dropdown-item"
                        style={{ cursor: "default", color: "#fb4934" }}
                      >
                        <span className="tools-dropdown-item-text">
                          <span
                            className="tools-dropdown-item-label"
                            style={{ color: "#fb4934" }}
                          >
                            {docUploadError}
                          </span>
                        </span>
                      </div>
                    )}
                    {documents.map((doc) => (
                      <div
                        key={doc.id}
                        className="tools-dropdown-item"
                        style={{ cursor: "default" }}
                      >
                        <span
                          className="tools-dropdown-item-text"
                          style={{ flex: 1, minWidth: 0 }}
                        >
                          <span
                            className="tools-dropdown-item-label"
                            style={{
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              display: "block",
                            }}
                            title={doc.filename}
                          >
                            {doc.filename}
                          </span>
                          <span className="tools-dropdown-item-desc">
                            {doc.chunk_count} chunks
                          </span>
                        </span>
                        <button
                          className="docs-item-delete"
                          type="button"
                          title="Remove"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            onDocDelete?.(doc.id);
                          }}
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                    {documents.length === 0 && !docsUploading && (
                      <div
                        className="tools-dropdown-item"
                        style={{ cursor: "default", pointerEvents: "none" }}
                      >
                        <span className="tools-dropdown-item-text">
                          <span
                            className="tools-dropdown-item-desc"
                            style={{ fontSize: "0.72rem" }}
                          >
                            No documents yet
                          </span>
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
            {onOpenPreferences && (
              <div className="tools-dropdown-wrapper" ref={toolsDropdownRef}>
                <button
                  className="toolbar-chip-btn"
                  onClick={() => setToolsDropdownOpen((v) => !v)}
                  title="Tools"
                  type="button"
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
                    <line x1="3" y1="6" x2="21" y2="6" />
                    <line x1="3" y1="12" x2="21" y2="12" />
                    <line x1="3" y1="18" x2="21" y2="18" />
                    <circle
                      cx="8"
                      cy="6"
                      r="2.2"
                      fill="currentColor"
                      stroke="none"
                    />
                    <circle
                      cx="16"
                      cy="12"
                      r="2.2"
                      fill="currentColor"
                      stroke="none"
                    />
                    <circle
                      cx="8"
                      cy="18"
                      r="2.2"
                      fill="currentColor"
                      stroke="none"
                    />
                  </svg>
                </button>
                {toolsDropdownOpen && (
                  <div className="tools-dropdown-menu">
                    {TOOLS_ITEMS.map((item) => (
                      <button
                        key={item.id}
                        className="tools-dropdown-item"
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          setToolsDropdownOpen(false);
                          onOpenPreferences(item.id);
                        }}
                      >
                        <span className="tools-dropdown-item-text">
                          <span className="tools-dropdown-item-label">
                            {item.label}
                          </span>
                          <span className="tools-dropdown-item-desc">
                            {item.desc}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="toolbar-right">
            {setSelectedModel && (
              <div className="tools-dropdown-wrapper" ref={modelDropdownRef}>
                <button
                  className="toolbar-chip-btn"
                  onClick={() => setModelDropdownOpen((v) => !v)}
                  type="button"
                  title="Switch model"
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
                    <circle cx="12" cy="12" r="3" />
                    <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83" />
                  </svg>
                  {currentPresetLabel}
                </button>
                {modelDropdownOpen && (
                  <div className="tools-dropdown-menu tools-dropdown-menu--right">
                    {MODEL_PRESETS.map((preset) => (
                      <button
                        key={preset.label}
                        className={`tools-dropdown-item${selectedModel === preset.model ? " active" : ""}`}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          setSelectedModel(preset.model);
                          setModelDropdownOpen(false);
                        }}
                        type="button"
                        title={preset.model}
                      >
                        <span className="tools-dropdown-item-text">
                          <span className="tools-dropdown-item-label">
                            {preset.label}
                          </span>
                          <span className="tools-dropdown-item-desc">
                            {preset.model}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <button
              className={`ask-button${loading ? " stopping" : ""}`}
              onClick={loading ? onStop : () => void submit()}
              disabled={!loading && !input.trim()}
              title={loading ? "Stop generation" : "Send (Enter)"}
            >
              {loading ? (
                <svg
                  viewBox="0 0 24 24"
                  width="13"
                  height="13"
                  fill="currentColor"
                >
                  <rect x="4" y="4" width="16" height="16" rx="2" />
                </svg>
              ) : (
                <svg
                  viewBox="0 0 24 24"
                  width="14"
                  height="14"
                  fill="currentColor"
                  stroke="none"
                >
                  <path d="M22 2L11 13M22 2L15 22l-4-9-9-4 20-7z" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ChatInput;
