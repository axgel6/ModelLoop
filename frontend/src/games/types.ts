import type { ComponentType } from "react";

// A game as the hub sees it. Each game lives in its own folder under games/
// and exports one of these; registry.ts lists the ones to show.
export type GameStatus = "available" | "coming-soon";

export interface GameProps {
  /** The model picked in Preferences; the server default is used when unset */
  model?: string;
  /** Back to the game selection screen */
  onExit: () => void;
}

export interface GameInfo {
  id: string;
  name: string;
  /** Two letters shown on the card's badge when the game has no icon */
  monogram: string;
  /** Drawn on the card's badge */
  icon?: ComponentType;
  /** The SNES face button whose colour the game's icon and play symbol take, as in the click burst */
  button: "A" | "B" | "X" | "Y";
  tagline: string;
  description: string;
  status: GameStatus;
  /** The game itself. Required once status is "available". */
  component?: ComponentType<GameProps>;
  /** The game's own settings, opened from a gear on its card. Leave out for a game without any. */
  settings?: ComponentType<{ onClose: () => void }>;
}
