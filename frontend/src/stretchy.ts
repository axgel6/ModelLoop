// Taffy physics for the wordmark and the round glass buttons: drag one and it
// stretches toward the pointer, let go and it wobbles back into shape. Purely
// for fun. One set of document listeners handles every matching element, so
// nothing has to be wired up where the elements are rendered.

import { sounds } from "./sounds";

const STRETCHY =
  ".stretchy-logo, .chat-topbar .topbar-icon-btn, .sidebar-brand-btn";

const STIFFNESS = 260;
const DAMPING = 9; // well under critical, so it overshoots a few times
// Past this much stretch, letting go pops and does not count as a click.
const PLAYED_WITH = 0.15;
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

type Body = { sx: number; sy: number; vx: number; vy: number; raf: number };
const bodies = new WeakMap<HTMLElement, Body>();

// The drag in progress: where it began, and which way counts as stretching
// (away from the corner opposite the grab, which stays pinned).
let held: {
  el: HTMLElement; x: number; y: number; w: number; h: number; dirX: number; dirY: number;
} | null = null;
let swallowClickOn: HTMLElement | null = null;

// Rubber band: follows the pointer at first, then resists. Stretching tops out
// at 2.4x, squashing at 0.45x.
function band(pull: number): number {
  const limit = pull > 0 ? 1.4 : 0.55;
  return Math.sign(pull) * limit * (1 - Math.exp(-Math.abs(pull) / limit));
}

function bodyOf(el: HTMLElement): Body {
  let body = bodies.get(el);
  if (!body) bodies.set(el, (body = { sx: 1, sy: 1, vx: 0, vy: 0, raf: 0 }));
  return body;
}

function draw(el: HTMLElement, { sx, sy }: Body) {
  // Stretching one way thins it slightly the other way, like something soft.
  el.style.transform = `scale(${sx / sy ** 0.25}, ${sy / sx ** 0.25})`;
}

function rest(el: HTMLElement, body: Body) {
  cancelAnimationFrame(body.raf);
  Object.assign(body, { sx: 1, sy: 1, vx: 0, vy: 0 });
  el.style.transform = "";
  el.style.transition = "";
  el.style.transformOrigin = "";
}

function spring(el: HTMLElement, body: Body) {
  let last = performance.now();
  const step = (now: number) => {
    if (!el.isConnected) return;
    const dt = Math.min(0.032, (now - last) / 1000);
    last = now;
    body.vx += (-STIFFNESS * (body.sx - 1) - DAMPING * body.vx) * dt;
    body.vy += (-STIFFNESS * (body.sy - 1) - DAMPING * body.vy) * dt;
    body.sx += body.vx * dt;
    body.sy += body.vy * dt;
    const settled =
      Math.abs(body.sx - 1) + Math.abs(body.sy - 1) < 0.004 &&
      Math.abs(body.vx) + Math.abs(body.vy) < 0.04;
    if (settled) return rest(el, body);
    draw(el, body);
    body.raf = requestAnimationFrame(step);
  };
  body.raf = requestAnimationFrame(step);
}

function onPointerDown(e: PointerEvent) {
  if (e.pointerType === "mouse" && e.button !== 0) return;
  const el = (e.target as Element | null)?.closest?.<HTMLElement>(STRETCHY);
  if (!el || el.matches(":disabled")) return;

  const body = bodyOf(el);
  rest(el, body);
  const r = el.getBoundingClientRect();
  const right = e.clientX > r.left + r.width / 2;
  const bottom = e.clientY > r.top + r.height / 2;
  held = {
    el, x: e.clientX, y: e.clientY,
    // A floor on the size keeps small buttons from stretching too eagerly.
    w: Math.max(r.width, 48), h: Math.max(r.height, 48),
    dirX: right ? 1 : -1, dirY: bottom ? 1 : -1,
  };
  swallowClickOn = null;
  el.style.transformOrigin = `${right ? "left" : "right"} ${bottom ? "top" : "bottom"}`;
  // The element's own eased transitions would make it trail behind the pointer.
  el.style.transition = "none";
  el.classList.add("is-held");
  // Dragging past the element would otherwise select whatever text is nearby.
  document.documentElement.classList.add("stretchy-dragging");
  el.setPointerCapture(e.pointerId);
}

function onPointerMove(e: PointerEvent) {
  if (!held) return;
  const body = bodyOf(held.el);
  body.sx = 1 + band(((e.clientX - held.x) * held.dirX) / held.w);
  body.sy = 1 + band(((e.clientY - held.y) * held.dirY) / held.h);
  draw(held.el, body);
}

function onPointerUp() {
  if (!held) return;
  const { el } = held;
  held = null;
  el.classList.remove("is-held");
  document.documentElement.classList.remove("stretchy-dragging");
  const body = bodyOf(el);
  if (Math.abs(body.sx - 1) + Math.abs(body.sy - 1) > PLAYED_WITH) {
    sounds.play("pop");
    // The click that follows this release was a stretch, not a press.
    swallowClickOn = el;
    setTimeout(() => (swallowClickOn = null), 0);
  }
  if (reducedMotion.matches) rest(el, body);
  else spring(el, body);
}

function onClick(e: MouseEvent) {
  if (!swallowClickOn?.contains(e.target as Node)) return;
  swallowClickOn = null;
  e.stopPropagation();
  e.preventDefault();
}

export function initStretchy() {
  document.addEventListener("pointerdown", onPointerDown);
  document.addEventListener("pointermove", onPointerMove);
  document.addEventListener("pointerup", onPointerUp);
  document.addEventListener("pointercancel", onPointerUp);
  // Capture phase, so it runs before the button's own click handler.
  document.addEventListener("click", onClick, true);
}
