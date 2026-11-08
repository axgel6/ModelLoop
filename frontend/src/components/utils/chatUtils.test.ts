import { describe, expect, it } from "vitest";
import { fixNestedFences } from "./chatUtils";

describe("fixNestedFences", () => {
  it("leaves ordinary code blocks alone", () => {
    const text = "Intro\n\n```js\nconst a = 1;\n```\n\nOutro\n\n```\nplain\n```";
    expect(fixNestedFences(text)).toBe(text);
  });

  it("lengthens the fences of a block that holds another", () => {
    const text = "README:\n\n```markdown\n# Title\n\n```bash\nnpm i\n```\n\nMore\n```\n\nDone.";
    expect(fixNestedFences(text)).toBe(
      "README:\n\n````markdown\n# Title\n\n```bash\nnpm i\n```\n\nMore\n````\n\nDone.",
    );
  });

  it("leaves a block still being written open", () => {
    const text = "Here:\n\n```markdown\n# Title\n\n```bash\nnpm i\n```";
    expect(fixNestedFences(text)).toBe(text);
  });
});
