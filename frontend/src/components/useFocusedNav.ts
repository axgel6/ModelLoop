import { useEffect, useState, type RefObject } from "react";
import { speakWithChosenVoice } from "./speechVoice";

// Keyboard focus for focused mode: step through the conversation one message (or, with Alt, one
// paragraph) at a time. The focused message takes the large, full-strength place and its
// neighbours step down by distance from it. Following the latest message is the resting state;
// Escape or typing returns to it.

export type FocusLine = { role: "user" | "assistant"; text: string };

export const splitParas = (text: string) => text.split(/\n{2,}/);

// Room the floating input takes at the bottom; centring happens in the space above it
const INPUT_ROOM = 110;
// Font sizes ease over 0.4s when the focus moves, so the position is settled again after that
const SETTLE_MS = 450;

export function useFocusedNav({
  active,
  lines,
  scrollRef,
  textareaRef,
  inputEmpty,
}: {
  active: boolean;
  lines: FocusLine[];
  scrollRef: RefObject<HTMLDivElement | null>;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  inputEmpty: boolean;
}) {
  const [focus, setFocus] = useState<number | null>(null); // null: following the latest
  const [para, setPara] = useState<number | null>(null);
  const [speaking, setSpeaking] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [seenSig, setSeenSig] = useState("");

  // Leaving focused mode drops back to the resting state
  if (!active && (focus !== null || para !== null || speaking !== null)) {
    setFocus(null);
    setPara(null);
    setSpeaking(null);
  }

  const latest = lines.length - 1;
  const current = focus === null ? latest : Math.min(focus, latest);
  const navigating = focus !== null;
  // Something new arrived (a message, or more of the streaming reply) since navigating began
  const sig = `${lines.length}:${lines[latest]?.text.length ?? 0}`;
  const hasNew = navigating && sig !== seenSig;

  const showToast = (text: string) => {
    setToast(text);
    window.setTimeout(() => setToast((t) => (t === text ? null : t)), 1600);
  };

  const backToLatest = () => {
    setFocus(null);
    setPara(null);
  };

  const focusOn = (index: number, paragraph: number | null) => {
    if (focus === null) setSeenSig(sig);
    setFocus(index);
    setPara(paragraph);
  };

  // Moving onto the latest message as a whole is the same as following it again
  const goTo = (index: number, paragraph: number | null = null) => {
    const i = Math.max(0, Math.min(index, latest));
    if (i === latest && paragraph === null) return backToLatest();
    focusOn(i, paragraph);
  };

  const stepMessage = (dir: -1 | 1) => {
    const next = current + dir;
    if (next < 0) return;
    goTo(next);
  };

  // Alt+arrows walk paragraph by paragraph, carrying on into the next message at either end
  const stepParagraph = (dir: -1 | 1) => {
    const count = splitParas(lines[current]?.text ?? "").length;
    if (count > 1) {
      const p = para === null ? (dir < 0 ? count - 1 : 0) : para + dir;
      if (p >= 0 && p < count) return focusOn(current, p);
    }
    const next = current + dir;
    if (next < 0 || next > latest) return;
    const nextCount = splitParas(lines[next].text).length;
    focusOn(next, nextCount > 1 ? (dir < 0 ? nextCount - 1 : 0) : null);
  };

  const focusedText = () => {
    const text = lines[current]?.text ?? "";
    return para === null ? text : (splitParas(text)[para] ?? text);
  };

  const copyFocused = () => {
    void navigator.clipboard.writeText(focusedText().replaceAll("[code]", "{ }"));
    showToast("Copied");
  };

  const stopSpeaking = () => {
    window.speechSynthesis.cancel();
    setSpeaking(null);
  };

  const toggleSpeak = () => {
    if (speaking !== null) return stopSpeaking();
    const text = focusedText().replaceAll("[code]", "code").trim();
    if (!text) return;
    speakWithChosenVoice(text, {
      rate: parseFloat(localStorage.getItem("voice_speech_rate") || "1.0"),
      onEnd: () => setSpeaking(null),
    });
    setSpeaking(current);
    showToast("Reading aloud · Space to stop");
  };

  // Stop reading aloud when focused mode closes
  useEffect(() => {
    if (!active) window.speechSynthesis.cancel();
  }, [active]);

  // Keep the focused message (or paragraph) centred in the space above the input
  useEffect(() => {
    if (!active) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const behavior: ScrollBehavior = reduced ? "auto" : "smooth";
    const place = () => {
      const box = scrollRef.current;
      if (!box) return;
      if (focus === null) return box.scrollTo({ top: box.scrollHeight, behavior });
      const target = box.querySelector<HTMLElement>(
        para === null
          ? `[data-line="${focus}"]`
          : `[data-line="${focus}"] [data-para="${para}"]`,
      );
      if (!target) return;
      const boxRect = box.getBoundingClientRect();
      const rect = target.getBoundingClientRect();
      const room = boxRect.height - INPUT_ROOM;
      const offset =
        rect.height > room * 0.7 ? room * 0.3 : (room - rect.height) / 2;
      box.scrollTo({ top: box.scrollTop + rect.top - boxRect.top - offset, behavior });
    };
    const frame = requestAnimationFrame(place);
    const settle = window.setTimeout(place, SETTLE_MS);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(settle);
    };
  }, [active, focus, para, scrollRef]);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      // The reading settings menu handles its own keys while open
      if (document.querySelector(".reader-menu")) return;
      const textarea = textareaRef.current;
      const inField = e.target === textarea;
      const plain = !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey;

      if (e.key === "Escape") {
        if (speaking !== null) stopSpeaking();
        if (navigating || para !== null) {
          e.preventDefault();
          backToLatest();
        }
        return;
      }

      if ((e.key === "ArrowUp" || e.key === "ArrowDown") && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
        // While there's something typed, the arrows move the caret as usual
        if (inField && !inputEmpty) return;
        e.preventDefault();
        const dir = e.key === "ArrowUp" ? -1 : 1;
        if (e.altKey) stepParagraph(dir);
        else stepMessage(dir);
        return;
      }

      if (e.key === " " && plain && inputEmpty && (inField || e.target === document.body)) {
        e.preventDefault();
        toggleSpeak();
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "c" && navigating) {
        // A real selection, on the page or in the field, copies as normal
        if (window.getSelection()?.toString()) return;
        if (textarea && inField && textarea.selectionStart !== textarea.selectionEnd) return;
        e.preventDefault();
        copyFocused();
        return;
      }

      // Typing goes back to the latest message and into the field
      if (navigating && e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
        backToLatest();
        if (!inField) textarea?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return {
    current,
    para,
    navigating,
    hasNew,
    speaking,
    toast,
    goTo,
    backToLatest,
  };
}
