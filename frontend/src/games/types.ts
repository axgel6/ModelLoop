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
  tagline: string;
  description: string;
  tags: string[];
  status: GameStatus;
  /** The game itself. Required once status is "available". */
  component?: ComponentType<GameProps>;
}
