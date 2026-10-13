// The ModelLoop wordmark as a piece of taffy: drag it and it stretches toward
// the pointer, let go and it wobbles back into shape. Purely for fun.

import { useEffect, useRef } from "react";
import { sounds } from "../sounds";

const STIFFNESS = 260;
const DAMPING = 9; // well under critical, so it overshoots a few times
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

// Rubber band: follows the pointer at first, then resists. Stretching tops out
// at 2.4x, squashing at 0.45x.
function band(pull: number): number {
  const limit = pull > 0 ? 1.4 : 0.55;
  return Math.sign(pull) * limit * (1 - Math.exp(-Math.abs(pull) / limit));
}

export function StretchyLogo({ text = "ModelLoop" }: { text?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const state = useRef({ sx: 1, sy: 1, vx: 0, vy: 0, raf: 0 });
  // Where the drag began, and which corner stays pinned (the one opposite the grab).
  const grab = useRef<{
    x: number; y: number; w: number; h: number; dirX: number; dirY: number;
  } | null>(null);

  useEffect(() => {
    const s = state.current;
    return () => cancelAnimationFrame(s.raf);
  }, []);

  const draw = () => {
    const el = ref.current;
    if (!el) return;
    const { sx, sy } = state.current;
    // Stretching one way thins it slightly the other way, like something soft.
    el.style.transform = `scale(${sx / sy ** 0.25}, ${sy / sx ** 0.25})`;
  };

  const rest = () => {
    const el = ref.current;
    Object.assign(state.current, { sx: 1, sy: 1, vx: 0, vy: 0 });
    if (el) el.style.transform = "";
  };

  const spring = () => {
    const s = state.current;
    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(0.032, (now - last) / 1000);
      last = now;
      s.vx += (-STIFFNESS * (s.sx - 1) - DAMPING * s.vx) * dt;
      s.vy += (-STIFFNESS * (s.sy - 1) - DAMPING * s.vy) * dt;
      s.sx += s.vx * dt;
      s.sy += s.vy * dt;
      const settled =
        Math.abs(s.sx - 1) + Math.abs(s.sy - 1) < 0.004 &&
        Math.abs(s.vx) + Math.abs(s.vy) < 0.04;
      if (settled) return rest();
      draw();
      s.raf = requestAnimationFrame(step);
    };
    s.raf = requestAnimationFrame(step);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLSpanElement>) => {
    const el = ref.current;
    if (!el || (e.pointerType === "mouse" && e.button !== 0)) return;
    cancelAnimationFrame(state.current.raf);
    rest();
    const r = el.getBoundingClientRect();
    const right = e.clientX > r.left + r.width / 2;
    const bottom = e.clientY > r.top + r.height / 2;
    grab.current = {
      x: e.clientX, y: e.clientY, w: r.width, h: Math.max(r.height, 48),
      dirX: right ? 1 : -1, dirY: bottom ? 1 : -1,
    };
    el.style.transformOrigin = `${right ? "left" : "right"} ${bottom ? "top" : "bottom"}`;
    el.classList.add("is-held");
    el.setPointerCapture(e.pointerId);
    e.preventDefault(); // no text selection or native drag
  };

  const onPointerMove = (e: React.PointerEvent<HTMLSpanElement>) => {
    const g = grab.current;
    if (!g) return;
    state.current.sx = 1 + band(((e.clientX - g.x) * g.dirX) / g.w);
    state.current.sy = 1 + band(((e.clientY - g.y) * g.dirY) / g.h);
    draw();
  };

  const onPointerUp = () => {
    if (!grab.current) return;
    grab.current = null;
    ref.current?.classList.remove("is-held");
    const { sx, sy } = state.current;
    if (Math.abs(sx - 1) + Math.abs(sy - 1) > 0.15) sounds.play("pop");
    if (reducedMotion.matches) rest();
    else spring();
  };

  return (
    <span
      ref={ref}
      className="stretchy-logo"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {text}
    </span>
  );
}
