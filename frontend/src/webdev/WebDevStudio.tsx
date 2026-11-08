import {
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import hljs from "highlight.js/lib/core";
import css from "highlight.js/lib/languages/css";
import javascript from "highlight.js/lib/languages/javascript";
import xml from "highlight.js/lib/languages/xml";
import { WebDevContext } from "./context";
import { buildPreview, type ProjectFile } from "./preview";
import { LATEST, SAMPLE_PROJECT, SCRIPT, VERSIONS, type StudioMessage } from "./sampleProject";
import "./webdev.css";

hljs.registerLanguage("css", css);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("xml", xml);

type Device = "desktop" | "tablet" | "phone";
const DEVICES: { id: Device; label: string; icon: ReactNode }[] = [
  {
    id: "desktop",
    label: "Desktop",
    icon: (
      <>
        <rect x="3" y="4" width="18" height="12" rx="2" />
        <path d="M9 20h6M12 16v4" />
      </>
    ),
  },
  { id: "tablet", label: "Tablet", icon: <rect x="5" y="3" width="14" height="18" rx="2.5" /> },
  {
    id: "phone",
    label: "Phone",
    icon: (
      <>
        <rect x="7" y="3" width="10" height="18" rx="2.5" />
        <path d="M11 18h2" />
      </>
    ),
  },
];

const CHAT_ICON = <path d="M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-8l-5 4v-4H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z" />;

function language(path: string): string {
  if (path.endsWith(".css")) return "css";
  if (path.endsWith(".js")) return "javascript";
  return "xml";
}

export function WebDevStudio({ onClose }: { onClose: () => void }) {
  const [files, setFiles] = useState<ProjectFile[]>(SAMPLE_PROJECT.files);
  // What the preview shows: the files, a moment after typing stops, so it doesn't reload on every key
  const [shownFiles, setShownFiles] = useState(files);
  const [edited, setEdited] = useState(false);
  const [messages, setMessages] = useState<StudioMessage[]>(SCRIPT);
  const [input, setInput] = useState("");
  const [device, setDevice] = useState<Device>("desktop");
  const [codeOpen, setCodeOpen] = useState(false);
  const [previewOn, setPreviewOn] = useState(true);
  const [activePath, setActivePath] = useState("index.html");
  // Phones start on the site, with the chat a tap away
  const [chatOpen, setChatOpen] = useState(() => !window.matchMedia("(max-width: 720px)").matches);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [viewing, setViewing] = useState(LATEST);
  const [reloadKey, setReloadKey] = useState(0);
  const feedRef = useRef<HTMLDivElement>(null);
  const versionsRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setShownFiles(files), 400);
    return () => window.clearTimeout(timer);
  }, [files]);

  const preview = useMemo(() => buildPreview(shownFiles), [shownFiles]);
  const active = files.find((f) => f.path === activePath) ?? files[0];
  const highlighted = useMemo(
    () => hljs.highlight(active.content, { language: language(active.path) }).value,
    [active],
  );
  const lineCount = active.content.split("\n").length;

  // Escape closes the versions list if it's open, otherwise the studio. Panels are the bar's toggles.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (versionsOpen) setVersionsOpen(false);
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [versionsOpen, onClose]);

  useEffect(() => {
    if (!versionsOpen) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!menuRef.current?.contains(target) && !versionsRef.current?.contains(target)) setVersionsOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [versionsOpen]);

  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, chatOpen]);

  const openFile = (path: string) => {
    setActivePath(path);
    setCodeOpen(true);
  };

  // Code and Preview: at least one stays on, so turning off the last one turns the other on
  const toggleCode = () => {
    if (codeOpen && !previewOn) setPreviewOn(true);
    setCodeOpen(!codeOpen);
  };
  const togglePreview = () => {
    if (previewOn && !codeOpen) setCodeOpen(true);
    setPreviewOn(!previewOn);
  };

  const editActive = (content: string) => {
    setFiles((prev) => prev.map((f) => (f.path === activePath ? { ...f, content } : f)));
    setEdited(true);
  };

  // Tab indents by two spaces instead of leaving the editor
  const onEditorKey = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Tab" || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return;
    e.preventDefault();
    const el = e.currentTarget;
    const { selectionStart: start, selectionEnd: end, value } = el;
    editActive(value.slice(0, start) + "  " + value.slice(end));
    requestAnimationFrame(() => el.setSelectionRange(start + 2, start + 2));
  };

  const send = (e: FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;
    setInput("");
    setChatOpen(true);
    setMessages((prev) => [
      ...prev,
      { role: "user", text },
      {
        role: "assistant",
        text: "This is a design preview of the web studio, so I can't change the site yet. Building is coming next.",
      },
    ]);
  };

  return (
    <div
      className={`wd-studio${chatOpen ? " chat-open" : ""}${codeOpen ? " code-open" : ""}${previewOn ? "" : " no-preview"}`}
    >
      {/* ---- Top bar ---- */}
      <header className="wd-bar">
        <div className="wd-bar-group">
          <button className="wd-icon-btn" onClick={onClose} aria-label="Close the studio" title="Close (Esc)">
            <Icon>
              <path d="M15 5l-7 7 7 7" />
            </Icon>
          </button>
          <div className="wd-project">
            <span className="wd-project-name">{SAMPLE_PROJECT.name}</span>
            <button
              ref={versionsRef}
              className={`wd-version-btn${versionsOpen ? " is-open" : ""}`}
              onClick={() => setVersionsOpen((v) => !v)}
              aria-expanded={versionsOpen}
            >
              v{viewing}
              {viewing !== LATEST ? " · Older version" : edited ? " · Edited" : " · Saved"}
              <Icon size={12}>
                <path d="M6 9l6 6 6-6" />
              </Icon>
            </button>
          </div>
        </div>
        {/* Outside the glass pill: a blur nested in another blur only frosts the pill, not the page */}
        {versionsOpen && (
          <div className="wd-versions-menu" role="menu" ref={menuRef}>
            {VERSIONS.map((v) => (
              <button
                key={v.n}
                role="menuitem"
                className={`wd-versions-item${viewing === v.n ? " is-on" : ""}`}
                onClick={() => {
                  setViewing(v.n);
                  setVersionsOpen(false);
                }}
              >
                <span className="wd-versions-n">v{v.n}</span>
                <span className="wd-versions-label">{v.label}</span>
                <span className="wd-versions-when">{v.when}</span>
              </button>
            ))}
          </div>
        )}

        <div className="wd-devices" role="radiogroup" aria-label="Preview size">
          {DEVICES.map((d) => (
            <button
              key={d.id}
              role="radio"
              aria-checked={device === d.id}
              className={`wd-device${device === d.id ? " is-on" : ""}`}
              onClick={() => setDevice(d.id)}
              disabled={!previewOn}
              title={d.label}
              aria-label={d.label}
            >
              <Icon>{d.icon}</Icon>
            </button>
          ))}
        </div>

        <div className="wd-bar-group">
          <button
            className="wd-icon-btn"
            onClick={() => setReloadKey((k) => k + 1)}
            disabled={!previewOn}
            aria-label="Reload preview"
            title="Reload"
          >
            <Icon>
              <path d="M19.36 8.25A8.5 8.5 0 1 1 12 4" />
              <path d="M9.4 1.4L12 4 9.4 6.6" />
            </Icon>
          </button>
          <button className={`wd-pill${codeOpen ? " is-on" : ""}`} onClick={toggleCode} aria-pressed={codeOpen}>
            <Icon>
              <path d="M8.5 7l-5 5 5 5M15.5 7l5 5-5 5" />
            </Icon>
            Code
          </button>
          <button
            className={`wd-pill${previewOn ? " is-on" : ""}`}
            onClick={togglePreview}
            aria-pressed={previewOn}
          >
            <Icon>
              <rect x="3" y="4.5" width="18" height="15" rx="3" />
              <path d="M3 9h18" />
            </Icon>
            Preview
          </button>
          <button
            className={`wd-pill wd-chat-toggle${chatOpen ? " is-on" : ""}`}
            onClick={() => setChatOpen((v) => !v)}
            aria-pressed={chatOpen}
          >
            <Icon>{CHAT_ICON}</Icon>
            Chat
          </button>
        </div>
      </header>

      {/* ---- Code drawer ---- */}
      {codeOpen && (
        <section className="wd-code" aria-label="Code">
          <div className="wd-files" role="tablist">
            {files.map((f) => (
              <button
                key={f.path}
                role="tab"
                aria-selected={f.path === active.path}
                className={`wd-file${f.path === active.path ? " is-on" : ""}`}
                onClick={() => setActivePath(f.path)}
              >
                {f.path}
              </button>
            ))}
          </div>
          <div className="wd-code-body">
            <pre className="wd-gutter" aria-hidden="true">
              {Array.from({ length: lineCount }, (_, i) => i + 1).join("\n")}
            </pre>
            {/* The colored code underneath, and a see-through text box on top that takes the typing */}
            <div className="wd-editor">
              <pre className="wd-source" aria-hidden="true">
                <code className="hljs" dangerouslySetInnerHTML={{ __html: highlighted + "\n" }} />
              </pre>
              <textarea
                className="wd-input"
                value={active.content}
                onChange={(e) => editActive(e.target.value)}
                onKeyDown={onEditorKey}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                wrap="off"
                aria-label={`Edit ${active.path}`}
              />
            </div>
          </div>
        </section>
      )}

      {/* ---- Preview ---- */}
      <main className="wd-canvas" hidden={!previewOn}>
        {viewing !== LATEST && (
          <div className="wd-older">
            Viewing v{viewing}
            <button className="wd-older-btn" onClick={() => setViewing(LATEST)}>
              Back to latest
            </button>
          </div>
        )}
        <div className={`wd-frame wd-frame-${device}`}>
          <iframe
            key={reloadKey}
            title="Site preview"
            srcDoc={preview}
            sandbox="allow-scripts allow-forms"
          />
        </div>
      </main>

      {/* ---- Chat ---- */}
      <aside className="wd-chat" aria-label="Project chat">
        <div className="wd-feed" ref={feedRef}>
          {messages.map((m, i) => (
            <div key={i} className={`wd-msg wd-msg-${m.role}`}>
              <p>{m.text}</p>
              {m.changes && (
                <div className="wd-changes">
                  {m.changes.map((c) => (
                    <button key={c.path} className="wd-change" onClick={() => openFile(c.path)}>
                      <span className="wd-change-verb">{c.verb}</span> {c.path}
                    </button>
                  ))}
                  {m.version && <span className="wd-change-version">v{m.version}</span>}
                </div>
              )}
            </div>
          ))}
        </div>
      </aside>

      <form className="wd-composer" onSubmit={send}>
        <button
          type="button"
          className="wd-icon-btn wd-composer-chat"
          onClick={() => setChatOpen((v) => !v)}
          aria-label={chatOpen ? "Hide chat" : "Show chat"}
        >
          <Icon>{CHAT_ICON}</Icon>
        </button>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Describe a change"
          aria-label="Describe a change"
        />
        <button type="submit" className="wd-send" disabled={!input.trim()} aria-label="Send">
          <Icon>
            <path d="M12 19V5M5 12l7-7 7 7" />
          </Icon>
        </button>
      </form>
    </div>
  );
}

// One rounded set at one size, with the 2px stroke of the app's other small controls (MessageIcons.tsx)
function Icon({ children, size = 17 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

// What the last turn changed, for the card: "Edited index.html, app.js"
const LAST_CHANGES = [...SCRIPT].reverse().find((m) => m.changes)?.changes ?? [];
const LAST_SUMMARY = LAST_CHANGES.length
  ? `${LAST_CHANGES[0].verb} ${LAST_CHANGES.map((c) => c.path).join(", ")}`
  : "";

/** The project in the chat: a live thumbnail of the site, and a way back into the studio */
export function ProjectCard() {
  const open = useContext(WebDevContext);
  const preview = useMemo(() => buildPreview(SAMPLE_PROJECT.files), []);
  if (!open) return null;
  return (
    <button className="wd-card" onClick={open} aria-label={`Open ${SAMPLE_PROJECT.name} in the studio`}>
      <div className="wd-card-thumb" aria-hidden="true">
        <iframe title="" srcDoc={preview} sandbox="allow-scripts" tabIndex={-1} loading="lazy" />
      </div>
      <div className="wd-card-info">
        <div>
          <span className="wd-card-name">{SAMPLE_PROJECT.name}</span>
          <span className="wd-card-meta">
            v{LATEST} · {SAMPLE_PROJECT.files.length} files{LAST_SUMMARY && ` · ${LAST_SUMMARY}`}
          </span>
        </div>
        <span className="wd-card-open">Open</span>
      </div>
    </button>
  );
}
