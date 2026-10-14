import type { GameInfo } from "../types";
import { Negotiation } from "./Negotiation";

export const negotiation: GameInfo = {
  id: "negotiation",
  name: "Negotiation",
  monogram: "NG",
  tagline: "Talk the price down before they lose patience",
  description:
    "Pick something to buy and haggle with the merchant. Good arguments move the price, bad offers burn patience, and the lowest they would go stays hidden until the end.",
  tags: ["Conversation", "Quick play"],
  status: "available",
  component: Negotiation,
};
