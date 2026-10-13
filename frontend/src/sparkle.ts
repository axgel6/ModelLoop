// A small pixel burst where the user clicks empty space, with a quiet blip.
// Purely decorative: it never intercepts the click (see .sparkle in App.css).

import { sounds } from "./sounds";

// Anything that does something, holds text worth selecting, or closes a layer
// when clicked is not "empty space".
const NOT_EMPTY = [
  "button", "a", "input", "textarea", "select", "label", "summary", "pre", "code", "img", "svg",
  "[role='button']", "[role='switch']", "[contenteditable='true']", "[onclick]",
  ".message", ".msg-meta", ".sidebar-chat-item", ".sidebar-footer-wrapper", ".input-wrapper",
  ".pref-modal", ".login-card", ".tools-dropdown-menu", ".slash-dropdown", ".spotlight-box",
  "[class*='overlay']", "[class*='backdrop']", "[class*='dismiss']",
].join(",");

// Eight directions for the burst: [x, y, shape]. Up/down/left/right are short
// lines, the diagonals single pixels, like a hit spark in an 8-bit game.
const BITS: [number, number, "h" | "v" | "dot"][] = [
  [1, 0, "h"], [-1, 0, "h"], [0, 1, "v"], [0, -1, "v"],
  [0.75, 0.75, "dot"], [-0.75, 0.75, "dot"], [0.75, -0.75, "dot"], [-0.75, -0.75, "dot"],
];

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

// True when the click landed on text inside the element, not the space around it.
function onText(target: Element, x: number, y: number): boolean {
  const range = document.createRange();
  for (const node of target.childNodes) {
    if (node.nodeType !== Node.TEXT_NODE || !node.textContent?.trim()) continue;
    range.selectNodeContents(node);
    for (const r of range.getClientRects()) {
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return true;
    }
  }
  return false;
}

export function isEmptySpaceClick(e: MouseEvent): boolean {
  const target = e.target;
  if (!(target instanceof Element)) return false;
  if (target.closest(NOT_EMPTY)) return false;
  if (window.getSelection()?.toString()) return false; // finishing a text selection
  return !onText(target, e.clientX, e.clientY);
}

export function sparkleAt(x: number, y: number) {
  sounds.play("sparkle");
  if (reducedMotion.matches) return;

  const root = document.createElement("div");
  root.className = "sparkle";
  root.style.left = `${Math.round(x)}px`;
  root.style.top = `${Math.round(y)}px`;
  for (const [dx, dy, shape] of BITS) {
    const bit = document.createElement("span");
    bit.className = `sparkle-bit sparkle-bit--${shape}`;
    bit.style.setProperty("--dx", String(dx));
    bit.style.setProperty("--dy", String(dy));
    root.append(bit);
  }
  document.body.append(root);
  setTimeout(() => root.remove(), 500);
}
