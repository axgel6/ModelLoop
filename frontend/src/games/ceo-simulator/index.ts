import type { GameInfo } from "../types";
import { CeoSimulator } from "./CeoSimulator";

export const ceoSimulator: GameInfo = {
  id: "ceo-simulator",
  name: "CEO Simulator",
  monogram: "CS",
  tagline: "Build a company one decision at a time",
  description:
    "Name your company, choose what it sells, and run it week by week. Revenue, profit, headcount and public reaction update after every call you make.",
  tags: ["Strategy", "Business"],
  status: "available",
  component: CeoSimulator,
};
