import { useEffect, useRef } from "react";
import type { VoiceStatus } from "./hooks/useVoiceConversation";
import {
  EYE_X,
  EYE_Y,
  FACES,
  GRID,
  MID,
  MOUTH_Y,
  browValue,
  clamp01,
  eyeValue,
  madFace,
  mixHex,
  mouthValue,
  smoothstep,
  type Face,
} from "./voiceFace";

// Voice mode's centrepiece: a 17x17 grid of glowing dots in the theme's colour, showing a simple
// face. The unlit dots stay faintly visible, and every dot eases its brightness rather than
// snapping, so expressions melt into each other and leave a soft afterglow.
//   idle        relaxed eyes, a small smile, a blink every few seconds
//   listening   eyes open wide, and a faint ripple runs along the bottom with the user's voice
//   processing  eyes glance up and aside, a flat "hmm" mouth, a dot circling the edge
//   speaking    happy ^ ^ eyes, the mouth opening on every spoken word
//   paused      eyes closed, resting and a little dimmer; the mic is let go
// Tapping makes it squint. Keep tapping and it gets a little cross: brows down, narrowed eyes, a
// frown, a shake on each tap and a reddish tinge, until it's left alone for a couple of seconds.
// The face is drawn from shapes (see voiceFace.ts) turned into dots each frame, so any
// in-between expression comes for free. Halloween swaps in triangle eyes and a jagged grin.

// Taps add up and drain away; past a few in quick succession it gets cross
const ANNOY_PER_TAP = 1;
const ANNOY_DRAIN_PER_S = 0.7;
const MAD_FROM = 2;
const MAD_FULL = 3.5;
const MAD_TINT = "#ff5a4a";
// Voices that don't report word boundaries still talk, at an easy rhythm
const FALLBACK_AFTER_MS = 450;
const FALLBACK_EVERY_MS = 280;

export function VoiceMatrix({
  status,
  onWord,
  onTap,
}: {
  status: VoiceStatus;
  onWord: (listener: () => void) => () => void;
  onTap?: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const statusRef = useRef(status);
  const wordRef = useRef(0); // time of the last word, for the mouth and the fallback rhythm
  const mouthKickRef = useRef(0);
  const squintUntilRef = useRef(0);
  const annoyRef = useRef(0);
  const shakeUntilRef = useRef(0);
  const analyserRef = useRef<AnalyserNode | null>(null);
  // The mic is open only while voice mode may be listening, never while paused
  const micWanted = status !== "paused";

  useEffect(() => {
    statusRef.current = status;
    wordRef.current = performance.now();
  }, [status]);

  useEffect(
    () =>
      onWord(() => {
        wordRef.current = performance.now();
        mouthKickRef.current = 0.55 + Math.random() * 0.45;
      }),
    [onWord],
  );

  // The mic level, for the listening ripple. Read from the mic directly, since speech recognition
  // doesn't report loudness; if it isn't allowed, the face just listens without the ripple.
  useEffect(() => {
    if (!micWanted || !navigator.mediaDevices?.getUserMedia) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let cancelled = false;
    let stream: MediaStream | null = null;
    let audioCtx: AudioContext | null = null;
    navigator.mediaDevices
      .getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      .then((s) => {
        if (cancelled) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        audioCtx = new AudioContext();
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 512;
        audioCtx.createMediaStreamSource(s).connect(analyser);
        analyserRef.current = analyser;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      analyserRef.current = null;
      (stream as MediaStream | null)?.getTracks().forEach((t) => t.stop());
      void (audioCtx as AudioContext | null)?.close();
    };
  }, [micWanted]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const fit = () => {
      const dpr = window.devicePixelRatio || 1;
      const { width } = canvas.getBoundingClientRect();
      canvas.width = canvas.height = Math.round(width * dpr);
    };
    fit();
    const resize = new ResizeObserver(fit);
    resize.observe(canvas);

    // The theme's colours, read from CSS; checked now and then in case the theme changes
    let colour = "#d9d9de";
    let highlight = "#ffffff";
    const readColours = () => {
      const css = getComputedStyle(canvas);
      colour = css.getPropertyValue("--voice-dot").trim() || colour;
      highlight = css.getPropertyValue("--voice-dot-hi").trim() || highlight;
    };
    readColours();

    let level = 0;
    const samples = new Float32Array(512);
    const face: Face = { ...FACES[statusRef.current] };
    let mad = 0;
    const lit = new Float32Array(GRID * GRID);
    let mouthOpen = 0;
    let mouthTarget = 0;
    let nextBlink = performance.now() + 2500;
    let lastFallback = 0;
    let last = performance.now();
    let frameCount = 0;
    let frame = 0;

    const step = (now: number) => {
      const dt = Math.min((now - last) / 1000, 1 / 30);
      last = now;
      const t = now / 1000;
      const s = statusRef.current;
      const pumpkin = document.documentElement.dataset.festive === "halloween";
      if (++frameCount % 30 === 0) readColours();

      // Glide the features toward this state's face
      const target = FACES[s];
      const glide = 1 - Math.exp(-dt * 7);
      for (const key of Object.keys(face) as (keyof Face)[]) {
        face[key] += (target[key] - face[key]) * glide;
      }

      // Cross from too much tapping: annoyance drains away, and the mood follows it
      annoyRef.current = Math.max(0, annoyRef.current - ANNOY_DRAIN_PER_S * dt);
      const madTarget = smoothstep(MAD_FROM, MAD_FULL, annoyRef.current);
      mad += (madTarget - mad) * (1 - Math.exp(-dt * (madTarget > mad ? 10 : 2.5)));
      const shown = madFace(face, mad);
      const shake =
        !reduced && now < shakeUntilRef.current
          ? Math.sin(t * 60) * 0.4 * ((shakeUntilRef.current - now) / 300)
          : 0;

      // Blinks (not while smiling ^ ^), and a squint when tapped
      let eyeOpen = 1;
      if (now > nextBlink) {
        if (now - nextBlink < 150) eyeOpen = 0.12;
        else nextBlink = now + 2500 + Math.random() * 3500;
      }
      if (now < squintUntilRef.current) eyeOpen = Math.min(eyeOpen, 0.35);
      if (s === "paused") eyeOpen = 0.12;
      eyeOpen = 1 - (1 - eyeOpen) * (1 - shown.happy);

      // The mouth: each word opens it, then it falls closed again
      if (s === "speaking") {
        if (mouthKickRef.current) {
          mouthTarget = Math.max(mouthTarget, mouthKickRef.current);
          mouthKickRef.current = 0;
        } else if (
          now - wordRef.current > FALLBACK_AFTER_MS &&
          now - lastFallback > FALLBACK_EVERY_MS
        ) {
          lastFallback = now;
          mouthTarget = 0.45 + Math.random() * 0.45;
        }
      } else {
        mouthKickRef.current = 0;
      }
      mouthTarget *= Math.exp(-dt / 0.12);
      mouthOpen += (mouthTarget - mouthOpen) * (1 - Math.exp(-dt * 30));
      if (reduced) mouthOpen = s === "speaking" ? 0.3 : 0;

      // Loudness while listening
      let raw = 0;
      const analyser = analyserRef.current;
      if (analyser && s === "listening") {
        analyser.getFloatTimeDomainData(samples);
        let sum = 0;
        for (const v of samples) sum += v * v;
        raw = Math.min(1, Math.sqrt(sum / samples.length) * 7);
      }
      level += (raw - level) * (raw > level ? 0.5 : 0.1);

      const bob = reduced ? 0 : 0.3 * Math.sin(t * 1.5);
      const scanAngle = t * 2.4;

      for (let y = 0; y < GRID; y++) {
        for (let x = 0; x < GRID; x++) {
          const fx = x - shake;
          let v = Math.max(
            eyeValue(fx, y, MID - EYE_X, EYE_Y + bob, shown, eyeOpen, pumpkin),
            eyeValue(fx, y, MID + EYE_X, EYE_Y + bob, shown, eyeOpen, pumpkin),
            mouthValue(fx, y, MOUTH_Y + bob, shown, mouthOpen * (1 - 0.6 * mad), pumpkin),
          );
          if (mad > 0.02) {
            v = Math.max(
              v,
              mad * browValue(fx, y, MID - EYE_X, EYE_Y + bob, 1),
              mad * browValue(fx, y, MID + EYE_X, EYE_Y + bob, -1),
            );
          }
          // Thinking: a dot travels round the edge, its trail left by the afterglow
          if (s === "processing" && !reduced) {
            const sx = MID + 7.6 * Math.cos(scanAngle);
            const sy = MID + 7.6 * Math.sin(scanAngle);
            v = Math.max(v, clamp01(1 - Math.hypot(x - sx, y - sy) * 0.9));
          }
          // Listening: a faint ripple along the bottom rows, with the voice
          if (y >= GRID - 2 && level > 0.02) {
            const wave = 0.5 + 0.5 * Math.sin(x * 0.8 - t * 6);
            v = Math.max(v, level * 0.75 * wave * (y === GRID - 1 ? 1 : 0.55));
          }
          if (s === "paused") v *= 0.6;
          const i = y * GRID + x;
          lit[i] += (v - lit[i]) * (v > lit[i] ? 0.45 : 0.14);
        }
      }

      // Draw: every dot faintly, lit ones larger and brighter with a lighter core
      const size = canvas.width;
      const pitch = size / GRID;
      ctx.clearRect(0, 0, size, size);
      const dotColour = mixHex(colour, MAD_TINT, 0.55 * mad);
      for (let y = 0; y < GRID; y++) {
        for (let x = 0; x < GRID; x++) {
          const b = lit[y * GRID + x];
          const cx = (x + 0.5) * pitch;
          const cy = (y + 0.5) * pitch;
          ctx.globalAlpha = 0.09 + 0.91 * b;
          ctx.fillStyle = dotColour;
          ctx.beginPath();
          ctx.arc(cx, cy, pitch * (0.29 + 0.07 * b), 0, Math.PI * 2);
          ctx.fill();
          if (b > 0.5) {
            ctx.globalAlpha = (b - 0.5) * 1.6;
            ctx.fillStyle = highlight;
            ctx.beginPath();
            ctx.arc(cx, cy, pitch * 0.15, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
      ctx.globalAlpha = 1;
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);

    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
    };
  }, []);

  return (
    <button
      type="button"
      className={`voice-matrix voice-matrix--${status}`}
      onPointerDown={() => {
        const now = performance.now();
        squintUntilRef.current = now + 350;
        annoyRef.current += ANNOY_PER_TAP;
        // Once it's cross, each further tap gets a shake of the head
        if (annoyRef.current > MAD_FROM) shakeUntilRef.current = now + 300;
      }}
      // A tap shouldn't take focus, so Space keeps pausing instead of pressing the face
      onMouseDown={(e) => e.preventDefault()}
      onClick={onTap}
      aria-label={status === "speaking" ? "Interrupt" : "Voice"}
      tabIndex={status === "speaking" ? 0 : -1}
    >
      <canvas ref={canvasRef} aria-hidden="true" />
    </button>
  );
}
