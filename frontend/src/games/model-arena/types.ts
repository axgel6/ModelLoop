// Mirrors the state built by backend/games/model_arena/engine.py

/** `question`: a debate round has ended and the moderator has the floor */
export type ArenaStatus = "active" | "question" | "judging" | "done";
/** argument: the models go back and forth on their own. debate: rounds, each ending on a question from the moderator. */
export type ArenaMode = "argument" | "debate";
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
  /** Missing on debates saved before there were modes; those are arguments */
  mode?: ArenaMode;
  /** Speeches made so far */
  turn: number;
  topic: string;
  /** Rounds before the closing remarks */
  rounds: number;
  /** Speeches each side makes in a round: one in an argument, more in a debate */
  exchanges?: number;
  /** Debate: what the moderator asked at the end of each finished round; "" where they passed */
  questions?: string[];
  sides: [ArenaSide, ArenaSide];
  speeches: ArenaSpeech[];
  winner: SideIndex | null;
}

export interface ArenaSummary {
  turn: number;
  status: ArenaStatus;
  mode?: ArenaMode;
  sides: { model: string; character: string }[];
  winner: SideIndex | null;
}
