import type { GameInfo } from "../types";
import { ModelArena } from "./ModelArena";

export const modelArena: GameInfo = {
  id: "model-arena",
  name: "Model Arena",
  monogram: "MA",
  tagline: "Two models debate. You moderate.",
  description:
    "Give two models a topic and a character each. They trade five arguments, make their closing remarks, and you decide who won.",
  tags: ["Debate", "Two models"],
  status: "available",
  component: ModelArena,
};
