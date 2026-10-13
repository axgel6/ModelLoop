// Minimal History API router. Four routes did not justify a routing dependency, but
// they do deserve real URLs so /welcome can be linked, bookmarked, and shared.
import { useCallback, useEffect, useState } from "react";

export type View = "welcome" | "login" | "chat" | "terms";

const PATH_FOR: Record<View, string> = {
  welcome: "/welcome",
  login: "/login",
  chat: "/chat",
  terms: "/terms",
};

export function pathForView(view: View): string {
  return PATH_FOR[view];
}

export function viewForPath(pathname: string): View {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/" || path === "/welcome") return "welcome";
  if (path === "/login") return "login";
  if (path === "/chat") return "chat";
  if (path === "/terms") return "terms";
  return "welcome"; // unknown path: show the explainer rather than a blank screen
}

/** Current view plus a setter that keeps the address bar and Back button in sync. */
export function useRoute(initial: View): [View, (next: View) => void] {
  const [view, setViewState] = useState<View>(() =>
    // A bare "/" carries no intent, so let the caller decide (signed-in users go to chat).
    window.location.pathname === "/" ? initial : viewForPath(window.location.pathname),
  );

  useEffect(() => {
    // Normalize the first entry so an unknown or non-canonical path (/nonsense, /chat/)
    // becomes the real URL of what is on screen. replaceState, so Back still leaves the app.
    const path = window.location.pathname;
    if (path !== "/" && path !== pathForView(view)) {
      window.history.replaceState({ view }, "", pathForView(view));
    }
  }, []);

  useEffect(() => {
    const onPop = () => setViewState(viewForPath(window.location.pathname));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const navigate = useCallback((next: View) => {
    // The history push happens here rather than inside the state updater: React invokes
    // updaters twice under StrictMode, which would push two entries per navigation and
    // leave the Back button needing two presses to go anywhere.
    if (viewForPath(window.location.pathname) !== next) {
      window.history.pushState({ view: next }, "", pathForView(next));
    }
    setViewState(next);
  }, []);

  return [view, navigate];
}
