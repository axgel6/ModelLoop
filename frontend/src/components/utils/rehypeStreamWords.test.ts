import type { Element, Root } from "hast";
import { describe, expect, it } from "vitest";
import { rehypeStreamWords } from "./rehypeStreamWords";

const text = (value: string) => ({ type: "text" as const, value });
const el = (tagName: string, children: Element["children"], className?: string[]): Element => ({
  type: "element",
  tagName,
  properties: className ? { className } : {},
  children,
});
const run = (tree: Root) => {
  rehypeStreamWords()(tree);
  return tree;
};
const words = (node: Root | Element): string[] =>
  node.children.flatMap((c) =>
    c.type === "element" && (c.properties?.className as string[] | undefined)?.includes("stream-word")
      ? [(c.children[0] as { value: string }).value]
      : c.type === "element"
        ? words(c)
        : [],
  );

describe("rehypeStreamWords", () => {
  it("puts each word in its own stream-word span and keeps the spaces as text", () => {
    const tree = run({ type: "root", children: [el("p", [text("Hello there  world")])] });
    const p = tree.children[0] as Element;
    expect(words(p)).toEqual(["Hello", "there", "world"]);
    expect(p.children.filter((c) => c.type === "text").map((c) => (c as { value: string }).value)).toEqual([
      " ",
      "  ",
    ]);
  });

  it("wraps words inside nested formatting", () => {
    const tree = run({ type: "root", children: [el("p", [text("a "), el("strong", [text("bold move")])])] });
    expect(words(tree)).toEqual(["a", "bold", "move"]);
  });

  it("leaves code, preformatted blocks and math whole", () => {
    const code = el("code", [text("const x = 1")]);
    const pre = el("pre", [el("code", [text("npm run build")])]);
    const math = el("span", [text("x + y")], ["katex"]);
    const tree = run({ type: "root", children: [el("p", [code, math]), pre] });
    expect(words(tree)).toEqual([]);
    expect(code.children).toEqual([text("const x = 1")]);
  });

  it("gives an earlier word the same position as the text grows, so it keeps its span", () => {
    const first = run({ type: "root", children: [el("p", [text("The quick")])] });
    const later = run({ type: "root", children: [el("p", [text("The quick brown fox")])] });
    const kids = (t: Root) => (t.children[0] as Element).children;
    expect(kids(later).slice(0, kids(first).length)).toEqual(kids(first));
  });
});
