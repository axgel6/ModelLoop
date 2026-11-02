import { describe, expect, it } from "vitest";
import { toLyricText } from "./chatUtils";

describe("toLyricText", () => {
  it("keeps a poem's line breaks and stanza breaks", () => {
    const poem = "Clouds drift softly,\nSoft as a whisper.\n\nThey dance in the blue,\nSo high.";
    expect(toLyricText(poem)).toBe(poem);
  });

  it("collapses runs of blank lines to a single paragraph break", () => {
    expect(toLyricText("One.\n\n\n\n\nTwo.")).toBe("One.\n\nTwo.");
  });

  it("drops emphasis, headings and link markup but keeps the words", () => {
    expect(toLyricText("## Title\n\nSome **bold** and *soft* words, see [the docs](https://x.y).")).toBe(
      "Title\n\nSome bold and soft words, see the docs.",
    );
  });

  it("turns list items of every marker into bullets, one per line", () => {
    expect(toLyricText("Shopping:\n- milk\n* eggs\n+ bread")).toBe("Shopping:\n• milk\n• eggs\n• bread");
  });

  it("doesn't mistake a list of * bullets for italics", () => {
    expect(toLyricText("* one\n* two")).toBe("• one\n• two");
  });

  it("strips blockquote markers without eating the blank line before them", () => {
    expect(toLyricText("Before.\n\n> quoted line")).toBe("Before.\n\nquoted line");
  });

  it("replaces code blocks and inline code with the [code] marker", () => {
    expect(toLyricText("Run `npm test` or:\n\n```sh\nnpm run build\n```")).toBe("Run [code] or:\n\n[code]");
  });

  it("trims stray spaces at line ends and around the text", () => {
    expect(toLyricText("  hello   \n   world  ")).toBe("hello\nworld");
  });
});
