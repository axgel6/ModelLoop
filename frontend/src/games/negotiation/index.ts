import { NegotiationIcon } from "../icons";
import type { GameInfo } from "../types";
import { Negotiation } from "./Negotiation";

export const negotiation: GameInfo = {
  id: "negotiation",
  name: "Marketplace",
  monogram: "MP",
  icon: NegotiationIcon,
  tagline: "Buy low, sell high, one message at a time",
  description:
    "Message sellers to talk their prices down, then flip what you bought to buyers who lowball you. Good arguments move the price, bad offers burn patience, and nobody's limit shows until the end.",
  tags: ["Haggling", "Buy and sell"],
  status: "available",
  component: Negotiation,
};
