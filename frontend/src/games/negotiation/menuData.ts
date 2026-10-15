// What the Marketplace menu needs, fetched in one trip and kept for the visit, so coming back
// from a chat shows the menu at once while a fresh copy loads behind it.
import { apiFetch } from "../../components/api";
import type { GameSaveSummary, GameScoreRow } from "../api";
import type { HustleView } from "./hustleData";
import type { FreeBank, HaggleListing, HaggleSummary, InventoryItem, MarketProfile } from "./types";

export interface Overview {
  /** The chat still on the table, if any */
  unfinished: GameSaveSummary<HaggleSummary> | null;
  hustle: HustleView;
  inventory: InventoryItem[];
  bank: FreeBank;
  /** Your marketplace profile, ready before it is opened */
  profile: MarketProfile;
  scores: { buy: GameScoreRow[]; sell: GameScoreRow[]; hustle: GameScoreRow[] };
}

let overview: Overview | null = null;
let listings: HaggleListing[] | null = null;

/** What was last loaded this visit, to draw the menu with before the fresh copy arrives */
export function cachedOverview(): Overview | null {
  return overview;
}

export function cachedListings(): HaggleListing[] | null {
  return listings;
}

export async function apiOverview(): Promise<Overview> {
  const res = await apiFetch("/api/v1/games/negotiation/overview");
  if (!res.ok) throw new Error("I couldn't load the marketplace.");
  overview = await res.json();
  return overview!;
}

/** Everything for sale. It only changes when the app is deployed, so it is fetched once a visit. */
export async function apiListings(): Promise<HaggleListing[]> {
  if (listings) return listings;
  const res = await apiFetch("/api/v1/games/negotiation/listings");
  if (!res.ok) return [];
  listings = (await res.json()).listings as HaggleListing[];
  return listings;
}
