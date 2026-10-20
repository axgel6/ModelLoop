// Festive themes: a holiday's look and words, offered only in its season.
//
// Each one borrows an everyday theme's layout (its `base`) and recolours it at build time, so the
// page carries data-theme="<base>" for layout and data-festive="<id>" for everything of its own.
// Everything in the app that changes with a festive theme reads it from here.
//
// To add one (Thanksgiving, say):
//   1. An entry below, and its id in FestiveId.
//   2. Its palette in ../festive-themes.ts, which builds its colours from the base theme's rules.
//   3. A preview card (.pref-theme-preview-<id>) and any touches of its own in App.css, scoped to
//      html[data-festive="<id>"].
//   4. Optional: Olly's voice for it in FESTIVE_PERSONAS (backend/config.py), and a background
//      of its own in background.ts (with `festive: "<id>"`).

export type BaseTheme = "ember" | "frost" | "dune" | "meadow";
export type FestiveId = "halloween";

export type Theme = BaseTheme | FestiveId;

export const BASE_THEMES: { id: BaseTheme; label: string }[] = [
  { id: "meadow", label: "Meadow" },
  { id: "dune", label: "Dune" },
  { id: "ember", label: "Ember" },
  { id: "frost", label: "Frost" },
];

export interface FestiveTheme {
  id: FestiveId;
  label: string;
  /** The everyday theme whose layout it uses, and which anyone still on it moves to after its season */
  base: BaseTheme;
  /** Whether it can be picked on this date */
  open: (date: Date) => boolean;
  /** The hello in the greeting on an empty chat, by the hour (0 to 23) */
  hello: (hour: number) => string;
  /** The lines under the greeting, in place of the usual ones */
  lines: string[];
  /** The suggestion chips on an empty chat, in place of the usual pool */
  suggestions: string[];
  /** The message box's placeholder */
  placeholder: (assistantName: string) => string;
}

export const FESTIVE_THEMES: FestiveTheme[] = [
  {
    id: "halloween",
    label: "Halloween",
    base: "frost",
    // October 1 through November 7
    open: (d) => d.getMonth() === 9 || (d.getMonth() === 10 && d.getDate() <= 7),
    hello: (h) => (h < 5 ? "It's the witching hour" : "Happy haunting"),
    lines: [
      "What shall we conjure up tonight?",
      "Something wicked this way comes. What's on your mind?",
      "The night is young. What are you curious about?",
      "Pull up a cauldron. What can I help with?",
    ],
    suggestions: [
      "Tell me a two-sentence horror story",
      "Costume ideas for a group of 4",
      "Plan a spooky movie night",
      "Give me pumpkin carving ideas",
      "Explain the history of Halloween",
      "Write a ghost story set in my town",
      "Suggest a creepy playlist for a party",
      "Help me name a haunted house",
      "Invent a monster and describe it",
      "Easy Halloween treats to bake",
      "Tell me about a famous unsolved mystery",
      "Write a poem about a full moon",
    ],
    placeholder: (name) => `Ask ${name}, if you dare`,
  },
];

/** The festive theme a theme id names, or null for an everyday theme */
export function festiveTheme(theme: Theme): FestiveTheme | null {
  return FESTIVE_THEMES.find((f) => f.id === theme) ?? null;
}

export function isTheme(value: unknown): value is Theme {
  return [...BASE_THEMES, ...FESTIVE_THEMES].some((t) => t.id === value);
}

/** The festive themes that can be picked on this date */
export function openFestiveThemes(date = new Date()): FestiveTheme[] {
  return FESTIVE_THEMES.filter((f) => f.open(date));
}

/** The everyday theme the page's layout comes from */
export function baseTheme(theme: Theme): BaseTheme {
  return festiveTheme(theme)?.base ?? (theme as BaseTheme);
}

/** A saved theme as it should be used today: a festive one out of season becomes its base */
export function inSeason(theme: Theme, date = new Date()): Theme {
  const f = festiveTheme(theme);
  return f && !f.open(date) ? f.base : theme;
}
