import { describe, expect, it } from "vitest";
import { buildPreview } from "./preview";

describe("buildPreview", () => {
  it("puts the project's stylesheets and scripts inline", () => {
    const html = buildPreview([
      { path: "index.html", content: '<link rel="stylesheet" href="style.css" /><script src="app.js"></script>' },
      { path: "style.css", content: "body { color: red; }" },
      { path: "app.js", content: "console.log(1);" },
    ]);
    expect(html).toBe("<style>\nbody { color: red; }\n</style><script>\nconsole.log(1);\n</script>");
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
});
