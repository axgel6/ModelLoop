import {
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import hljs from "highlight.js/lib/core";
import css from "highlight.js/lib/languages/css";
import javascript from "highlight.js/lib/languages/javascript";
import xml from "highlight.js/lib/languages/xml";
import { CHANGE_VERBS, WebDevContext, type FileChange, type StudioMessage, type StudioProject } from "./context";
import { buildPreview, fixPrompt, type PreviewProblem, type ProjectFile } from "./preview";
import { ProjectSteps } from "./ProjectSteps";
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

type CodeTheme = "auto" | "light" | "dark";
const CODE_THEME_KEY = "wd_code_theme";
const CODE_THEMES: { id: CodeTheme; label: string; icon: ReactNode }[] = [
  {
    id: "auto",
    label: "Match the app",
    icon: (
      <>
        <circle cx="12" cy="12" r="8" />
        <path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" />
      </>
    ),
  },
  {
    id: "light",
    label: "Light code",
    icon: (
      <>
        <circle cx="12" cy="12" r="3.5" />
        <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4" />
      </>
    ),
  },
  { id: "dark", label: "Dark code", icon: <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" /> },
];

function savedCodeTheme(): CodeTheme {
  try {
    const saved = localStorage.getItem(CODE_THEME_KEY);
    return saved === "light" || saved === "dark" ? saved : "auto";
  } catch {
    return "auto";
  }
}

function language(path: string): string {
  if (path.endsWith(".css")) return "css";
  if (path.endsWith(".js")) return "javascript";
  return "xml";
}

export interface WebDevStudioProps {
  project: StudioProject;
  messages: StudioMessage[];
  /** A reply is being written */
  busy: boolean;
  /** What the model is doing, while the reply has no text yet */
  activity: string | null;
  onSend: (text: string) => void;
  onStop?: () => void;
  /** Every file in an older version. Without it, older versions can't be viewed. */
  loadVersion?: (version: number) => Promise<ProjectFile[]>;
  /** Saves an older version as the newest. Resolves once saved; the new version then arrives as `project`. */
  onRestore?: (version: number) => Promise<void>;
  /** Opens with the code drawer on this file */
  initialPath?: string;
  onClose: () => void;
}

export function WebDevStudio({
  project,
  messages,
  busy,
  activity,
  onSend,
  onStop,
  loadVersion,
  onRestore,
  initialPath,
  onClose,
}: WebDevStudioProps) {
  const latest = project.version;
  const [input, setInput] = useState("");
  const [device, setDevice] = useState<Device>("desktop");
  const [codeOpen, setCodeOpen] = useState(!!initialPath);
  const [previewOn, setPreviewOn] = useState(true);
  const [activePath, setActivePath] = useState(initialPath ?? "index.html");
  // Phones start on the site, with the chat a tap away
  const [chatOpen, setChatOpen] = useState(() => !window.matchMedia("(max-width: 720px)").matches);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [viewing, setViewing] = useState(latest);
  // An older version's files, once loaded
  const [older, setOlder] = useState<{ version: number; files: ProjectFile[] } | null>(null);
  // The version that failed to load, if one did
  const [failed, setFailed] = useState<number | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [codeTheme, setCodeTheme] = useState<CodeTheme>(savedCodeTheme);
  const pickCodeTheme = (theme: CodeTheme) => {
    setCodeTheme(theme);
    try {
      localStorage.setItem(CODE_THEME_KEY, theme);
    } catch {
      // Not remembered in a private window; the choice still holds for now
    }
  };
  // The version being restored, until it arrives as the latest
  const [restoring, setRestoring] = useState<number | null>(null);
  const [restoreFailed, setRestoreFailed] = useState<number | null>(null);
  // Errors the preview reported, for the page they came from (see `frameId`)
  const [problems, setProblems] = useState<{ frame: string; list: string[]; dismissed: boolean } | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const versionsRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // A new version from the chat takes over the preview
  const [seenLatest, setSeenLatest] = useState(latest);
  if (seenLatest !== latest) {
    setSeenLatest(latest);
    setViewing(latest);
    setRestoring(null);
  }

  useEffect(() => {
    if (viewing === latest || !loadVersion || older?.version === viewing) return;
    let cancelled = false;
    loadVersion(viewing)
      .then((files) => !cancelled && setOlder({ version: viewing, files }))
      .catch(() => !cancelled && setFailed(viewing));
    return () => {
      cancelled = true;
    };
  }, [viewing, latest, loadVersion, older?.version]);

  const isOlder = viewing !== latest;
  // Until an older version loads, the latest stays on screen under its banner
  const files = isOlder && older?.version === viewing ? older.files : project.files;
  // Only the latest version reports errors: that's the one Fix it changes
  const preview = useMemo(() => buildPreview(files, { reportErrors: !isOlder }), [files, isOlder]);
  // Each load of the preview, so errors from a page that's gone don't linger
  const frameId = `${reloadKey}:${preview}`;
  const frameIdRef = useRef(frameId);
  useEffect(() => {
    frameIdRef.current = frameId;
  }, [frameId]);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const data = e.data as PreviewProblem | undefined;
      if (e.source !== frameRef.current?.contentWindow || data?.wdPreview !== 1 || typeof data.text !== "string") return;
      const frame = frameIdRef.current;
      setProblems((p) => {
        const list = p?.frame === frame ? p.list : [];
        if (list.includes(data.text) || list.length >= 5) return p;
        return { frame, list: [...list, data.text], dismissed: p?.frame === frame && p.dismissed };
      });
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);
  // Not while a reply is written: the site is mid-change, and Fix it can't send yet
  const shownProblems = problems?.frame === frameId && !problems.dismissed && !isOlder && !busy ? problems.list : [];
  const active: ProjectFile | undefined = files.find((f) => f.path === activePath) ?? files[0];
  const highlighted = useMemo(
    () => (active ? hljs.highlight(active.content, { language: language(active.path) }).value : ""),
    [active],
  );
  const lineCount = active ? active.content.split("\n").length : 0;

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

  const send = (e: FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setChatOpen(true);
    // The model works on the latest version, so that's what the preview shows
    setViewing(latest);
    onSend(text);
  };

  const fixIt = () => {
    if (busy || !shownProblems.length) return;
    setProblems((p) => p && { ...p, dismissed: true });
    setChatOpen(true);
    onSend(fixPrompt(shownProblems));
  };

  const restore = async () => {
    if (!onRestore || busy || restoring != null) return;
    const version = viewing;
    setRestoring(version);
    setRestoreFailed(null);
    try {
      await onRestore(version);
    } catch {
      setRestoring(null);
      setRestoreFailed(version);
    }
  };

  const versionStatus = latest === 0 ? "Not built yet" : isOlder ? `v${viewing} · Older version` : `v${viewing}`;

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
            <span className="wd-project-name">{project.name}</span>
            <button
              ref={versionsRef}
              className={`wd-version-btn${versionsOpen ? " is-open" : ""}`}
              onClick={() => setVersionsOpen((v) => !v)}
              disabled={project.versions.length < 2 || !loadVersion}
              aria-expanded={versionsOpen}
            >
              {versionStatus}
              <Icon size={12}>
                <path d="M6 9l6 6 6-6" />
              </Icon>
            </button>
          </div>
        </div>
        {/* Outside the glass pill: a blur nested in another blur only frosts the pill, not the page */}
        {versionsOpen && (
          <div className="wd-versions-menu" role="menu" ref={menuRef}>
            {project.versions.map((v) => (
              <button
                key={v.version}
                role="menuitem"
                className={`wd-versions-item${viewing === v.version ? " is-on" : ""}`}
                onClick={() => {
                  setViewing(v.version);
                  setVersionsOpen(false);
                }}
              >
                <span className="wd-versions-n">v{v.version}</span>
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
          <div className="wd-code-head">
            <div className="wd-files" role="tablist">
              {files.map((f) => (
                <button
                  key={f.path}
                  role="tab"
                  aria-selected={f.path === active?.path}
                  className={`wd-file${f.path === active?.path ? " is-on" : ""}`}
                  onClick={() => setActivePath(f.path)}
                >
                  {f.path}
                </button>
              ))}
            </div>
            <div className="wd-code-theme" role="radiogroup" aria-label="Code colors">
              {CODE_THEMES.map((t) => (
                <button
                  key={t.id}
                  role="radio"
                  aria-checked={codeTheme === t.id}
                  className={codeTheme === t.id ? "is-on" : ""}
                  onClick={() => pickCodeTheme(t.id)}
                  title={t.label}
                  aria-label={t.label}
                >
                  <Icon size={14}>{t.icon}</Icon>
                </button>
              ))}
            </div>
          </div>
          {active ? (
            <div className="wd-code-body" data-code={codeTheme}>
              <pre className="wd-gutter" aria-hidden="true">
                {Array.from({ length: lineCount }, (_, i) => i + 1).join("\n")}
              </pre>
              {/* The colored code underneath, and a see-through text box on top for selecting and copying.
                  Read-only: the model writes the code, and hand edits come later as versions of their own. */}
              <div className="wd-editor">
                <pre className="wd-source" aria-hidden="true">
                  <code className="hljs" dangerouslySetInnerHTML={{ __html: highlighted + "\n" }} />
                </pre>
                <textarea
                  className="wd-input"
                  value={active.content}
                  readOnly
                  spellCheck={false}
                  autoCapitalize="off"
                  autoCorrect="off"
                  wrap="off"
                  aria-label={active.path}
                />
              </div>
            </div>
          ) : (
            <p className="wd-code-empty">No files yet. They appear here as the site is built.</p>
          )}
        </section>
      )}

      {/* ---- Preview ---- */}
      <main className="wd-canvas" hidden={!previewOn}>
        {isOlder && (
          <div className="wd-older">
            {failed === viewing && older?.version !== viewing
              ? `Couldn't load v${viewing}`
              : restoreFailed === viewing
                ? `Couldn't restore v${viewing}`
                : `Viewing v${viewing}`}
            {onRestore && older?.version === viewing && (
              <button className="wd-older-btn" onClick={restore} disabled={busy || restoring != null}>
                {restoring === viewing ? "Restoring" : "Restore"}
              </button>
            )}
            <button className="wd-older-btn" onClick={() => setViewing(latest)}>
              Back to latest
            </button>
          </div>
        )}
        {shownProblems.length > 0 && (
          <div className="wd-problem" role="alert">
            <span className="wd-problem-text" title={shownProblems.join("\n")}>
              {shownProblems.length === 1 ? shownProblems[0] : `${shownProblems.length} errors. ${shownProblems[0]}`}
            </span>
            <button className="wd-older-btn wd-fix" onClick={fixIt} disabled={busy}>
              Fix it
            </button>
            <button
              className="wd-icon-btn wd-problem-close"
              onClick={() => setProblems((p) => p && { ...p, dismissed: true })}
              aria-label="Dismiss the error"
            >
              <Icon size={14}>
                <path d="M6 6l12 12M18 6L6 18" />
              </Icon>
            </button>
          </div>
        )}
        <div className={`wd-frame wd-frame-${device}`}>
          <iframe
            ref={frameRef}
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
          {messages.map((m, i) => {
            const running = busy && i === messages.length - 1 && m.role === "assistant";
            const waiting = running && !m.text;
            return (
              <div key={i} className={`wd-msg wd-msg-${m.role}`}>
                {running && m.steps ? (
                  <>
                    {m.text && <p>{m.text}</p>}
                    <ProjectSteps steps={m.steps} startedAt={m.createdAt} />
                  </>
                ) : waiting ? (
                  <p className="wd-msg-activity" role="status">
                    {activity ?? "Working on it"}
                  </p>
                ) : (
                  m.text && <p>{m.text}</p>
                )}
                {!!m.changes?.length && (
                  <div className="wd-changes">
                    {m.changes.map((c) =>
                      c.action === "deleted" ? (
                        <span key={c.path} className="wd-change-deleted">
                          <span className="wd-change-verb">Deleted</span> {c.path}
                        </span>
                      ) : (
                        <button key={c.path} className="wd-change" onClick={() => openFile(c.path)}>
                          <span className="wd-change-verb">{CHANGE_VERBS[c.action]}</span> {c.path}
                        </button>
                      ),
                    )}
                    {m.version != null && <span className="wd-change-version">v{m.version}</span>}
                  </div>
                )}
              </div>
            );
          })}
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
        {busy && onStop ? (
          <button type="button" className="wd-send" onClick={onStop} aria-label="Stop">
            <Icon>
              <rect x="7" y="7" width="10" height="10" rx="2" />
            </Icon>
          </button>
        ) : (
          <button type="submit" className="wd-send" disabled={!input.trim() || busy} aria-label="Send">
            <Icon>
              <path d="M12 19V5M5 12l7-7 7 7" />
            </Icon>
          </button>
        )}
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

/** The card's summary of the last turn: "Edited index.html, app.js" */
function changeSummary(changes: FileChange[]): string {
  if (!changes.length) return "";
  const verb = changes.every((c) => c.action === changes[0].action) ? CHANGE_VERBS[changes[0].action] : "Changed";
  return `${verb} ${changes.map((c) => c.path).join(", ")}`;
}

/** The project in the chat: a live thumbnail of the site, and a way into the studio */
export function ProjectCard() {
  const ctx = useContext(WebDevContext);
  const project = ctx?.project;
  const files = project?.files;
  const preview = useMemo(() => (files?.length ? buildPreview(files) : ""), [files]);
  if (!ctx || !project) return null;
  const summary = project.restoredFrom ? `Restored v${project.restoredFrom}` : changeSummary(project.lastChanges);
  const count = project.files.length;
  return (
    <button
      className="wd-card"
      onClick={() => ctx.open()}
      aria-label={`Open ${project.name} in the studio`}
    >
      <div className="wd-card-thumb" aria-hidden="true">
        {preview ? (
          <iframe title="" srcDoc={preview} sandbox="allow-scripts" tabIndex={-1} loading="lazy" />
        ) : (
          <span className="wd-card-empty">Nothing built yet</span>
        )}
      </div>
      <div className="wd-card-info">
        <div>
          <span className="wd-card-name">{project.name}</span>
          <span className="wd-card-meta">
            {project.version ? `v${project.version} · ` : ""}
            {count} {count === 1 ? "file" : "files"}
            {summary && ` · ${summary}`}
          </span>
        </div>
        <span className="wd-card-open">Open</span>
      </div>
    </button>
  );
}
