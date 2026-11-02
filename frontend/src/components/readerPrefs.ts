import { useState } from "react";

// Focused mode has its own reading settings, like a book app's "Aa" menu: they change only this
// view and stay the same whatever the app theme is. Saved per device.

export type ReaderTheme = "night" | "dusk" | "paper" | "day";
export type ReaderFont = "rounded" | "sans" | "serif";
export type ReaderWidth = "narrow" | "normal" | "wide";

export type ReaderPrefs = {
  theme: ReaderTheme;
  font: ReaderFont;
  size: number; // index into READER_SIZES
  width: ReaderWidth;
};

export const THEMES: { id: ReaderTheme; label: string }[] = [
  { id: "night", label: "Night" },
  { id: "dusk", label: "Dusk" },
  { id: "paper", label: "Paper" },
  { id: "day", label: "Day" },
];

export const FONTS: { id: ReaderFont; label: string }[] = [
  { id: "rounded", label: "Rounded" },
  { id: "sans", label: "Sans" },
  { id: "serif", label: "Serif" },
];

export const WIDTHS: { id: ReaderWidth; label: string }[] = [
  { id: "narrow", label: "Narrow" },
  { id: "normal", label: "Normal" },
  { id: "wide", label: "Wide" },
];

export const READER_SIZES = [0.8, 0.88, 0.94, 1, 1.08, 1.18, 1.3];
const DEFAULT_SIZE = READER_SIZES.indexOf(1);

const DEFAULTS: ReaderPrefs = { theme: "night", font: "rounded", size: DEFAULT_SIZE, width: "normal" };
const STORAGE_KEY = "focused_reader";

function loadPrefs(): ReaderPrefs {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    const prefs = { ...DEFAULTS, ...saved };
    if (!THEMES.some((t) => t.id === prefs.theme)) prefs.theme = DEFAULTS.theme;
    if (!FONTS.some((f) => f.id === prefs.font)) prefs.font = DEFAULTS.font;
    if (!WIDTHS.some((w) => w.id === prefs.width)) prefs.width = DEFAULTS.width;
    if (!(prefs.size >= 0 && prefs.size < READER_SIZES.length)) prefs.size = DEFAULTS.size;
    return prefs;
  } catch {
    return DEFAULTS;
  }
}

export function useReaderPrefs() {
  const [prefs, setPrefs] = useState<ReaderPrefs>(loadPrefs);
  const update = (patch: Partial<ReaderPrefs>) =>
    setPrefs((p) => {
      const next = { ...p, ...patch };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Not saved; the setting still applies for this visit
      }
      return next;
    });
  return [prefs, update] as const;
}
