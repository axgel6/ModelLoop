// The choices on the start screen. What is for sale comes from the server (backend/games/negotiation/scenarios.py).
import type { HaggleListing, SellerProfile } from "./types";

/** How many listings are offered at a time on the start screen; the rest are a refresh away */
export const LISTINGS_SHOWN = 5;

/** A fresh handful to choose from, avoiding the ones on screen now where there are enough others */
export function dealListings(all: HaggleListing[], showing: string[] = []): HaggleListing[] {
  const shuffled = (list: HaggleListing[]) =>
    list
      .map((listing) => ({ listing, order: Math.random() }))
      .sort((a, b) => a.order - b.order)
      .map((entry) => entry.listing);
  const fresh = shuffled(all.filter((l) => !showing.includes(l.id)));
  const seen = shuffled(all.filter((l) => showing.includes(l.id)));
  return [...fresh, ...seen].slice(0, LISTINGS_SHOWN);
}

/** A seller's name with their stars, as listings show it: "Ashley Monroe ★ 1.8" */
export function sellerLine(merchant: string, seller?: SellerProfile | null): string {
  return seller ? `${merchant} ★ ${seller.rating.toFixed(1)}` : merchant;
}
