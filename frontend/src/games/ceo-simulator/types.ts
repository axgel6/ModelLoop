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
  /** What the numbers did, in one sentence written by the game, not the model */
  summary?: string;
  changes: string[];
  /** Milestones first reached this week */
  milestones?: string[];
  reactions: CeoReaction[];
  financials: CeoFinancials & { cash: number };
}

/** Someone's offer, waiting for a yes or no. The numbers are set by the game. */
export interface CeoOffer {
  type: "investment" | "buyout" | "event";
  /** Events only */
  kind?: "crisis" | "opportunity";
  title?: string;
  from: string;
  text: string;
  amount?: number;
  /** Investment only: percent of the company asked for */
  stake?: number;
  /** The answers on offer. `hint` says what a choice does. */
  choices?: { id: string; label: string; hint?: string }[];
  /** Crises only: the choice that happens if the player plays on without answering */
  default?: string;
}

/** Someone on the team, or a candidate who could be hired */
export interface CeoPerson {
  id: string;
  name: string;
  role: string;
  level: string;
  /** How much they get done: 1 is a mid-level person */
  power: number;
  /** Weekly */
  salary: number;
  /** Paid once, on hiring */
  fee: number;
}

export interface CeoLoan {
  principal: number;
  weekly: number;
  weeks_left: number;
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
  history: {
    turn: number;
    revenue: number;
    profit: number;
    cash: number;
    employees: number;
    /** Missing on weeks played before company value existed */
    valuation?: number;
  }[];
  loans?: CeoLoan[];
  difficulty?: string;
  style?: string | null;
  /** Head count by role */
  team?: Record<string, number>;
  /** Everyone on the team */
  staff?: CeoPerson[];
  /** People who can be hired right now */
  candidates?: CeoPerson[];
  /** What the opening products should sell in a week */
  start_revenue?: number;
  /** The week the current candidates appeared */
  candidates_turn?: number;
  /** What launching a product costs this company */
  launch_cost?: number;
  /** Last week's demand as a percent of what the team could handle; over 100 means sales were turned away */
  workload?: number;
  /** Weeks running with cash below zero. Two and the company folds. */
  weeks_in_red?: number;
  /** Whether the last week can be taken back */
  can_undo?: boolean;
  /** How much more the bank will lend right now */
  credit?: number;
  reactions: CeoReaction[];
  options: string[];
  log: CeoLogEntry[];
}
