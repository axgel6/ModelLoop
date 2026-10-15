// Adding up the inventory, for the inventory window.
import type { InventoryItem } from "./types";

/** Totals for everything bought so far */
export function inventoryTotals(items: InventoryItem[]) {
  const spent = items.reduce((sum, i) => sum + (i.paid ?? 0), 0);
  const listed = items.reduce((sum, i) => sum + (i.list_price ?? 0), 0);
  const saved = items.reduce((sum, i) => sum + (i.saved ?? 0), 0);
  const soldItems = items.filter((i) => i.sold);
  const profit = soldItems.reduce((sum, i) => sum + (i.sold?.profit ?? 0), 0);
  return { spent, saved, share: listed > 0 ? Math.round((100 * saved) / listed) : 0, sold: soldItems.length, profit };
}

// The conditions a listing can state. Mirrors CONDITIONS in backend/games/negotiation/engine.py
export const CONDITIONS = ["New", "Used - Like New", "Used - Good", "Used - Fair", "For parts"];
