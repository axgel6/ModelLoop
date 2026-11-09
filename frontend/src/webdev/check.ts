import { buildPreview, type ProjectFile, type PreviewProblem } from "./preview";
import { onPreviewsChange, previewsStopped } from "./stop";

/** How long the page runs after it loads, and the longest a check may take in all */
const SETTLE_MS = 2500;
const LIMIT_MS = 7000;

/** Runs a project in a hidden preview and resolves with the errors it reported, for the
 *  checker in a running project turn (see backend/project_checks.py). The frame has the same
 *  sandbox as the studio's preview, so the code can't reach the app. While previews are stopped
 *  nothing runs, and stopping them ends a check that is running; either way the turn goes on
 *  with the backend's own checks. */
export function runPreviewCheck(files: ProjectFile[]): Promise<string[]> {
  if (previewsStopped()) return Promise.resolve([]);
  return new Promise((resolve) => {
    const frame = document.createElement("iframe");
    frame.setAttribute("sandbox", "allow-scripts allow-forms");
    frame.setAttribute("aria-hidden", "true");
    frame.tabIndex = -1;
    // Off screen at a desktop size, so a layout that depends on width runs as it would
    frame.style.cssText =
      "position:fixed;left:-10000px;top:0;width:1024px;height:768px;border:0;opacity:0;pointer-events:none";
    const errors: string[] = [];
    const onMessage = (e: MessageEvent) => {
      const data = e.data as Partial<PreviewProblem> | null;
      if (e.source !== frame.contentWindow || data?.wdPreview !== 1 || typeof data.text !== "string") return;
      if (!errors.includes(data.text)) errors.push(data.text);
    };
    let settle: number | undefined;
    const finish = () => {
      window.clearTimeout(settle);
      window.clearTimeout(limit);
      window.removeEventListener("message", onMessage);
      unsubscribe();
      frame.remove();
      resolve(errors.slice(0, 20));
    };
    const limit = window.setTimeout(finish, LIMIT_MS);
    const unsubscribe = onPreviewsChange(() => {
      if (previewsStopped()) finish();
    });
    frame.addEventListener("load", () => {
      settle = window.setTimeout(finish, SETTLE_MS);
    });
    window.addEventListener("message", onMessage);
    frame.srcdoc = buildPreview(files, { reportErrors: true });
    document.body.appendChild(frame);
  });
}
