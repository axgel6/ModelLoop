import { describe, expect, it } from "vitest";
import {
  EYE_X,
  EYE_Y,
  FACES,
  GRID,
  MID,
  MOUTH_Y,
  browValue,
  eyeValue,
  madFace,
  mixHex,
  mouthValue,
} from "./voiceFace";

const LEFT_EYE = MID - EYE_X;
const idle = FACES.idle;

describe("FACES", () => {
  it("has a face for every voice state", () => {
    expect(Object.keys(FACES).sort()).toEqual(["idle", "listening", "paused", "processing", "speaking"]);
  });

  it("keeps every feature inside the grid", () => {
    expect(LEFT_EYE - idle.eyeRx).toBeGreaterThan(0);
    expect(MID + EYE_X + idle.eyeRx).toBeLessThan(GRID - 1);
    expect(MOUTH_Y + 2).toBeLessThan(GRID - 1);
  });
});

describe("eyeValue", () => {
  it("is fully lit at the eye's centre and dark well outside it", () => {
    expect(eyeValue(LEFT_EYE, EYE_Y, LEFT_EYE, EYE_Y, idle, 1, false)).toBe(1);
    expect(eyeValue(LEFT_EYE + 4, EYE_Y, LEFT_EYE, EYE_Y, idle, 1, false)).toBe(0);
  });

  it("closes to a thin line when blinking", () => {
    const above = (open: number) => eyeValue(LEFT_EYE, EYE_Y - 1.5, LEFT_EYE, EYE_Y, idle, open, false);
    expect(above(1)).toBeGreaterThan(0.5);
    expect(above(0.12)).toBe(0);
  });

  it("follows where the face is looking", () => {
    const glance = { ...idle, lookX: 1 };
    expect(eyeValue(LEFT_EYE + 1, EYE_Y, LEFT_EYE, EYE_Y, glance, 1, false)).toBe(1);
  });

  it("draws happy eyes as an arch: lit above the middle, dark below it", () => {
    const happy = { ...idle, happy: 1 };
    const centre = eyeValue(LEFT_EYE, EYE_Y, LEFT_EYE, EYE_Y, happy, 1, false);
    const top = eyeValue(LEFT_EYE, EYE_Y + 1 - happy.eyeRy * 1.15, LEFT_EYE, EYE_Y, happy, 1, false);
    const below = eyeValue(LEFT_EYE, EYE_Y + 2.5, LEFT_EYE, EYE_Y, happy, 1, false);
    expect(top).toBeGreaterThan(0.8);
    expect(centre).toBeLessThan(top);
    expect(below).toBe(0);
  });

  it("draws Halloween eyes as triangles: wider at the bottom than the top", () => {
    const width = (dy: number) =>
      [-2, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2].filter(
        (dx) => eyeValue(LEFT_EYE + dx, EYE_Y + dy, LEFT_EYE, EYE_Y, idle, 1, true) > 0.5,
      ).length;
    expect(width(1.2)).toBeGreaterThan(width(-1.2));
  });
});

describe("mouthValue", () => {
  it("curves up at the corners when smiling", () => {
    const at = (dx: number, y: number) => mouthValue(MID + dx, y, MOUTH_Y, idle, 0, false);
    const lowest = (dx: number) => [...Array(40)].map((_, i) => MOUTH_Y - 1 + i * 0.1).reduce((a, y) => (at(dx, y) > at(dx, a) ? y : a));
    expect(lowest(0)).toBeGreaterThan(lowest(idle.mouthW * 0.9));
  });

  it("frowns when the smile goes negative", () => {
    const frown = { ...idle, smile: -1.5 };
    expect(mouthValue(MID, MOUTH_Y - 1.4, MOUTH_Y, frown, 0, false)).toBeGreaterThan(0.5);
    expect(mouthValue(MID, MOUTH_Y + 1.4, MOUTH_Y, idle, 0, false)).toBeGreaterThan(0.5);
  });

  it("opens into a hollow ring: lit edge, dark middle", () => {
    const cy = MOUTH_Y + 0.5;
    const ry = 0.6 + 1.5;
    expect(mouthValue(MID, cy, MOUTH_Y, idle, 1, false)).toBe(0);
    expect(mouthValue(MID, cy - ry, MOUTH_Y, idle, 1, false)).toBeGreaterThan(0.8);
  });

  it("is at least a row thick when closed, so it never falls between rows", () => {
    for (const offset of [0, 0.25, 0.5]) {
      const lit = [MOUTH_Y - 2, MOUTH_Y - 1, MOUTH_Y, MOUTH_Y + 1, MOUTH_Y + 2].map((row) =>
        mouthValue(MID, Math.round(row), MOUTH_Y + offset, { ...idle, smile: 0 }, 0, false),
      );
      expect(Math.max(...lit)).toBeGreaterThan(0.4);
    }
  });
});

describe("browValue", () => {
  it("slants down toward the middle of the face", () => {
    // Left eye: the inner end is to the right (towards the middle) and lower
    const outer = browValue(LEFT_EYE - 1.8, EYE_Y - 3.4, LEFT_EYE, EYE_Y, 1);
    const inner = browValue(LEFT_EYE + 1.6, EYE_Y - 1.7, LEFT_EYE, EYE_Y, 1);
    expect(outer).toBe(1);
    expect(inner).toBe(1);
    expect(browValue(LEFT_EYE + 1.6, EYE_Y - 3.4, LEFT_EYE, EYE_Y, 1)).toBeLessThan(0.5);
  });
});

describe("madFace", () => {
  it("changes nothing at zero", () => {
    expect(madFace(FACES.speaking, 0)).toEqual(FACES.speaking);
  });

  it("narrows the eyes, drops the happy squint and frowns when fully cross", () => {
    const mad = madFace(FACES.speaking, 1);
    expect(mad.eyeRy).toBeCloseTo(FACES.speaking.eyeRy * 0.6);
    expect(mad.happy).toBe(0);
    expect(mad.smile).toBeLessThan(0);
  });

  it("glares straight ahead instead of glancing aside", () => {
    const mad = madFace(FACES.processing, 1);
    expect(mad.lookX).toBeCloseTo(0);
    expect(mad.lookY).toBeCloseTo(0);
  });
});

describe("mixHex", () => {
  it("mixes two hex colours", () => {
    expect(mixHex("#000000", "#ffffff", 0.5)).toBe("rgb(128, 128, 128)");
    expect(mixHex("#ff0000", "#0000ff", 1)).toBe("rgb(0, 0, 255)");
  });

  it("returns the first colour unchanged when not mixing or when it can't parse it", () => {
    expect(mixHex("#123456", "#ffffff", 0)).toBe("#123456");
    expect(mixHex("tomato", "#ffffff", 0.5)).toBe("tomato");
  });
});
