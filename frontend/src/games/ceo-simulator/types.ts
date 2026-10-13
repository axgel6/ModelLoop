// Mirrors the state built by backend/games/ceo_simulator/engine.py

export interface CeoProduct {
  id: string;
  name: string;
  price: number;
  unit_cost: number;
  quality: number;
  active: boolean;
  units_sold: number;
  revenue: number;
}

export interface CeoReaction {
  source: string;
  text: string;
  sentiment: "positive" | "neutral" | "negative";
}

export interface CeoFinancials {
  revenue: number;
  costs: number;
  profit: number;
}

export interface CeoLogEntry {
  turn: number;
  decision: string;
  narrative: string;
  changes: string[];
  reactions: CeoReaction[];
  financials: CeoFinancials & { cash: number };
}

/** Someone's offer, waiting for a yes or no. The numbers are set by the game. */
export interface CeoOffer {
  type: "investment" | "buyout";
  from: string;
  text: string;
  amount: number;
  /** Investment only: percent of the company asked for */
  stake?: number;
}

/** How a run ended. `score` is what the player's stake was worth. */
export interface CeoResult {
  outcome: "bankrupt" | "sold" | "finished";
  score: number;
  company_value: number;
  weeks: number;
  rating: string;
  goal_met: boolean;
}

export interface CeoState {
  company: { name: string; pitch: string };
  /** Cash the company opened with */
  start_cash: number;
  status: "active" | "bankrupt" | "sold" | "finished";
  /** What the whole company is worth */
  valuation: number;
  /** The share of it the player still owns, 0 to 1 */
  equity: number;
  /** Stake value that counts as a win */
  goal: number;
  /** Weeks in the run */
  length: number;
  offer: CeoOffer | null;
  result: CeoResult | null;
  /** Playing on after the run ended. Nothing here changes the recorded score. */
  free_play?: boolean;
  /** The result the run ended on, kept through free play */
  official_result?: CeoResult | null;
  turn: number;
  cash: number;
  employees: number;
  reputation: number;
  morale: number;
  products: CeoProduct[];
  last: CeoFinancials;
  history: { turn: number; revenue: number; profit: number; cash: number; employees: number }[];
  reactions: CeoReaction[];
  options: string[];
  log: CeoLogEntry[];
}
