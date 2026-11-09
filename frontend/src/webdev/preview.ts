import { guardLoops, LOOP_GUARD } from "./loopGuard";

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
  globalThis.__wdReport = send;
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
    // Some browsers hide a syntax error's details from the page ("Script error."), and the
    // syntax check below has already said what it was
    if (!e.error && globalThis.__wdSyntax && /^Script error\.?$/.test(e.message || "")) return;
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

/** Puts `scripts` as early as they can go: in the head, or after the doctype, or first */
function withEarlyScripts(html: string, scripts: string): string {
  if (!scripts) return html;
  const head = /<head(\s[^>]*)?>/i.exec(html);
  if (head) return html.slice(0, head.index + head[0].length) + scripts + html.slice(head.index + head[0].length);
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html);
  if (doctype) return doctype[0] + scripts + html.slice(doctype[0].length);
  return scripts + html;
}

/** Puts `scripts` at the end of the body, or at the end */
function withLateScripts(html: string, scripts: string): string {
  if (!scripts) return html;
  const end = html.toLowerCase().lastIndexOf("</body");
  return end < 0 ? html + scripts : html.slice(0, end) + scripts + html.slice(end);
}

/** A link's project path: "./app.js" and "/app.js" name the same file as "app.js" */
function projectPath(href: string): string {
  return href.replace(/^(\.\/|\/)+/, "");
}

// Inline scripts the browser runs as JavaScript; others (JSON, templates, Babel) are left alone
const JS_TYPE = /^\s*(?:module|(?:text|application)\/(?:x-)?(?:javascript|ecmascript))?\s*$/i;

/** A script that parses `code` without running it and reports a syntax error in it, such as a
 *  name declared twice, by its own message. A script that won't parse never runs, and some
 *  browsers report that only as "Script error.", which gives Fix it nothing to go on. */
function syntaxCheck(code: string, path: string): string {
  const source = JSON.stringify(code).replace(/<\//g, "<\\/").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  return `<script>try { new Function(${source}); } catch (e) { if (e instanceof SyntaxError && globalThis.__wdReport) { globalThis.__wdSyntax = 1; __wdReport(e.message + ${JSON.stringify(` (${path})`).replace(/</g, "\\u003c")}); } }</script>`;
}

/** One HTML document from the project: its stylesheets and scripts put inline, for the preview frame.
 *  Every loop gets a time limit (see loopGuard.ts), so a loop that never ends can't freeze the app.
 *  With `reportErrors`, the document posts its errors to the app (see PreviewProblem). */
export function buildPreview(files: ProjectFile[], { reportErrors = false } = {}): string {
  const byPath = new Map(files.map((f) => [f.path, f.content]));
  let guarded = false;
  const guard = (code: string, file: string, lineOffset = 0) => {
    const out = guardLoops(code, file, lineOffset);
    guarded ||= out.guarded;
    return out.code;
  };
  const source = byPath.get("index.html") ?? "<p>No index.html yet.</p>";
  // Classic scripts marked defer, which go at the end of the body (see below)
  const deferred: string[] = [];
  const html = source
    // Scripts written in index.html, first, while their positions are still the file's own
    .replace(/(<script(\s[^>]*)?>)([\s\S]*?)(<\/script>)/gi, (tag, open: string, attrs = "", code: string, close: string, at: number) => {
      if (/\ssrc\s*=/i.test(attrs)) return tag;
      const type = /\stype\s*=\s*["']?([^"'\s>]*)/i.exec(attrs)?.[1] ?? "";
      if (!JS_TYPE.test(type) || !code.trim()) return tag;
      const lineOffset = source.slice(0, at + open.length).split("\n").length - 1;
      return open + guard(code, "index.html", lineOffset) + close;
    })
    .replace(/<link[^>]+href=["']([^"']+\.css)["'][^>]*>/g, (tag, href: string) => {
      const css = byPath.get(projectPath(href));
      return css === undefined ? tag : `<style>\n${css}\n</style>`;
    })
    // The sourceURL names the file in error stacks, with its own line numbers. A module stays a
    // module, so its import and export lines still parse. An inline script ignores defer, so a
    // deferred one moves to the end of the body, where the elements it looks up already exist.
    .replace(/<script([^>]*)\ssrc=["']([^"']+\.m?js)["']([^>]*)><\/script>/g, (tag, before: string, src: string, after: string) => {
      const path = projectPath(src);
      const code = byPath.get(path);
      if (code === undefined) return tag;
      const attrs = before + after;
      const isModule = /\stype\s*=\s*["']?module\b/i.test(attrs);
      const script = `${isModule ? '<script type="module">' : "<script>"}${guard(code, path).replace(/<\/script/gi, "<\\/script")}\n//# sourceURL=${path}\n</script>`;
      // Reported before it runs: the browser may show a syntax error only as "Script error."
      const check = reportErrors && !isModule ? syntaxCheck(code, path) : "";
      if (isModule || !/\sdefer\b/i.test(attrs)) return check + script;
      deferred.push(check + script);
      return "";
    });
  return withEarlyScripts(withLateScripts(html, deferred.join("")), (reportErrors ? REPORTER : "") + (guarded ? LOOP_GUARD : ""));
}

/** The message Fix it sends: the errors, for the model to fix */
export function fixPrompt(problems: string[]): string {
  return `The preview shows ${problems.length === 1 ? "an error" : "these errors"}. Please fix ${problems.length === 1 ? "it" : "them"}.\n\n${problems.map((p) => `- ${p}`).join("\n")}`;
}
