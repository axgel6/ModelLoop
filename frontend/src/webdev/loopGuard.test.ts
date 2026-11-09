import { afterEach, describe, expect, it, vi } from "vitest";
import { guardLoops, LOOP_GUARD } from "./loopGuard";

// Defines __wdLoop here as the preview frame would, reporting through __wdReport
function installGuard(report: (text: string) => void) {
  const g = globalThis as Record<string, unknown>;
  g.__wdReport = report;
  new Function(LOOP_GUARD.replace(/^<script>|<\/script>$/g, ""))();
}

afterEach(() => {
  const g = globalThis as Record<string, unknown>;
  delete g.__wdLoop;
  delete g.__wdReport;
});

describe("guardLoops", () => {
  it("leaves code without loops, and code that doesn't parse, unchanged", () => {
    expect(guardLoops("console.log(1);", "app.js")).toEqual({ code: "console.log(1);", guarded: false });
    expect(guardLoops("while (", "app.js")).toEqual({ code: "while (", guarded: false });
  });

  it("guards every kind of loop, braced or not, without adding lines", () => {
    const code = [
      "for (let i = 0; i < 3; i++) { a(); }",
      "while (x) x--;",
      "do y++; while (y < 3);",
      "for (const k in o) for (const v of o[k]) b(v);",
    ].join("\n");
    const out = guardLoops(code, "app.js");
    expect(out.guarded).toBe(true);
    expect(out.code.split("\n")).toHaveLength(4);
    expect(out.code.match(/__wdLoop/g)).toHaveLength(5);
    expect(out.code).toContain('while (x) {if (__wdLoop("app.js line 2")) break;x--;}');
    expect(() => new Function(out.code)).not.toThrow();
  });

  it("reads modules too", () => {
    const out = guardLoops("import x from './x.js';\nwhile (true) {}", "app.js");
    expect(out.code).toContain('while (true) {if (__wdLoop("app.js line 2")) break;}');
  });

  it("stops a loop that never ends and says where it was", () => {
    const report = vi.fn();
    installGuard(report);
    const { code } = guardLoops("let n = 0;\nwhile (true) { n++; }\nfor (;;) { n++; }\nreturn n;", "app.js");
    const ran = new Function(code)() as number;
    expect(ran).toBeGreaterThan(1000);
    expect(report).toHaveBeenCalledTimes(1);
    expect(report.mock.calls[0][0]).toContain("app.js line 2");
  }, 10_000);

  it("lets a long but finite loop finish", () => {
    installGuard(vi.fn());
    const { code } = guardLoops("let s = 0;\nfor (let i = 0; i < 1e6; i++) s += i;\nreturn s;", "app.js");
    expect(new Function(code)()).toBe((1e6 * (1e6 - 1)) / 2);
  });
});
