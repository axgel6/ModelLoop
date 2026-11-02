import type { VoiceStatus } from "./hooks/useVoiceConversation";

// The voice face's geometry: a 17x17 grid, the face each voice state wears, and the shapes
// (eyes, mouth, brows) as functions of a dot's position that say how brightly it's lit, 0 to 1.
// Soft edges give in-between dots part brightness, so features can move by fractions of a dot.

export const GRID = 17;
export const MID = (GRID - 1) / 2;
export const EYE_X = 3.5; // each eye's distance from the middle column
export const EYE_Y = 6.2;
export const MOUTH_Y = 11.3;

export type Face = {
  eyeRx: number;
  eyeRy: number;
  lookX: number;
  lookY: number;
  happy: number; // 0: round eyes, 1: ^ ^ arcs
  mouthW: number;
  smile: number;
  mouthX: number;
};

export const FACES: Record<VoiceStatus, Face> = {
  idle: { eyeRx: 1.4, eyeRy: 1.9, lookX: 0, lookY: 0, happy: 0, mouthW: 2.8, smile: 1.3, mouthX: 0 },
  listening: { eyeRx: 1.65, eyeRy: 2.3, lookX: 0, lookY: 0, happy: 0, mouthW: 2, smile: 0.9, mouthX: 0 },
  processing: { eyeRx: 1.35, eyeRy: 1.7, lookX: 0.9, lookY: -0.9, happy: 0, mouthW: 1.6, smile: 0, mouthX: 1.2 },
  speaking: { eyeRx: 1.5, eyeRy: 1.8, lookX: 0, lookY: 0, happy: 1, mouthW: 2.4, smile: 1.3, mouthX: 0 },
  paused: { eyeRx: 1.4, eyeRy: 1.9, lookX: 0, lookY: 0.4, happy: 0, mouthW: 1.6, smile: 0.4, mouthX: 0 },
};

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
// Mix two #rrggbb colours; anything else comes back unchanged
export function mixHex(a: string, b: string, k: number): string {
  const hex = /^#([0-9a-f]{6})$/i;
  const ma = hex.exec(a);
  const mb = hex.exec(b);
  if (!ma || !mb || k <= 0) return a;
  const pa = parseInt(ma[1], 16);
  const pb = parseInt(mb[1], 16);
  const ch = (shift: number) =>
    Math.round(((pa >> shift) & 255) * (1 - k) + ((pb >> shift) & 255) * k);
  return `rgb(${ch(16)}, ${ch(8)}, ${ch(0)})`;
}

// An angry brow over an eye: a short slanted line, lower at the inner end
export function browValue(x: number, y: number, cx: number, cy: number, inward: number): number {
  const ax = cx - inward * 1.8;
  const ay = cy - 3.4;
  const bx = cx + inward * 1.6;
  const by = cy - 1.7;
  const len2 = (bx - ax) ** 2 + (by - ay) ** 2;
  const k = clamp01(((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / len2);
  return clamp01(1.25 - Math.hypot(x - (ax + k * (bx - ax)), y - (ay + k * (by - ay))) * 1.3);
}

// Triangle wave in [-1, 1], for the jack-o'-lantern's teeth
const zigzag = (v: number) => 1 - 2 * Math.abs((((v % 2) + 2) % 2) - 1);

export function eyeValue(
  x: number, y: number, cx: number, cy: number, f: Face, open: number, pumpkin: boolean,
): number {
  const dx = x - (cx + f.lookX);
  const dy = y - (cy + f.lookY);
  const ry = Math.max(0.12, f.eyeRy * open);
  if (pumpkin) {
    // Triangle, point up
    if (Math.abs(dy) > ry + 0.5) return 0;
    const half = (f.eyeRx * 1.25 * (dy + ry)) / (2 * ry);
    return clamp01((half - Math.abs(dx)) * 2 + 0.5) * clamp01((ry - Math.abs(dy)) * 2 + 0.5);
  }
  const d = Math.hypot(dx / f.eyeRx, dy / ry);
  const round = clamp01((1.15 - d) * 2.2);
  // Happy: the top half of a ring, sitting a little low, like a smiling squint ^ ^
  const ad = Math.hypot(dx / (f.eyeRx * 1.2), (dy - 1) / (f.eyeRy * 1.15));
  const arc = dy - 1 < 0.3 ? clamp01(1 - Math.abs(ad - 1) * 2.2) : 0;
  return round * (1 - f.happy) + arc * f.happy;
}

export function mouthValue(x: number, y: number, my: number, f: Face, open: number, pumpkin: boolean): number {
  const dx = x - (MID + f.mouthX);
  const w = f.mouthW + (pumpkin ? 1.4 : 0);
  if (Math.abs(dx) > w + 0.8) return 0;
  const u = Math.max(-1, Math.min(1, dx / w));
  // Closed, it's a curve (corners up for a smile); open, it becomes an "o"
  let cy = my + f.smile * (1 - u * u) * (1 - open) + open * 0.5;
  if (pumpkin) cy += (1 - open) * 0.55 * zigzag(dx * 0.9);
  // At least one row thick, so a closed mouth never falls between rows and disappears
  const ry = 0.6 + open * 1.5;
  const dd = Math.hypot(dx / w, (y - cy) / ry);
  const fill = clamp01((1.1 - dd) * 2.5);
  const ring = clamp01(1 - Math.abs(dd - 1) * Math.min(w, ry) * 2.2);
  const k = smoothstep(0.25, 0.6, open);
  return fill * (1 - k) + ring * k;
}

/** The face, made a little cross by `mad` (0 to 1): narrowed eyes glaring straight ahead, no
 *  happy squint, and the smile turned into a frown */
export function madFace(face: Face, mad: number): Face {
  return {
    ...face,
    eyeRy: face.eyeRy * (1 - 0.4 * mad),
    lookX: face.lookX * (1 - mad),
    lookY: face.lookY * (1 - mad),
    happy: face.happy * (1 - mad),
    mouthW: face.mouthW + (2.4 - face.mouthW) * mad,
    smile: face.smile * (1 - mad) - 1.5 * mad,
  };
}
