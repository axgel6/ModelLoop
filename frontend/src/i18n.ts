import { useSyncExternalStore } from "react";
import { es } from "./locales/es";

// The app's language, chosen per device in Preferences. English is the source: every string in the
// code is written in English and passed through t(), which looks it up in the Spanish table when
// Spanish is on. A string missing from the table shows in English, so nothing ever breaks.
// The language is also sent with every request (see authHeaders in components/api.ts), so the
// server tells Olly to reply in it.
export type Lang = "en" | "es";

const STORAGE_KEY = "language";
const CHANGED_EVENT = "modelloop-language-changed";
const DEFAULT: Lang = "en";

/** The BCP 47 tag for each language: dates, voices and speech input use it */
const TAGS: Record<Lang, string> = { en: "en-US", es: "es-MX" };

const TABLES: Record<Lang, Record<string, string> | null> = { en: null, es };

function read(): Lang {
  try {
    return localStorage.getItem(STORAGE_KEY) === "es" ? "es" : DEFAULT;
  } catch {
    return DEFAULT;
  }
}

let current: Lang = read();

export const language = {
  get(): Lang {
    return current;
  },

  set(lang: Lang) {
    if (lang === current) return;
    current = lang;
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      // it lasts until the page closes
    }
    document.documentElement.lang = TAGS[lang];
    window.dispatchEvent(new Event(CHANGED_EVENT));
  },

  /** The BCP 47 tag, e.g. "es-MX" */
  tag(): string {
    return TAGS[current];
  },

  /** Puts the language on <html lang>, for screen readers and hyphenation */
  init() {
    document.documentElement.lang = TAGS[current];
  },
};

/** Calls back when the language changes; returns the unsubscribe */
export function subscribe(listener: () => void): () => void {
  window.addEventListener(CHANGED_EVENT, listener);
  return () => window.removeEventListener(CHANGED_EVENT, listener);
}

/**
 * The text in the current language. `vars` fill {name} placeholders:
 * t("Ask {name}", { name: "Olly" }) gives "Ask Olly", or "Pregúntale a Olly" in Spanish.
 */
export function t(text: string, vars?: Record<string, string | number>): string {
  const out = TABLES[current]?.[text] ?? text;
  if (!vars) return out;
  return out.replace(/\{(\w+)\}/g, (match, key: string) => (key in vars ? String(vars[key]) : match));
}

const SPANISH_TEXT = new Set(Object.values(es));

/** Whether the text is one of the app's own messages already translated (English needs none) */
export function isUiText(text: string): boolean {
  return current === "es" && SPANISH_TEXT.has(text);
}

/** For components that show the language itself; re-renders when it changes */
export function useLanguage(): Lang {
  return useSyncExternalStore(subscribe, () => current, () => DEFAULT);
}

/** For components: re-renders when the language changes, and returns t */
export function useT(): typeof t {
  useLanguage();
  return t;
}
