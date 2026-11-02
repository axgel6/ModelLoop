import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { splitParas, useFocusedNav, type FocusLine } from "./useFocusedNav";
import { installFakeSpeech } from "../test/speech";

const LINES: FocusLine[] = [
  { role: "user", text: "hello" },
  { role: "assistant", text: "Hi! How can I help?" },
  { role: "user", text: "a poem please" },
  { role: "assistant", text: "First stanza.\n\nSecond stanza.\n\nThird stanza." },
  { role: "user", text: "thanks" },
  // Lines arrive as focused mode shows them (see toLyricText), so code is already a [code] marker
  { role: "assistant", text: "Any time! Here's [code] too." },
];

let textarea: HTMLTextAreaElement;
let scroller: HTMLDivElement;

function setup(lines = LINES, { inputEmpty = true, active = true } = {}) {
  const scrollRef = { current: scroller };
  const textareaRef = { current: textarea };
  return renderHook(
    (props: { lines: FocusLine[]; inputEmpty: boolean; active: boolean }) =>
      useFocusedNav({ ...props, scrollRef, textareaRef }),
    { initialProps: { lines, inputEmpty, active } },
  );
}

const press = (key: string, init: KeyboardEventInit = {}, target: EventTarget = textarea) => {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
};

beforeEach(() => {
  vi.useFakeTimers();
  window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as unknown as typeof window.matchMedia;
  scroller = document.createElement("div");
  scroller.scrollTo = vi.fn();
  textarea = document.createElement("textarea");
  document.body.append(scroller, textarea);
  installFakeSpeech([]);
});
afterEach(() => {
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useFocusedNav", () => {
  it("rests on the latest message", () => {
    const { result } = setup();
    expect(result.current.current).toBe(LINES.length - 1);
    expect(result.current.navigating).toBe(false);
  });

  it("steps back and forward one message at a time with the arrows", () => {
    const { result } = setup();
    expect(press("ArrowUp").defaultPrevented).toBe(true);
    press("ArrowUp");
    expect(result.current.current).toBe(3);
    expect(result.current.navigating).toBe(true);
    press("ArrowDown");
    press("ArrowDown");
    // Back on the latest: following it again, not stuck "navigating" there
    expect(result.current.current).toBe(5);
    expect(result.current.navigating).toBe(false);
  });

  it("stops at the first message", () => {
    const { result } = setup();
    for (let i = 0; i < 10; i++) press("ArrowUp");
    expect(result.current.current).toBe(0);
  });

  it("leaves the arrows to the caret while there's something typed", () => {
    const { result } = setup(LINES, { inputEmpty: false });
    expect(press("ArrowUp").defaultPrevented).toBe(false);
    expect(result.current.navigating).toBe(false);
  });

  it("returns to the latest on Escape", () => {
    const { result } = setup();
    press("ArrowUp");
    press("ArrowUp");
    press("Escape");
    expect(result.current.navigating).toBe(false);
    expect(result.current.current).toBe(5);
  });

  it("returns to the latest when the user starts typing, and puts them in the field", () => {
    const { result } = setup();
    press("ArrowUp");
    press("h", {}, document.body);
    expect(result.current.navigating).toBe(false);
    expect(document.activeElement).toBe(textarea);
  });

  it("walks paragraph by paragraph with Alt, carrying on into the next message", () => {
    const { result } = setup();
    press("ArrowUp");
    press("ArrowUp"); // the poem
    press("ArrowDown", { altKey: true });
    expect(result.current.para).toBe(0);
    press("ArrowDown", { altKey: true });
    press("ArrowDown", { altKey: true });
    expect(result.current.para).toBe(2);
    press("ArrowDown", { altKey: true }); // past the end: into "thanks", a single paragraph
    expect(result.current.current).toBe(4);
    expect(result.current.para).toBeNull();
    press("ArrowUp", { altKey: true }); // back into the poem's last stanza
    expect(result.current.current).toBe(3);
    expect(result.current.para).toBe(2);
  });

  it("starts paragraph stepping from the end when going up", () => {
    const { result } = setup(LINES.slice(0, 4)); // the poem is the latest
    press("ArrowUp", { altKey: true });
    expect(result.current.current).toBe(3);
    expect(result.current.para).toBe(2);
    expect(result.current.navigating).toBe(true);
  });

  it("jumps to a clicked message, and treats the latest as following again", () => {
    const { result } = setup();
    act(() => result.current.goTo(1));
    expect(result.current.current).toBe(1);
    act(() => result.current.goTo(5));
    expect(result.current.navigating).toBe(false);
  });

  it("notices new content that arrives while the user is reading back", () => {
    const { result, rerender } = setup();
    press("ArrowUp");
    expect(result.current.hasNew).toBe(false);
    rerender({ lines: [...LINES, { role: "user", text: "more" }], inputEmpty: true, active: true });
    expect(result.current.hasNew).toBe(true);
    expect(result.current.current).toBe(4); // the focus didn't move
  });

  it("copies the focused message, with code markers made readable", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const { result } = setup();
    act(() => result.current.goTo(5, null));
    press("ArrowUp");
    press("ArrowDown", { altKey: true }); // focus the latest itself, as a whole message
    press("c", { metaKey: true });
    expect(writeText).toHaveBeenCalledWith("Any time! Here's { } too.");
    expect(result.current.toast).toBe("Copied");
    act(() => vi.advanceTimersByTime(2000));
    expect(result.current.toast).toBeNull();
  });

  it("leaves a real text selection to copy as normal", () => {
    const writeText = vi.fn();
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    vi.spyOn(window, "getSelection").mockReturnValue({ toString: () => "Hi!" } as Selection);
    setup();
    press("ArrowUp");
    expect(press("c", { metaKey: true }).defaultPrevented).toBe(false);
    expect(writeText).not.toHaveBeenCalled();
  });

  it("reads the focused message aloud on Space, and stops on a second Space", () => {
    const synth = installFakeSpeech([]);
    const { result } = setup();
    press("ArrowUp");
    press(" ");
    expect(result.current.speaking).toBe(4);
    act(() => vi.advanceTimersByTime(60));
    expect(synth.spoken.at(-1)?.text).toBe("thanks");
    press(" ");
    expect(result.current.speaking).toBeNull();
    expect(synth.cancel).toHaveBeenCalled();
  });

  it("lets the reading settings menu keep the keys while it's open", () => {
    const menu = document.createElement("div");
    menu.className = "reader-menu";
    document.body.append(menu);
    const { result } = setup();
    press("ArrowUp");
    expect(result.current.navigating).toBe(false);
  });

  it("drops back to resting when focused mode closes", () => {
    const { result, rerender } = setup();
    press("ArrowUp");
    rerender({ lines: LINES, inputEmpty: true, active: false });
    expect(result.current.navigating).toBe(false);
    expect(result.current.para).toBeNull();
  });

  it("keeps the focused message in view", () => {
    const line = document.createElement("p");
    line.dataset.line = "4";
    scroller.append(line);
    setup();
    press("ArrowUp");
    act(() => vi.advanceTimersByTime(500));
    expect(scroller.scrollTo).toHaveBeenCalled();
  });
});

describe("splitParas", () => {
  it("splits on blank lines but not single line breaks", () => {
    expect(splitParas("a\nb\n\nc\n\n\nd")).toEqual(["a\nb", "c", "d"]);
  });
});
