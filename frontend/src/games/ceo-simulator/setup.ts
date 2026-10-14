// The choices made when starting a company, and the team roles. The wording
// mirrors DIFFICULTIES, STYLES and ROLES in backend/games/ceo_simulator/engine.py,
// which is where the numbers behind them live.

export type Difficulty = "easy" | "normal" | "hard";
export type FounderStyle = "bootstrapper" | "growth" | "perfectionist";
export type Role = "general" | "sales" | "product" | "support";

export const DIFFICULTIES: { id: Difficulty; label: string; blurb: string; cash: number }[] = [
  { id: "easy", label: "Easy", blurb: "More starting cash, bigger wins, a patient bank.", cash: 300000 },
  { id: "normal", label: "Normal", blurb: "The standard game.", cash: 200000 },
  { id: "hard", label: "Hard", blurb: "Less cash, smaller wins, more crises, no overdraft.", cash: 140000 },
];

export const STYLES: { id: FounderStyle; label: string; blurb: string }[] = [
  { id: "bootstrapper", label: "Bootstrapper", blurb: "Runs lean. Salaries cost 15% less, but investors offer 20% less." },
  { id: "growth", label: "Growth at all costs", blurb: "Demand gains land 25% harder, and salaries cost 15% more." },
  {
    id: "perfectionist",
    label: "Perfectionist",
    blurb: "Products start better made and the company better regarded. Launches cost twice as much.",
  },
];

/** How experienced someone is. Higher levels do more and cost more. */
export const LEVELS: Record<string, string> = {
  junior: "Junior",
  mid: "Mid-level",
  senior: "Senior",
  star: "Star",
};

/** What one person of each role is called */
export const ROLE_TITLE: Record<string, string> = {
  general: "generalist",
  sales: "salesperson",
  product: "product person",
  support: "support person",
};

export const ROLES: { id: Role; label: string; blurb: string }[] = [
  { id: "general", label: "Generalists", blurb: "Keep things running. Every employee adds capacity." },
  { id: "sales", label: "Sales", blurb: "Each one grows demand a little every week." },
  { id: "product", label: "Product", blurb: "Each one raises product quality a little every week." },
  { id: "support", label: "Support", blurb: "Each one builds reputation a little every week." },
];
