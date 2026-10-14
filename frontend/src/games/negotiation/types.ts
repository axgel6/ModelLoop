// Mirrors the state built by backend/games/negotiation/engine.py

export type HaggleStatus = "active" | "deal" | "walked";

export interface HaggleEntry {
  turn: number;
  you: string;
  offer: number | null;
  reply: string;
  /** How the merchant took the message, from -2 to 2 */
  persuasion: number;
  /** The offer was low enough to cost extra patience */
  insulted: boolean;
  /** The merchant's price after this round */
  ask: number;
  final: boolean;
}

export interface HaggleResult {
  outcome: "deal" | "walked";
  /** 0 to 100: the share of the possible discount the player won */
  score: number;
  rating: string;
  paid: number | null;
  saved: number | null;
  /** The lowest the merchant would have gone, revealed once it is over */
  floor: number;
  rounds: number;
}

export interface HaggleState {
  status: HaggleStatus;
  turn: number;
  difficulty: string;
  scenario: { id: string; item: string; merchant: string; setting: string; persona: string };
  opening: string;
  list_price: number;
  ask: number;
  patience: number;
  patience_max: number;
  /** The merchant has named a last price: no more talking, only take it or walk */
  final: boolean;
  log: HaggleEntry[];
  result: HaggleResult | null;
}

export interface HaggleSummary {
  turn: number;
  status: HaggleStatus;
  item: string;
  merchant: string;
  ask: number;
}
