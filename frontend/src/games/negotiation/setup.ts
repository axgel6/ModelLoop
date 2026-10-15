// The choices on the start screen. What is for sale comes from the server (backend/games/negotiation/scenarios.py).
import type { GivenReview, HaggleListing, SellerProfile } from "./types";

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

/** Listings with the stars you gave their sellers counted in. Mirrors with_yours in backend/games/negotiation/reviews.py */
export function withYourStars(all: HaggleListing[], given?: GivenReview[] | null): HaggleListing[] {
  const yours = new Map<string, number[]>();
  for (const g of given ?? []) {
    if (g.role === "buy" && g.listing) yours.set(g.listing, [...(yours.get(g.listing) ?? []), g.stars]);
  }
  if (yours.size === 0) return all;
  return all.map((l) => {
    const stars = yours.get(l.id);
    if (!stars || !l.seller) return l;
    const count = l.seller.ratings + stars.length;
    const rating = Math.round((10 * (l.seller.rating * l.seller.ratings + stars.reduce((a, b) => a + b, 0))) / count) / 10;
    return { ...l, seller: { ...l.seller, rating, ratings: count } };
  });
}

/** A seller's name with their stars, as listings show it: "Ashley Monroe ★ 1.8" */
export function sellerLine(merchant: string, seller?: SellerProfile | null): string {
  return seller ? `${merchant} ★ ${seller.rating.toFixed(1)}` : merchant;
}
