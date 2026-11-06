// How see-through the popup windows (Preferences, the welcome and game windows, the confirm
// dialogs) and the chat sidebar are, chosen per device. Ported from NineLeft's Panels setting. It sets --frosting on
// <html>, which App.css turns into the windows' tint and blur. Opaque also sets
// data-panels="opaque", which turns the blur off entirely: a blur is the costliest thing to draw
// in Chromium, so this is the setting to reach for when it stutters.
type PanelsId = "clear" | "frosted" | "opaque";

export const PANELS: { id: PanelsId; label: string; frosting: number }[] = [
  { id: "clear", label: "Clear", frosting: 0 },
  { id: "frosted", label: "Frosted", frosting: 0.7 },
  { id: "opaque", label: "Opaque", frosting: 1 },
];

const STORAGE_KEY = "panels_frosting";
// Frosted, which matches --frosting's default in App.css
const DEFAULT: PanelsId = "frosted";
const DEFAULT_FROSTING = 0.7;

function apply(id: PanelsId) {
  const root = document.documentElement;
  const frosting = PANELS.find((p) => p.id === id)!.frosting;
  if (frosting === DEFAULT_FROSTING) root.style.removeProperty("--frosting");
  else root.style.setProperty("--frosting", String(frosting));
  if (id === "opaque") root.dataset.panels = "opaque";
  else delete root.dataset.panels;
}

export const panels = {
  get(): PanelsId {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const stored = raw === null ? NaN : Number(raw);
      if (Number.isNaN(stored)) return DEFAULT;
      // Snap to the nearest choice, so one of them always shows as selected
      return PANELS.reduce((best, p) =>
        Math.abs(p.frosting - stored) < Math.abs(best.frosting - stored) ? p : best,
      ).id;
    } catch {
      return DEFAULT;
    }
  },

  set(id: PanelsId) {
    try {
      localStorage.setItem(STORAGE_KEY, String(PANELS.find((p) => p.id === id)!.frosting));
    } catch {
      // still shown for this visit
    }
    apply(id);
  },

  /** Puts the saved choice on the page; called once at startup, before the first render */
  init() {
    apply(this.get());
  },
};
