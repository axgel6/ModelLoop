import { afterEach, describe, expect, it } from "vitest";
import { isUiText, language, t } from "./i18n";
import { es } from "./locales/es";

afterEach(() => language.set("en"));

describe("t", () => {
  it("returns English as written when English is on", () => {
    expect(t("Sign in")).toBe("Sign in");
  });

  it("translates when Spanish is on, and falls back to English for unknown text", () => {
    language.set("es");
    expect(t("Sign in")).toBe("Iniciar sesión");
    expect(t("Not in the table")).toBe("Not in the table");
  });

  it("fills placeholders in either language", () => {
    expect(t("Ask {name}", { name: "Olly" })).toBe("Ask Olly");
    language.set("es");
    expect(t("Ask {name}", { name: "Olly" })).toBe("Pregúntale a Olly");
  });

  it("knows its own Spanish messages", () => {
    language.set("es");
    expect(isUiText(t("I couldn't load the models."))).toBe(true);
    expect(isUiText("I couldn't load the models.")).toBe(false);
  });

  it("puts the language on <html lang>", () => {
    language.set("es");
    expect(document.documentElement.lang).toBe("es-MX");
  });
});

describe("the Spanish table", () => {
  // Every literal passed to t() or tr() in the app, so a new string can't ship untranslated
  const sources = import.meta.glob(["./**/*.{ts,tsx}", "!./**/*.test.{ts,tsx}"], {
    query: "?raw",
    import: "default",
    eager: true,
  }) as Record<string, string>;
  const keys = new Set<string>();
  for (const source of Object.values(sources)) {
    for (const m of source.matchAll(/\b(?:t|tr)\("((?:[^"\\]|\\.)*)"/g)) {
      keys.add(JSON.parse(`"${m[1]}"`));
    }
  }

  it("has every string the code translates", () => {
    expect(keys.size).toBeGreaterThan(200);
    expect([...keys].filter((k) => !(k in es))).toEqual([]);
  });

  it("keeps each placeholder of the English", () => {
    const names = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    const mismatched = Object.entries(es).filter(([en, sp]) => names(en).join() !== names(sp).join());
    expect(mismatched).toEqual([]);
  });

  it("uses no em dashes", () => {
    expect(Object.values(es).filter((v) => v.includes("—"))).toEqual([]);
  });
});
