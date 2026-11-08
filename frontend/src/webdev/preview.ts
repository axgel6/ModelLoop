export interface ProjectFile {
  path: string;
  content: string;
}

/** What the reporter posts to the app for each problem in the preview */
export interface PreviewProblem {
  wdPreview: 1;
  text: string;
}

// Runs first in the preview and posts its errors to the app, for Fix it. The frame has no
// access to the app, so a message is all it can send. Capped so a loop can't flood the app.
const REPORTER = `<script>(function () {
  var sent = 0;
  function send(text) {
    if (sent++ >= 20) return;
    try { parent.postMessage({ wdPreview: 1, text: String(text).slice(0, 400) }, "*"); } catch (e) {}
  }
  function where(error) {
    var frame = error && error.stack && /([\\w./-]+\\.m?js):(\\d+)/.exec(error.stack);
    return frame ? " (" + frame[1].split("/").pop() + " line " + frame[2] + ")" : "";
  }
  addEventListener("error", function (e) {
    var el = e.target;
    if (el && el !== window && el.getAttribute) {
      send("Couldn't load " + (el.getAttribute("src") || el.getAttribute("href") || el.tagName.toLowerCase()));
      return;
    }
    send((e.message || "Script error") + where(e.error));
  }, true);
  addEventListener("unhandledrejection", function (e) {
    var r = e.reason;
    send("Unhandled promise rejection: " + (r && r.message ? r.message + where(r) : r));
  });
  var original = console.error;
  console.error = function () {
    send("console.error: " + Array.prototype.map.call(arguments, function (a) {
      if (a instanceof Error) return a.message;
      try { return typeof a === "object" ? JSON.stringify(a) : String(a); } catch (x) { return String(a); }
    }).join(" "));
    return original.apply(console, arguments);
  };
})();</script>`;

/** Puts the reporter as early as it can go: in the head, or after the doctype, or first */
function withReporter(html: string): string {
  const head = /<head(\s[^>]*)?>/i.exec(html);
  if (head) return html.slice(0, head.index + head[0].length) + REPORTER + html.slice(head.index + head[0].length);
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html);
  if (doctype) return doctype[0] + REPORTER + html.slice(doctype[0].length);
  return REPORTER + html;
}

/** One HTML document from the project: its stylesheets and scripts put inline, for the preview frame.
 *  With `reportErrors`, the document posts its errors to the app (see PreviewProblem). */
export function buildPreview(files: ProjectFile[], { reportErrors = false } = {}): string {
  const byPath = new Map(files.map((f) => [f.path, f.content]));
  const html = (byPath.get("index.html") ?? "<p>No index.html yet.</p>")
    .replace(/<link[^>]+href="([^"]+\.css)"[^>]*>/g, (tag, href: string) =>
      byPath.has(href) ? `<style>\n${byPath.get(href)}\n</style>` : tag,
    )
    // The sourceURL names the file in error stacks, with its own line numbers
    .replace(/<script[^>]+src="([^"]+\.js)"[^>]*><\/script>/g, (tag, src: string) =>
      byPath.has(src)
        ? `<script>${byPath.get(src)!.replace(/<\/script/gi, "<\\/script")}\n//# sourceURL=${src}\n</script>`
        : tag,
    );
  return reportErrors ? withReporter(html) : html;
}

/** The message Fix it sends: the errors, for the model to fix */
export function fixPrompt(problems: string[]): string {
  return `The preview shows ${problems.length === 1 ? "an error" : "these errors"}. Please fix ${problems.length === 1 ? "it" : "them"}.\n\n${problems.map((p) => `- ${p}`).join("\n")}`;
}
