// The picture behind the page, chosen per device. The everyday ones work with every theme: the
// theme's own colour washes over it so text keeps its contrast (see data-background in App.css).
// A festive one belongs to its theme alone: it is only offered there, and any other theme shows
// the plain page instead. To add one, list it here and give it a body rule and a preview rule in
// App.css.
export type BackgroundId = "plain" | "sky" | "dunes" | "moon";

export const BACKGROUNDS: { id: BackgroundId; label: string; festive?: string }[] = [
  { id: "plain", label: "Plain" },
  { id: "sky", label: "Sky" },
  { id: "dunes", label: "Dunes" },
  { id: "moon", label: "Moon", festive: "halloween" },
];

/** The backgrounds on offer in a theme: the everyday ones, plus its own if it is festive */
export function backgroundsFor(festive?: string) {
  return BACKGROUNDS.filter((b) => !b.festive || b.festive === festive);
}

const STORAGE_KEY = "background";
// The earlier on/off setting for the sky, read once so a choice made with it carries over
const OLD_SKY_KEY = "sky_background";

function apply(id: BackgroundId) {
  const root = document.documentElement;
  const festive = BACKGROUNDS.find((b) => b.id === id)?.festive;
  // A festive background chosen in its theme stays chosen, but only shows in that theme
  if (id === "plain" || (festive && root.dataset.festive !== festive)) delete root.dataset.background;
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
    apply(this.get());
  },
};
