import { ceoSimulator } from "./ceo-simulator";
import { modelArena } from "./model-arena";
import { negotiation } from "./negotiation";
import type { GameInfo } from "./types";

// Add a game here once its folder exports a GameInfo.
export const GAMES: GameInfo[] = [ceoSimulator, negotiation, modelArena];
