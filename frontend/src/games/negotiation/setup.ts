// The choices on the start screen. What is for sale comes from the server (backend/games/negotiation/scenarios.py).
import type { Buzz, GivenReview, HaggleListing, SellerProfile } from "./types";

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

// (prices under this, move by this). Mirrors _STEPS in backend/games/negotiation/engine.py
const STEPS: [number, number][] = [[200, 1], [1000, 5], [5000, 25], [50_000, 50], [250_000, 500], [2_000_000, 1000], [20_000_000, 10_000]];

/** A saved listing's price after it dropped to `cut` of its usual price, rounded as the seller would say it */
export function droppedPrice(price: number, cut: number): number {
  const step = STEPS.find(([under]) => price < under)?.[1] ?? 100_000;
  return Math.ceil((price * cut) / step) * step;
}

/** What boosting a listing costs. Mirrors BOOSTS in backend/games/negotiation/market.py */
export const BOOSTS = [
  { level: 0, label: "No boost", share: 0, least: 0, most: 0, blurb: "The usual buyers." },
  { level: 1, label: "Boost", share: 0.03, least: 5, most: 300, blurb: "One more buyer, and big spenders twice as likely." },
  { level: 2, label: "Top boost", share: 0.06, least: 12, most: 900, blurb: "Two more buyers, big spenders three times as likely, more rival offers." },
] as const;

export function boostFee(level: number, asking: number): number {
  const b = BOOSTS[level];
  return b && b.share ? Math.min(b.most, Math.max(b.least, Math.round(asking * b.share))) : 0;
}

// What gets authenticated, and what it costs. Mirrors AUTH_CATEGORIES and auth_fee in market.py
const AUTH_CATEGORIES = new Set([
  "Bags", "Jewelry", "Fragrance", "Clothing and shoes", "Apple and phones", "Marvel and comics",
  "Art and rare finds", "Music and merch", "Home and collectables", "Games", "Consoles", "Cameras and video",
  "Vintage", "Books",
]);

export function canAuthenticate(item: { category?: string | null; condition?: string | null; item?: string; title?: string }): boolean {
  const name = (item.item ?? item.title ?? "").toLowerCase();
  return AUTH_CATEGORIES.has(item.category ?? "") || item.condition === "New" || name.includes("signed") || name.includes("sealed");
}

export function authFee(price: number): number {
  return Math.min(300, Math.max(10, Math.round(price * 0.02)));
}

/** How busy a listing is, as a listing shows it: "Just listed · 38 views · 6 saved" */
export function buzzLine(b?: Buzz | null): string {
  if (!b) return "";
  const [views, saves, fresh] = b;
  return [fresh ? "Just listed" : "", `${views} ${views === 1 ? "view" : "views"}`, saves ? `${saves} saved` : ""]
    .filter(Boolean)
    .join(" · ");
}
