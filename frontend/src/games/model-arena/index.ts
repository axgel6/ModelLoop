import { ArenaIcon } from "../icons";
import type { GameInfo } from "../types";
import { ArenaSettings } from "./ArenaSettings";
import { ModelArena } from "./ModelArena";

export const modelArena: GameInfo = {
  id: "model-arena",
  name: "Model Arena",
  monogram: "MA",
  icon: ArenaIcon,
  button: "X",
  tagline: "Two models debate. You moderate.",
  description:
    "Give two models a topic and a character each. Let them argue it out on their own, or run a debate and question them between rounds. Then you decide who won.",
  status: "available",
  component: ModelArena,
  settings: ArenaSettings,
};
