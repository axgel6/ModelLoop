import { useCallback, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useEscapeKey } from "../../components/useEscapeKey";
import { BackButton } from "../BackButton";
import { Avatar } from "./Avatar";
import { avatarSeed } from "./avatarSeed";
import { SaveHeart } from "./SaveHeart";
import { buzzLine, sellerLine } from "./setup";
import type { Buzz, HaggleListing } from "./types";

const SORTS = {
  featured: "Featured",
  cheap: "Price: low to high",
  dear: "Price: high to low",
  name: "Name: A to Z",
} as const;
type Sort = keyof typeof SORTS;

const ALL = "All";

// Price ranges, by the asking price, sized so each holds a fair share of the catalogue
const PRICES = [
  { label: "Under $100", min: 0, max: 100 },
  { label: "$100 to $250", min: 100, max: 250 },
  { label: "$250 to $500", min: 250, max: 500 },
  { label: "$500 to $1,000", min: 500, max: 1000 },
  { label: "$1,000 to $5,000", min: 1000, max: 5000 },
  { label: "$5,000 to $100,000", min: 5000, max: 100_000 },
  { label: "$100,000 to $1M", min: 100_000, max: 1_000_000 },
  { label: "$1M to $25M", min: 1_000_000, max: 25_000_000 },
  { label: "$25M and up", min: 25_000_000, max: Infinity },
];

function money(amount: number): string {
  return `$${Math.round(amount).toLocaleString("en-US")}`;
}

/** Every listing in one window: search it, narrow it by category, condition or price, sort it,
 * open one to see the seller and everything the listing says, and message them from there. */
export function ListingBrowser({
  listings,
  selected,
  busy,
  error,
  note,
  saved,
  onSave,
  buzzOf,
  onMessage,
  onClose,
}: {
  listings: HaggleListing[];
  selected: string | null;
  /** Opening a chat */
  busy: boolean;
  error: string;
  /** What messaging a seller costs, such as a Hustle day or the chat still on the table */
  note?: string;
  /** The listings saved, by id, and the heart that saves one */
  saved: Set<string>;
  onSave: (listing: HaggleListing) => void;
  /** How busy a listing is today */
  buzzOf: (id: string) => Buzz | null;
  /** Message the seller now */
  onMessage: (listing: HaggleListing) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState(ALL);
  const [condition, setCondition] = useState(ALL);
  // An index into PRICES, or null for any price
  const [price, setPrice] = useState<number | null>(null);
  const [sort, setSort] = useState<Sort>("featured");
  const [savedOnly, setSavedOnly] = useState(false);
  // The listing open in full; the list keeps its search and filters behind it
  const [viewing, setViewing] = useState<HaggleListing | null>(null);
  const back = useCallback(() => setViewing(null), []);
  useEscapeKey(viewing ? back : onClose);

  // Alphabetical, each with how many listings it holds
  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const l of listings) if (l.category) counts.set(l.category, (counts.get(l.category) ?? 0) + 1);
    return [...counts].sort(([a], [b]) => a.localeCompare(b));
  }, [listings]);
  const conditions = useMemo(
    () => [...new Set(listings.map((l) => l.condition).filter((c): c is string => !!c))].sort(),
    [listings],
  );

  const shown = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const matches = listings.filter((l) => {
      if (savedOnly && !saved.has(l.id)) return false;
      if (category !== ALL && l.category !== category) return false;
      if (condition !== ALL && l.condition !== condition) return false;
      if (price !== null && !(l.list_price >= PRICES[price].min && l.list_price < PRICES[price].max)) return false;
      const text = `${l.item} ${l.description} ${l.merchant} ${l.category}`.toLowerCase();
      return words.every((word) => text.includes(word));
    });
    if (sort === "cheap") return [...matches].sort((a, b) => a.list_price - b.list_price);
    if (sort === "dear") return [...matches].sort((a, b) => b.list_price - a.list_price);
    if (sort === "name") return [...matches].sort((a, b) => a.item.localeCompare(b.item));
    return matches;
  }, [listings, query, category, condition, price, sort, savedOnly, saved]);

  // On the page itself, not inside the game: the game's panels would clip a fixed overlay
  return createPortal(
    <div className="chat-preferences-modal-overlay" onClick={onClose}>
      <div
        className="landing-theme-modal neg-browser"
        role="dialog"
        aria-label={viewing ? viewing.item : "All listings"}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="landing-theme-modal-header">
          {viewing ? (
            <span className="neg-detail-back">
              <BackButton label="Back to all listings" onClick={back} />
              All listings
            </span>
          ) : (
            <span>All listings</span>
          )}
          <button type="button" className="landing-theme-modal-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        {viewing ? (
          <ListingDetail
            listing={viewing}
            busy={busy}
            error={error}
            note={note}
            saved={saved.has(viewing.id)}
            buzz={buzzOf(viewing.id)}
            onMessage={() => onMessage(viewing)}
            onSave={() => onSave(viewing)}
          />
        ) : (
          <>
            <input
              className="pref-search-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search listings"
              aria-label="Search listings"
              autoFocus
            />

            <div className="neg-browser-filters">
              <label className="neg-select">
                <span>Category</span>
                <select value={category} onChange={(e) => setCategory(e.target.value)}>
                  <option value={ALL}>All ({listings.length})</option>
                  {categories.map(([c, n]) => (
                    <option key={c} value={c}>
                      {c} ({n})
                    </option>
                  ))}
                </select>
              </label>
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
                <span>Price</span>
                <select
                  value={price ?? ""}
                  onChange={(e) => setPrice(e.target.value === "" ? null : Number(e.target.value))}
                >
                  <option value="">Any</option>
                  {PRICES.map((r, i) => (
                    <option key={r.label} value={i}>
                      {r.label}
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

            <div className="neg-browser-count-row">
              <span className="pref-setting-hint neg-browser-count">
                {shown.length} {shown.length === 1 ? "listing" : "listings"}
              </span>
              <button
                type="button"
                className={`neg-chip neg-saved-filter${savedOnly ? " is-on" : ""}`}
                aria-pressed={savedOnly}
                onClick={() => setSavedOnly((v) => !v)}
                disabled={saved.size === 0 && !savedOnly}
              >
                Saved {saved.size > 0 ? `(${saved.size})` : ""}
              </button>
            </div>

            <div className="pref-account-card neg-browser-list">
              {shown.map((l) => (
                <div
                  key={l.id}
                  className={`pref-list-item${l.id === selected ? " active" : ""}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => setViewing(l)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setViewing(l);
                    }
                  }}
                >
                  <div className="pref-item-icon neg-face">
                    <Avatar seed={avatarSeed(l.merchant, l.id)} />
                  </div>
                  <div className="pref-item-info">
                    <div className="pref-item-name">{l.item}</div>
                    <div className="pref-item-desc">
                      {[`Resells for about ${money(l.value)}`, l.condition, l.category, sellerLine(l.merchant, l.seller), l.setting.split("·").pop()?.trim(), buzzLine(buzzOf(l.id))]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </div>
                  <SaveHeart saved={saved.has(l.id)} onSave={() => onSave(l)} />
                  <span className="pref-content-badge">{money(l.list_price)}</span>
                </div>
              ))}
              {shown.length === 0 && (
                <p className="pref-setting-hint neg-browser-empty">
                  {savedOnly ? "Nothing saved matches. Tap a heart to save a listing." : "Nothing matches. Try a different search, category or price."}
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** One listing in full: the item, everything it says, and the seller behind it */
function ListingDetail({
  listing: l,
  busy,
  error,
  note,
  saved,
  buzz,
  onMessage,
  onSave,
}: {
  listing: HaggleListing;
  busy: boolean;
  error: string;
  note?: string;
  saved: boolean;
  buzz: Buzz | null;
  onMessage: () => void;
  onSave: () => void;
}) {
  const delivery = l.setting.split("·").pop()?.trim();
  const seller = l.seller;
  return (
    <div className="neg-detail">
      <div className="neg-detail-head">
        <h3 className="neg-detail-title">{l.item}</h3>
        <span className="neg-detail-price">{money(l.list_price)}</span>
      </div>

      <dl className="neg-detail-facts">
        {l.condition && <Fact label="Condition" value={l.condition} />}
        <Fact label="Category" value={l.category} />
        {delivery && <Fact label="Delivery" value={delivery} />}
        <Fact label="Resells for" value={`About ${money(l.value)}`} />
        {buzz && <Fact label="Today" value={buzzLine(buzz)} />}
      </dl>

      <section className="neg-detail-section">
        <h4 className="pref-field-label">Description</h4>
        <p className="neg-detail-description">{l.description}</p>
      </section>

      <section className="neg-detail-section">
        <h4 className="pref-field-label">Seller</h4>
        <div className="pref-account-card neg-detail-seller">
          <div className="pref-item-icon neg-face neg-face--head">
            <Avatar seed={avatarSeed(l.merchant, l.id)} size={44} />
          </div>
          <div className="pref-item-info">
            <div className="pref-item-name">{l.merchant}</div>
            {seller ? (
              <>
                <div className="pref-item-desc">
                  <span className="neg-detail-stars" aria-hidden="true">
                    {"★".repeat(Math.round(seller.rating))}
                    {"☆".repeat(5 - Math.round(seller.rating))}
                  </span>{" "}
                  {seller.rating.toFixed(1)} from {seller.ratings} {seller.ratings === 1 ? "rating" : "ratings"}
                </div>
                <div className="pref-item-desc">
                  Joined in {seller.joined} · Usually replies {seller.replies}
                </div>
              </>
            ) : (
              <div className="pref-item-desc">Marketplace seller</div>
            )}
          </div>
        </div>
      </section>

      {error && <p className="neg-error">{error}</p>}

      <div className="neg-detail-actions">
        <button type="button" className="start-button" onClick={onMessage} disabled={busy}>
          {busy ? "Opening the chat" : `Message ${l.merchant}`}
        </button>
        <button type="button" className={`neg-detail-save${saved ? " is-on" : ""}`} onClick={onSave} aria-pressed={saved}>
          {saved ? "Saved" : "Save"}
        </button>
      </div>
      {note && <span className="pref-setting-hint neg-detail-note">{note}</span>}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="neg-detail-fact">
      <dt className="pref-setting-hint">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
