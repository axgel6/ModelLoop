import { useContext } from "react";
import type { ProjectChanges } from "../components/api";
import { CHANGE_VERBS, WebDevContext } from "./context";
import "./webdev.css";

/** Under a project reply: the files it changed. Tapping one opens it in the studio. */
export function ProjectChangeLabels({ changes }: { changes: ProjectChanges }) {
  const ctx = useContext(WebDevContext);
  // Older replies saved a "No coding model is installed" note, which is no longer shown
  const note = changes.note?.startsWith("No coding model") ? undefined : changes.note;
  if (!changes.files.length && !note) return null;
  // The studio needs the project loaded; until then the labels only say what happened
  const canOpen = !!ctx?.project;
  return (
    <div className="wd-reply-changes">
      {changes.files.length > 0 && (
        <div className="wd-reply-files">
          {changes.files.map((f) =>
            canOpen && f.action !== "deleted" ? (
              <button key={f.path} className="wd-reply-file" onClick={() => ctx.open({ path: f.path })}>
                <span className="wd-change-verb">{CHANGE_VERBS[f.action]}</span> {f.path}
              </button>
            ) : (
              <span key={f.path} className="wd-reply-file">
                <span className="wd-change-verb">{CHANGE_VERBS[f.action]}</span> {f.path}
              </span>
            ),
          )}
        </div>
      )}
      {note && <p className="wd-reply-note">{note}</p>}
    </div>
  );
}
