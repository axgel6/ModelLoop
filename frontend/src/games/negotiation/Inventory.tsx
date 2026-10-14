import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useEscapeKey } from "../../components/useEscapeKey";
import { inventoryTotals } from "./inventoryData";
import type { InventoryItem } from "./types";

const SORTS = {
  newest: "Newest first",
  oldest: "Oldest first",
  paid: "Most paid",
  saved: "Biggest savings",
  score: "Best deals",
} as const;
type Sort = keyof typeof SORTS;

function money(amount: number): string {
  return `$${Math.round(amount).toLocaleString("en-US")}`;
}

function when(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** Everything bought in Negotiation, with what was paid and everything the listing said */
export function Inventory({
  items,
  onClose,
  onSell,
}: {
  items: InventoryItem[];
  onClose: () => void;
  /** Put something up for sale */
  onSell: (item: InventoryItem) => void;
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("newest");
  useEscapeKey(onClose);

  const totals = inventoryTotals(items);
  const shown = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const matches = items.filter((i) => {
      const text = `${i.title} ${i.description ?? ""} ${i.merchant} ${i.category ?? ""}`.toLowerCase();
      return words.every((word) => text.includes(word));
    });
    const by = (key: (i: InventoryItem) => number) => [...matches].sort((a, b) => key(b) - key(a));
    if (sort === "oldest") return [...matches].reverse();
    if (sort === "paid") return by((i) => i.paid ?? 0);
    if (sort === "saved") return by((i) => i.saved ?? 0);
    if (sort === "score") return by((i) => i.score);
    return matches;
  }, [items, query, sort]);

  return createPortal(
    <div className="chat-preferences-modal-overlay" onClick={onClose}>
      <div
        className="landing-theme-modal neg-browser"
        role="dialog"
        aria-label="Your inventory"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="landing-theme-modal-header">
          <span>Your inventory</span>
          <button type="button" className="landing-theme-modal-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="neg-inventory-totals">
          <Total label="Items" value={String(items.length)} />
          <Total label="Spent" value={money(totals.spent)} />
          <Total label="Saved" value={money(totals.saved)} />
          {totals.sold > 0 ? (
            <Total label={`Profit on ${totals.sold} sold`} value={`${totals.profit < 0 ? "-" : "+"}${money(Math.abs(totals.profit))}`} />
          ) : (
            <Total label="Off list" value={`${totals.share}%`} />
          )}
        </div>

        {items.length > 0 && (
          <div className="neg-browser-bar">
            <input
              className="pref-search-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search your inventory"
              aria-label="Search your inventory"
            />
            <label className="neg-select">
              <span>Sort</span>
              <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
                {(Object.keys(SORTS) as Sort[]).map((s) => (
                  <option key={s} value={s}>
                    {SORTS[s]}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

        <div className="neg-inventory-list">
          {shown.map((i) => (
            <article key={i.id} className={`neg-inventory-item${i.sold ? " is-sold" : ""}`}>
              <div className="neg-listing-head">
                <span className="pref-item-name">{i.title}</span>
                <span className="pref-content-badge">{i.sold ? "Sold" : i.paid != null ? money(i.paid) : ""}</span>
              </div>
              <span className="msg-timestamp">
                {[i.condition, i.category, `Bought from ${i.merchant}`, i.setting?.split("·").pop()?.trim(), when(i.bought_at)]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
              <span className="neg-inventory-deal">
                Listed at {money(i.list_price)}
                {i.saved != null && i.saved > 0 ? `, you saved ${money(i.saved)}` : ", you paid the asking price"}
                {` · ${i.rating} · ${i.score} of 100`}
                {i.rounds != null ? ` · ${i.rounds} ${i.rounds === 1 ? "round" : "rounds"}` : ""}
                {i.difficulty && i.difficulty !== "normal" ? ` · ${i.difficulty}` : ""}
              </span>
              {i.sold && (
                <span className="neg-inventory-deal">
                  Sold to {i.sold.buyer} for {money(i.sold.price)} · {i.sold.rating}
                  {i.sold.profit != null && ` · ${i.sold.profit < 0 ? "a loss of" : "a profit of"} ${money(Math.abs(i.sold.profit))}`}
                </span>
              )}
              {i.description && <p className="pref-item-desc">{i.description}</p>}
              {!i.sold && (
                <button type="button" className="neg-chip neg-sell" onClick={() => onSell(i)}>
                  Sell it
                </button>
              )}
            </article>
          ))}
          {items.length === 0 && (
            <p className="pref-setting-hint neg-browser-empty">
              Nothing here yet. Close a deal and pay for it, and it will be kept here.
            </p>
          )}
          {items.length > 0 && shown.length === 0 && (
            <p className="pref-setting-hint neg-browser-empty">Nothing in your inventory matches that.</p>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Total({ label, value }: { label: string; value: string }) {
  return (
    <div className="neg-inventory-total">
      <span className="neg-inventory-total-value">{value}</span>
      <span className="pref-setting-hint">{label}</span>
    </div>
  );
}
