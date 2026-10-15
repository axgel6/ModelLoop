// The Hustle run: loading it, starting a new one, and the money words shared by its screens.
import { apiFetch } from "../../components/api";
import type { FreeBank, HustleRun, MarketProfile } from "./types";

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

/** The free play bank account, opened on first use */
export async function apiBank(): Promise<FreeBank> {
  const res = await apiFetch("/api/v1/games/negotiation/bank");
  if (!res.ok) throw new Error("I couldn't load your bank account.");
  return res.json();
}

/** Your marketplace profile: rating, trades, and reviews both ways */
export async function apiProfile(): Promise<MarketProfile> {
  const res = await apiFetch("/api/v1/games/negotiation/profile");
  if (!res.ok) throw new Error("I couldn't load your profile.");
  return res.json();
}

/** Free play: money in from nowhere, or out to it */
export async function apiMoveMoney(kind: "deposit" | "withdraw", amount: number): Promise<FreeBank> {
  const res = await apiFetch(`/api/v1/games/negotiation/bank/${kind}`, {
    method: "POST",
    body: JSON.stringify({ amount }),
  });
  if (!res.ok) {
    const detail = await res.json().then((b) => b?.detail).catch(() => null);
    throw new Error(typeof detail === "string" ? detail : `I couldn't ${kind} that.`);
  }
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
