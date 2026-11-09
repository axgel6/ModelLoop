import { useEffect, useState } from "react";
import type { ProjectStep } from "./context";
import "./webdev.css";

const DONE: Record<ProjectStep["verb"], string> = {
  created: "Created",
  replaced: "Rewrote",
  edited: "Edited",
  deleted: "Deleted",
  read: "Read",
  listed: "Looked over the files",
  planned: "Planned the site",
  checked: "Checked the site",
};
function label({ verb, path, count }: ProjectStep): string {
  if (verb === "checked" && count) return `Found ${count === 1 ? "a problem" : `${count} problems`} to fix`;
  return verb === "listed" || !path ? DONE[verb] : `${DONE[verb]} ${path}`;
}

/** "0:42", "1:05" */
function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** While a project turn runs: each step as it finishes, then the one in progress with a timer.
 *  A small model can spend a minute writing one file, so the timer shows it's still going.
 *  Only steps that worked arrive (see backend/routers/stream.py). */
export function ProjectSteps({ steps, startedAt }: { steps: ProjectStep[]; startedAt?: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const started = startedAt ? new Date(startedAt).getTime() : now;
  const elapsed = Math.max(0, Math.floor((now - started) / 1000));
  return (
    <ol className="wd-steps" aria-label="Progress">
      {steps.map((s, i) => (
        <li key={i} className="wd-step">
          <span className="wd-step-mark" aria-hidden="true" />
          {label(s)}
        </li>
      ))}
      <li className="wd-step is-active" role="status">
        <span className="wd-step-mark" aria-hidden="true" />
        {steps.length ? "Working on the next step" : "Working on the site"}
        <span className="wd-step-time">{clock(elapsed)}</span>
      </li>
    </ol>
  );
}
