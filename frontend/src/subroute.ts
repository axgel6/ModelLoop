// Where you are inside the chat view, kept in the address bar so a refresh lands you back there:
// /chat/<chat id>, /games, /games/<game>, /games/<game>/<save id>.
// Only ever replaces the current entry, so the Back button keeps leaving the app as before.

/** The path split into its parts: "/games/negotiation/abc" is ["games", "negotiation", "abc"] */
export function pathParts(): string[] {
  return window.location.pathname.split("/").filter(Boolean);
}

/** Point the address bar at `path` without adding a history entry. */
export function replacePath(path: string) {
  if (window.location.pathname !== path) {
    window.history.replaceState(window.history.state, "", path + window.location.search);
  }
}

/** The chat open in the address bar, if any */
export function chatIdFromPath(): string | null {
  const [first, id] = pathParts();
  return first === "chat" && id ? decodeURIComponent(id) : null;
}

export function inGamesPath(): boolean {
  return pathParts()[0] === "games";
}
