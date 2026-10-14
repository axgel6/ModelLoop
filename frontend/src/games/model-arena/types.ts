// Mirrors the state built by backend/games/model_arena/engine.py

export type ArenaStatus = "active" | "judging" | "done";
export type SideIndex = 0 | 1;

export interface ArenaSide {
  /** The model that speaks for this side. The server may swap in one it has. */
  model: string;
  /** The character it plays, or "" for the model as it is */
  character: string;
  stance: "for" | "against";
}

export interface ArenaSpeech {
  side: SideIndex;
  kind: "argument" | "closing";
  /** Which exchange an argument belongs to; null for closing remarks */
  round: number | null;
  text: string;
}

export interface ArenaState {
  status: ArenaStatus;
  /** Speeches made so far */
  turn: number;
  topic: string;
  /** Arguments each side makes before the closing remarks */
  rounds: number;
  sides: [ArenaSide, ArenaSide];
  speeches: ArenaSpeech[];
  winner: SideIndex | null;
}

export interface ArenaSummary {
  turn: number;
  status: ArenaStatus;
  sides: { model: string; character: string }[];
  winner: SideIndex | null;
}
