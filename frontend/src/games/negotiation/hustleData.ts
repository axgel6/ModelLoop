// The Hustle run: loading it, starting a new one, and the money words shared by its screens.
import { apiFetch } from "../../components/api";
import type { HustleRun } from "./types";

export const HUSTLE_SCORES = "marketplace-hustle";

export interface HustleView {
  run: HustleRun | null;
  /** What each listing costs in this run, by listing id */
  prices: Record<string, number>;
  /** What each listing resells for in this run, by listing id */
  values?: Record<string, number>;
}

export async function apiHustle(): Promise<HustleView> {
  const res = await apiFetch("/api/v1/games/negotiation/hustle");
  if (!res.ok) throw new Error("I couldn't load your Hustle run.");
  return res.json();
}

export async function apiStartHustle(): Promise<HustleView> {
  const res = await apiFetch("/api/v1/games/negotiation/hustle", { method: "POST" });
  if (!res.ok) throw new Error("I couldn't start a new run.");
  return res.json();
}

export function money(amount: number): string {
  const whole = Math.round(amount);
  return `${whole < 0 ? "-" : ""}$${Math.abs(whole).toLocaleString("en-US")}`;
}

/** A profit or loss, with its sign */
export function signedMoney(amount: number): string {
  return `${amount < 0 ? "-" : "+"}${money(Math.abs(amount))}`;
}
