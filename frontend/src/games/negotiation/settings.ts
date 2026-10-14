// Marketplace settings, kept in this browser. Set from the gear on the game's card.

const CLEAN_KEY = "marketplace_clean_language";

/** Clean language: characters who swear keep their energy and lose the language */
export function isCleanLanguage(): boolean {
  try {
    return localStorage.getItem(CLEAN_KEY) === "on";
  } catch {
    return false;
  }
}

export function setCleanLanguage(on: boolean) {
  try {
    localStorage.setItem(CLEAN_KEY, on ? "on" : "off");
  } catch {
    // private mode: it lasts until the page closes
  }
}

// Softer words for the strong ones, matching case. A safety net for clean language: the pre-written
// openers swear, and a small model can slip even when told not to.
const SOFTER: [RegExp, string][] = [
  [/\bmother ?fuck(?:er|ers|ing)\b/gi, "mother-trucker"],
  [/\bfuck(?:ing|in')\b/gi, "freaking"],
  [/\bfuck(?:ed)\b/gi, "messed"],
  [/\bfuck\b/gi, "heck"],
  [/\bbullshit\b/gi, "nonsense"],
  [/\bshit(?:ty)\b/gi, "crummy"],
  [/\bshit\b/gi, "stuff"],
  [/\bdamn(?:ed)?\b/gi, "dang"],
  [/\bhell\b/gi, "heck"],
  [/\bbitch\b/gi, "thing"],
  [/\bbastard\b/gi, "rascal"],
  [/\bass\b/gi, "butt"],
  [/\bcunt\b/gi, "jerk"],
  [/\bdick\b/gi, "jerk"],
];

function matchCase(original: string, soft: string): string {
  return original[0] === original[0].toUpperCase() ? soft[0].toUpperCase() + soft.slice(1) : soft;
}

export function cleanText(text: string): string {
  return SOFTER.reduce((out, [pattern, soft]) => out.replace(pattern, (m) => matchCase(m, soft)), text);
}
