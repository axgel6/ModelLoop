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
  /** A question about the item, not haggling: it cost no patience and moved nothing */
  question?: boolean;
  /** The player had already sent this exact message */
  repeated?: boolean;
  /** The player said they were leaving, to see if the price would move */
  bluff?: boolean;
  /** How the merchant replied, which hints at how much room is left in the price */
  tell?: "quick" | "slow" | "hesitant" | null;
  /** The seller said yes to a price this round. Nothing is bought until the player pays it. */
  agreed?: boolean;
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

/** A marketplace listing, as the start screen shows it */
export interface HaggleListing {
  id: string;
  item: string;
  merchant: string;
  /** Where it is listed and how it changes hands, such as "Marketplace · Local pickup" */
  setting: string;
  /** "Used - Good" and the like; null where it does not apply, as with tickets */
  condition: string | null;
  description: string;
  list_price: number;
}

export interface HaggleState {
  status: HaggleStatus;
  turn: number;
  difficulty: string;
  /** Haggles saved before listings had them carry no condition or description */
  scenario: {
    id: string;
    item: string;
    merchant: string;
    setting: string;
    persona: string;
    condition?: string | null;
    description?: string;
  };
  opening: string;
  list_price: number;
  ask: number;
  patience: number;
  patience_max: number;
  /** The merchant has named a last price: no more talking, only take it or walk */
  final: boolean;
  /** The one bluff has been used */
  bluffed?: boolean;
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
