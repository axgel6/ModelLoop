import { Avatar } from "./Avatar";
import { avatarSeed } from "./avatarSeed";
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useEscapeKey } from "../../components/useEscapeKey";
import type { HaggleListing } from "./types";

const SORTS = {
  featured: "Featured",
  cheap: "Price: low to high",
  dear: "Price: high to low",
  name: "Name: A to Z",
} as const;
type Sort = keyof typeof SORTS;

const ALL = "All";

function money(amount: number): string {
  return `$${Math.round(amount).toLocaleString("en-US")}`;
}

/** Every listing in one window: search it, narrow it by category or condition, sort it, pick one. */
export function ListingBrowser({
  listings,
  selected,
  onPick,
  onClose,
}: {
  listings: HaggleListing[];
  selected: string | null;
  onPick: (listing: HaggleListing) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState(ALL);
  const [condition, setCondition] = useState(ALL);
  const [sort, setSort] = useState<Sort>("featured");
  useEscapeKey(onClose);

  // In the order the server lists them, which is also the order of the chips
  const categories = useMemo(() => [...new Set(listings.map((l) => l.category).filter(Boolean))], [listings]);
  const conditions = useMemo(
    () => [...new Set(listings.map((l) => l.condition).filter((c): c is string => !!c))].sort(),
    [listings],
  );

  const shown = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const matches = listings.filter((l) => {
      if (category !== ALL && l.category !== category) return false;
      if (condition !== ALL && l.condition !== condition) return false;
      const text = `${l.item} ${l.description} ${l.merchant} ${l.category}`.toLowerCase();
      return words.every((word) => text.includes(word));
    });
    if (sort === "cheap") return [...matches].sort((a, b) => a.list_price - b.list_price);
    if (sort === "dear") return [...matches].sort((a, b) => b.list_price - a.list_price);
    if (sort === "name") return [...matches].sort((a, b) => a.item.localeCompare(b.item));
    return matches;
  }, [listings, query, category, condition, sort]);

  // On the page itself, not inside the game: the game's panels would clip a fixed overlay
  return createPortal(
    <div className="chat-preferences-modal-overlay" onClick={onClose}>
      <div
        className="landing-theme-modal neg-browser"
        role="dialog"
        aria-label="All listings"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="landing-theme-modal-header">
          <span>All listings</span>
          <button type="button" className="landing-theme-modal-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <input
          className="pref-search-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search listings"
          aria-label="Search listings"
          autoFocus
        />

        <div className="neg-browser-chips" role="radiogroup" aria-label="Category">
          {[ALL, ...categories].map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={c === category}
              className={`neg-chip${c === category ? " is-on" : ""}`}
              onClick={() => setCategory(c)}
            >
              {c}
            </button>
          ))}
        </div>

        <div className="neg-browser-bar">
          <span className="pref-setting-hint">
            {shown.length} {shown.length === 1 ? "listing" : "listings"}
          </span>
          <label className="neg-select">
            <span>Condition</span>
            <select value={condition} onChange={(e) => setCondition(e.target.value)}>
              <option value={ALL}>Any</option>
              {conditions.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
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

        <div className="pref-account-card neg-browser-list">
          {shown.map((l) => (
            <div
              key={l.id}
              className={`pref-list-item${l.id === selected ? " active" : ""}`}
              role="button"
              tabIndex={0}
              onClick={() => onPick(l)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onPick(l);
                }
              }}
            >
              <div className="pref-item-icon neg-face">
                <Avatar seed={avatarSeed(l.merchant, l.id)} />
              </div>
              <div className="pref-item-info">
                <div className="pref-item-name">{l.item}</div>
                <div className="pref-item-desc">
                  {[`Resells for about ${money(l.value)}`, l.condition, l.category, l.merchant, l.setting.split("·").pop()?.trim()]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              </div>
              <span className="pref-content-badge">{money(l.list_price)}</span>
            </div>
          ))}
          {shown.length === 0 && <p className="pref-setting-hint neg-browser-empty">Nothing matches. Try a different search or category.</p>}
        </div>
      </div>
    </div>,
    document.body,
  );
}
