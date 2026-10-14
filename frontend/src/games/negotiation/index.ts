import { NegotiationIcon } from "../icons";
import type { GameInfo } from "../types";
import { MarketplaceSettings } from "./MarketplaceSettings";
import { Negotiation } from "./Negotiation";

export const negotiation: GameInfo = {
  id: "negotiation",
  name: "Marketplace",
  monogram: "MP",
  icon: NegotiationIcon,
  tagline: "Buy low, sell high, one message at a time",
  description:
    "Message sellers to talk their prices down, then flip what you bought to buyers who lowball you. Play freely, or start a Hustle run: $1,000 and 30 days to grow it as far as you can.",
  tags: ["Haggling", "Buy and sell"],
  status: "available",
  component: Negotiation,
  settings: MarketplaceSettings,
};
