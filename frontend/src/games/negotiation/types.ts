// Mirrors the state built by backend/games/negotiation/engine.py (buying) and selling.py (selling)

/** Buying ends in a deal or walking away; selling in a sale or keeping the item */
export type HaggleStatus = "active" | "deal" | "walked" | "sold" | "kept";
export type HaggleMode = "buy" | "sell";

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
  outcome: "deal" | "walked" | "sold" | "kept";
  /** 0 to 100: the share of the possible discount the player won */
  score: number;
  rating: string;
  paid: number | null;
  saved: number | null;
  /** The lowest the merchant would have gone, revealed once it is over */
  floor: number;
  rounds: number;
  /** Selling: the most the buyer would have paid */
  ceiling?: number;
  /** Selling something from the inventory: the sale price less what was paid for it */
  profit?: number | null;
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
  /** The shelf it sits on, such as "Consoles" or "Fragrance" */
  category: string;
}

export interface HaggleState {
  status: HaggleStatus;
  /** Missing on haggles from before selling existed; those are buying */
  mode?: HaggleMode;
  /** Selling: what the player paid for it, if it came from the inventory */
  cost?: number | null;
  /** Selling: the buyer's first offer */
  opening_bid?: number;
  /** Selling: the buyer opened at the asking price, so they will pay it as soon as the player accepts */
  opening_agreed?: boolean;
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
    category?: string | null;
    /** Selling: what sort of buyer this is, such as "Collector" */
    kind?: string;
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
  mode?: HaggleMode;
  item: string;
  merchant: string;
  ask: number;
}

/** Something bought in Negotiation. Purchases from before the inventory may lack the listing's details. */
export interface InventoryItem {
  id: string;
  title: string;
  /** 0 to 100: the share of the possible discount won */
  score: number;
  rating: string;
  bought_at: string;
  paid: number | null;
  list_price: number;
  saved?: number | null;
  rounds?: number | null;
  merchant: string;
  difficulty?: string;
  condition?: string | null;
  category?: string | null;
  description?: string | null;
  setting?: string | null;
  /** Sold on again, and how that went */
  sold?: { price: number; profit: number | null; buyer: string; rating: string; at: string } | null;
}

/** A listing the player writes themselves */
export interface CustomListing {
  item: string;
  price: number;
  condition: string | null;
  category: string | null;
  description: string;
}
