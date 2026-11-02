import type { Element, ElementContent, Root } from "hast";

// While a reply streams, every word sits in its own span so it can come into focus as it lands.
// A word keeps its place among its siblings as the text grows, so React keeps its span and only
// newly arrived words play the effect. Code, math and diagrams are left whole.
const KEEP_WHOLE = new Set(["pre", "code", "svg", "math"]);

function wrapWords(node: Root | Element) {
  const out: ElementContent[] = [];
  for (const child of node.children) {
    if (child.type === "text") {
      for (const part of child.value.split(/(\s+)/)) {
        if (!part) continue;
        out.push(
          /^\s/.test(part)
            ? { type: "text", value: part }
            : {
                type: "element",
                tagName: "span",
                properties: { className: ["stream-word"] },
                children: [{ type: "text", value: part }],
              },
        );
      }
    } else {
      if (child.type === "element") {
        const cls = child.properties?.className;
        const isMath = Array.isArray(cls) && cls.some((c) => String(c).startsWith("katex"));
        if (!KEEP_WHOLE.has(child.tagName) && !isMath) wrapWords(child);
      }
      out.push(child as ElementContent);
    }
  }
  node.children = out as typeof node.children;
}

export const rehypeStreamWords = () => (tree: Root) => wrapWords(tree);
