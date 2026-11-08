import { describe, expect, it } from "vitest";
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

  it("writes Fix it's message from the errors", () => {
    expect(fixPrompt(["x is not defined (app.js line 3)"])).toBe(
      "The preview shows an error. Please fix it.\n\n- x is not defined (app.js line 3)",
    );
  });
});
