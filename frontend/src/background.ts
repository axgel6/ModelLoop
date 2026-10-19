// The picture behind the page, chosen per device. Every one works with every theme: the theme's
// own colour washes over it so text keeps its contrast (see data-background in App.css). To add
// one, list it here and give it a body rule and a preview rule in App.css.
export type BackgroundId = "plain" | "sky";

export const BACKGROUNDS: { id: BackgroundId; label: string }[] = [
  { id: "plain", label: "Plain" },
  { id: "sky", label: "Sky" },
];

const STORAGE_KEY = "background";
// The earlier on/off setting for the sky, read once so a choice made with it carries over
const OLD_SKY_KEY = "sky_background";

function apply(id: BackgroundId) {
  if (id === "plain") delete document.documentElement.dataset.background;
  else document.documentElement.dataset.background = id;
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

  /** Puts the saved choice on the page; called once at startup */
  init() {
    apply(this.get());
  },
};
