// Loading the inventory and adding it up, shared by the menu and the inventory window.
import { apiFetch } from "../../components/api";
import type { InventoryItem } from "./types";

export async function apiInventory(): Promise<InventoryItem[]> {
  const res = await apiFetch("/api/v1/games/negotiation/inventory");
  if (!res.ok) throw new Error("I couldn't load your inventory.");
  return (await res.json()).items;
}

/** Totals for everything bought so far */
export function inventoryTotals(items: InventoryItem[]) {
  const spent = items.reduce((sum, i) => sum + (i.paid ?? 0), 0);
  const listed = items.reduce((sum, i) => sum + (i.list_price ?? 0), 0);
  const saved = items.reduce((sum, i) => sum + (i.saved ?? 0), 0);
  const soldItems = items.filter((i) => i.sold);
  const profit = soldItems.reduce((sum, i) => sum + (i.sold?.profit ?? 0), 0);
  return { spent, saved, share: listed > 0 ? Math.round((100 * saved) / listed) : 0, sold: soldItems.length, profit };
}
