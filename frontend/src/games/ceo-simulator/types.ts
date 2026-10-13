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

export interface CeoState {
  company: { name: string; pitch: string };
  /** Cash the company opened with */
  start_cash: number;
  status: "active" | "bankrupt";
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
