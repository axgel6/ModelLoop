// The save a game has open, kept in the address bar (/games/<game>/<save id>) so a refresh reopens it.
import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { pathParts, replacePath } from "../subroute";
import { apiGetGame, type GameSave } from "./api";

/** The save open in `gameId`, its setter, and whether one is still being reopened after a refresh. */
export function useOpenSave<State>(
  gameId: string,
): [GameSave<State> | null, Dispatch<SetStateAction<GameSave<State> | null>>, boolean] {
  const [save, setSave] = useState<GameSave<State> | null>(null);
  // The save named in the address bar on arrival, if it belongs to this game
  const [restoring, setRestoring] = useState<string | null>(() => {
    const [first, game, id] = pathParts();
    return first === "games" && game === gameId && id ? id : null;
  });

  useEffect(() => {
    if (!restoring) return;
    let current = true;
    apiGetGame<State>(restoring)
      .then((found) => current && setSave(found))
      .catch(() => {}) // gone or not yours: the game's own menu shows instead
      .finally(() => current && setRestoring(null));
    return () => {
      current = false;
    };
  }, [restoring]);

  const openId = save?.id ?? null;
  useEffect(() => {
    // Wait for the reopen to land before writing, or the save in the address bar would be wiped first
    if (restoring) return;
    replacePath(openId ? `/games/${gameId}/${openId}` : `/games/${gameId}`);
  }, [gameId, openId, restoring]);

  return [save, setSave, restoring !== null];
}
