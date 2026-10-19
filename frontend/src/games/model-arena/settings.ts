// Model Arena settings, kept in this browser. Set from the gear on the game's card.

const UNHINGED_KEY = "arena_unhinged";

/** Whether the Unhinged character, the one that swears, can be picked. On unless turned off. */
export function isUnhingedAllowed(): boolean {
  try {
    return localStorage.getItem(UNHINGED_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setUnhingedAllowed(on: boolean) {
  try {
    localStorage.setItem(UNHINGED_KEY, on ? "on" : "off");
  } catch {
    // private mode: it lasts until the page closes
  }
}
