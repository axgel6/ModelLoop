// How large the whole interface is drawn, chosen per device. It sets --ui-scale on <html>, which
// App.css turns into `zoom` there. Viewport units in the CSS divide by it so full-screen layouts
// still fit, and code that positions things from pointer or rect coordinates divides by scale().
export const UI_SCALES = [0.85, 0.9, 1, 1.1, 1.25] as const;
export type UiScale = (typeof UI_SCALES)[number];

const STORAGE_KEY = "ui_scale";
// The earlier chat-text-size setting, read once so a choice made with it carries over
const OLD_TEXT_SIZE_KEY = "text_size";
const FROM_TEXT_SIZE: Record<string, UiScale> = { xs: 0.85, small: 0.9, medium: 1, large: 1.1 };

function apply(s: UiScale) {
  if (s === 1) document.documentElement.style.removeProperty("--ui-scale");
  else document.documentElement.style.setProperty("--ui-scale", String(s));
}

export const uiScale = {
  get(): UiScale {
    try {
      const stored = Number(localStorage.getItem(STORAGE_KEY));
      if (UI_SCALES.includes(stored as UiScale)) return stored as UiScale;
      return FROM_TEXT_SIZE[localStorage.getItem(OLD_TEXT_SIZE_KEY) ?? ""] ?? 1;
    } catch {
      return 1;
    }
  },

  set(s: UiScale) {
    try {
      localStorage.setItem(STORAGE_KEY, String(s));
    } catch {
      // still shown for this visit
    }
    apply(s);
  },

  /** The scale in effect now, for converting viewport px into the page's zoomed CSS px */
  scale(): number {
    return Number(document.documentElement.style.getPropertyValue("--ui-scale")) || 1;
  },

  /** Puts the saved choice on the page; called once at startup */
  init() {
    apply(this.get());
  },
};
