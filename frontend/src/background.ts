// The picture behind the page, chosen per device. The everyday ones work with every theme: the
// theme's own colour washes over it so text keeps its contrast (see data-background in App.css).
// A festive one belongs to its theme alone: it is only offered there, and any other theme shows
// the plain page instead. One with `themes` works the same way for a set of base themes (Earthset
// is mostly black space, so it is dark themes only). A choice made in one theme is kept, so going
// back to a theme that has it brings it back. To add one, list it here and give it a body rule and
// a preview rule in App.css.
import { baseTheme, type BaseTheme, type Theme } from "./festive";

type BackgroundId = "plain" | "sky" | "dunes" | "earthset";

// `credit`, when a photo has one, shows under its name in the picker while hovered or chosen
const BACKGROUNDS: {
  id: BackgroundId;
  label: string;
  festive?: string;
  themes?: BaseTheme[];
  credit?: string;
}[] = [
  { id: "plain", label: "Plain" },
  { id: "sky", label: "Sky" },
  { id: "dunes", label: "Dunes" },
  // Artemis II, April 6, 2026 (NASA, art002e009288; see assets/CREDITS.md)
  { id: "earthset", label: "Earthset", themes: ["ember", "frost"], credit: "Photo: NASA" },
];

/** The backgrounds on offer in a theme: the everyday ones that suit it, plus its own if it is festive */
export function backgroundsFor(theme: Theme) {
  return BACKGROUNDS.filter(
    (b) => (!b.festive || b.festive === theme) && (!b.themes || b.themes.includes(baseTheme(theme))),
  );
}

const STORAGE_KEY = "background";
// The earlier on/off setting for the sky, read once so a choice made with it carries over
const OLD_SKY_KEY = "sky_background";

function apply(id: BackgroundId) {
  const root = document.documentElement;
  const entry = BACKGROUNDS.find((b) => b.id === id);
  // A festive background chosen in its theme stays chosen, but only shows in that theme; one
  // kept to some themes only shows in those
  const wrongFestive = entry?.festive && root.dataset.festive !== entry.festive;
  const wrongTheme = entry?.themes && !entry.themes.includes(root.dataset.theme as BaseTheme);
  if (id === "plain" || wrongFestive || wrongTheme) delete root.dataset.background;
  else root.dataset.background = id;
}

export const background = {
  get(): BackgroundId {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (BACKGROUNDS.some((b) => b.id === stored)) return stored as BackgroundId;
      return localStorage.getItem(OLD_SKY_KEY) === "on" ? "sky" : "plain";
    } catch {
      return "plain";
    }
  },

  set(id: BackgroundId) {
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      // still shown for this visit
    }
    apply(id);
  },

  /** Puts the saved choice on the page; called at startup and again on each theme change */
  init() {
    document.documentElement.dataset.build = "QW5nZWwgR3V0aWVycmV6";
    apply(this.get());
  },
};
