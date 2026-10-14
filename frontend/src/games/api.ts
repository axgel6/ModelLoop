// Saved games and turns. Shared by every game; the shape of `state` is the game's own.
import { apiFetch } from "../components/api";

export interface GameSave<State> {
  id: string;
  game_type: string;
  title: string;
  updated_at: string;
  state: State;
}

export interface GameSaveSummary {
  id: string;
  title: string;
  updated_at: string;
  summary: {
    turn: number;
    cash: number;
    status: string;
    valuation?: number;
    result?: { score: number; rating: string } | null;
    /** The score a run ended on, kept when it is played on afterwards */
    official_result?: { score: number; rating: string } | null;
    free_play?: boolean;
  };
}

async function failure(res: Response, fallback: string): Promise<Error> {
  try {
    const body = await res.json();
    if (typeof body?.detail === "string") return new Error(body.detail);
  } catch {
    // not JSON: use the fallback
  }
  return new Error(res.status === 429 ? "You're going a little fast. Give it a moment." : fallback);
}

export async function apiListGames(gameType: string): Promise<GameSaveSummary[]> {
  const res = await apiFetch(`/api/v1/games?game_type=${encodeURIComponent(gameType)}`);
  if (!res.ok) throw await failure(res, "I couldn't load your saved games.");
  return (await res.json()).games;
}

/** A finished run. Beyond the score, the fields are whatever the game recorded. */
export interface GameScoreRow {
  id: string;
  title: string;
  score: number;
  outcome?: string;
  rating?: string;
  weeks?: number;
  /** Cash the player typed into existence during the run */
  typed_cash?: number;
  difficulty?: string;
}

export async function apiGameScores(gameType: string): Promise<GameScoreRow[]> {
  const res = await apiFetch(`/api/v1/games/scores?game_type=${encodeURIComponent(gameType)}`);
  if (!res.ok) throw await failure(res, "I couldn't load your best runs.");
  return (await res.json()).scores;
}

export async function apiCreateGame<State>(gameType: string, setup: unknown): Promise<GameSave<State>> {
  const res = await apiFetch(`/api/v1/games/${gameType}`, {
    method: "POST",
    body: JSON.stringify(setup),
  });
  if (!res.ok) throw await failure(res, "I couldn't start that game. Try again in a moment.");
  return res.json();
}

export async function apiGetGame<State>(id: string): Promise<GameSave<State>> {
  const res = await apiFetch(`/api/v1/games/${id}`);
  if (!res.ok) throw await failure(res, "I couldn't open that game.");
  return res.json();
}

export async function apiDeleteGame(id: string): Promise<void> {
  const res = await apiFetch(`/api/v1/games/${id}`, { method: "DELETE" });
  if (!res.ok) throw await failure(res, "I couldn't delete that game.");
}

/** `action` is a decision made with a form; when given, the server ignores `decision`. */
export async function apiPlayTurn<State>(
  id: string,
  decision: string,
  model?: string,
  action?: unknown,
): Promise<GameSave<State>> {
  const res = await apiFetch(`/api/v1/games/${id}/turn`, {
    method: "POST",
    body: JSON.stringify({ decision, action, model: model || undefined }),
  });
  if (!res.ok) throw await failure(res, "That turn didn't go through. Try again.");
  return res.json();
}

/** A change made outside a turn, such as editing a product. `path` is relative to the game. */
export async function apiEditGame<State>(id: string, path: string, changes: unknown): Promise<GameSave<State>> {
  const res = await apiFetch(`/api/v1/games/${id}/${path}`, {
    method: "PATCH",
    body: JSON.stringify(changes),
  });
  if (!res.ok) throw await failure(res, "That change didn't save. Try again.");
  return res.json();
}
