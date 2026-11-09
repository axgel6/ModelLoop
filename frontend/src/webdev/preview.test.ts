import { describe, expect, it } from "vitest";
import { LOOP_GUARD } from "./loopGuard";
import { buildPreview, fixPrompt } from "./preview";

describe("buildPreview", () => {
  it("puts the project's stylesheets and scripts inline", () => {
    const html = buildPreview([
      { path: "index.html", content: '<link rel="stylesheet" href="style.css" /><script src="app.js"></script>' },
      { path: "style.css", content: "body { color: red; }" },
      { path: "app.js", content: "console.log(1);" },
    ]);
    expect(html).toBe(
      "<style>\nbody { color: red; }\n</style><script>console.log(1);\n//# sourceURL=app.js\n</script>",
    );
  });

  it("leaves links to files outside the project alone", () => {
    const tag = '<link rel="stylesheet" href="https://cdn.example/x.css">';
    expect(buildPreview([{ path: "index.html", content: tag }])).toBe(tag);
  });

  it("keeps a script that writes a closing script tag from ending early", () => {
    const html = buildPreview([
      { path: "index.html", content: '<script src="app.js"></script>' },
      { path: "app.js", content: 'const s = "</script>";' },
    ]);
    expect(html).toContain('const s = "<\\/script>";');
  });

  it("says so when there is no index.html", () => {
    expect(buildPreview([])).toContain("No index.html");
  });

  it("adds the error reporter only when asked, inside the head and never before the doctype", () => {
    const page = "<!DOCTYPE html><html><head><title>x</title></head><body><header>Hi</header></body></html>";
    expect(buildPreview([{ path: "index.html", content: page }])).toBe(page);
    const reported = buildPreview([{ path: "index.html", content: page }], { reportErrors: true });
    expect(reported.startsWith("<!DOCTYPE html><html><head><script>")).toBe(true);
    expect(reported).toContain("<header>Hi</header>");
    const bare = buildPreview([{ path: "index.html", content: "<!doctype html><h1>Hi</h1>" }], { reportErrors: true });
    expect(bare.startsWith("<!doctype html><script>")).toBe(true);
  });

  it("reports a script's syntax error by its own message, since a browser may hide it", () => {
    const index = { path: "index.html", content: '<body><script src="app.js"></script></body>' };
    const app = { path: "app.js", content: "let seen = [];\n\nlet seen = [];\nconsole.log('</script>');\n" };
    const html = buildPreview([index, app], { reportErrors: true });
    const checks = [...html.matchAll(/<script>(try \{ new Function[\s\S]*?)<\/script>/g)].map((m) => m[1]);
    expect(checks).toHaveLength(1);
    const sent: string[] = [];
    const scope = globalThis as { __wdReport?: (t: string) => void; __wdSyntax?: number };
    scope.__wdReport = (t) => sent.push(t);
    try {
      new Function(checks[0])();
      expect(sent).toEqual([expect.stringMatching(/seen.*already been declared \(app\.js\)$/)]);
      expect(scope.__wdSyntax).toBe(1);
    } finally {
      delete scope.__wdReport;
      delete scope.__wdSyntax;
    }
    // Only when errors are reported, and never for code that parses
    expect(buildPreview([index, app])).not.toContain("new Function");
    const fine = buildPreview([index, { path: "app.js", content: "let a = 1;" }], { reportErrors: true });
    sent.length = 0;
    scope.__wdReport = (t) => sent.push(t);
    new Function(/<script>(try \{ new Function[\s\S]*?)<\/script>/.exec(fine)![1])();
    delete scope.__wdReport;
    expect(sent).toEqual([]);
  });

  it("guards loops in project scripts and in index.html, and adds the guard only then", () => {
    const html = buildPreview([
      {
        path: "index.html",
        content: '<head></head>\n<script src="app.js"></script>\n<script>\nwhile (true) {}\n</script>\n<script type="application/json">{"a":1}</script>',
      },
      { path: "app.js", content: "for (;;) {}" },
    ]);
    expect(html.startsWith("<head>" + LOOP_GUARD)).toBe(true);
    expect(html).toContain('for (;;) {if (__wdLoop("app.js line 1")) break;}');
    expect(html).toContain('while (true) {if (__wdLoop("index.html line 4")) break;}');
    expect(html).toContain('<script type="application/json">{"a":1}</script>');
    expect(buildPreview([{ path: "index.html", content: "<script>go()</script>" }])).toBe("<script>go()</script>");
  });

  it("keeps a module a module, and finds files linked with ./ or single quotes", () => {
    const html = buildPreview([
      {
        path: "index.html",
        content: `<link rel='stylesheet' href='./style.css'><script type="module" src="./app.js" defer></script>`,
      },
      { path: "style.css", content: "p {}" },
      { path: "app.js", content: "export const a = 1;" },
    ]);
    expect(html).toBe(
      '<style>\np {}\n</style><script type="module">export const a = 1;\n//# sourceURL=app.js\n</script>',
    );
  });

  it("moves a deferred script to the end of the body, where the page it looks up exists", () => {
    const html = buildPreview([
      { path: "index.html", content: '<head><script src="app.js" defer></script></head><body><p>Hi</p></body>' },
      { path: "app.js", content: "go();" },
    ]);
    expect(html).toBe("<head></head><body><p>Hi</p><script>go();\n//# sourceURL=app.js\n</script></body>");
  });

  it("writes Fix it's message from the errors", () => {
    expect(fixPrompt(["x is not defined (app.js line 3)"])).toBe(
      "The preview shows an error. Please fix it.\n\n- x is not defined (app.js line 3)",
    );
  });
});
