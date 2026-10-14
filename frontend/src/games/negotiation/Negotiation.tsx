import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import {
  apiCreateGame,
  apiEditGame,
  apiGameChat,
  apiGameScores,
  apiGetGame,
  apiListGames,
  apiPlayTurn,
  type GameSave,
  type GameSaveSummary,
  type GameScoreRow,
} from "../api";
import { apiFetch } from "../../components/api";
import { useEscapeKey } from "../../components/useEscapeKey";
import { sounds } from "../../sounds";
import { createPortal } from "react-dom";
import { BackButton } from "../BackButton";
import type { GameProps } from "../types";
import { Bank } from "./Bank";
import { CustomListingForm } from "./CustomListingForm";
import {
  HUSTLE_SCORES,
  apiBank,
  apiHustle,
  apiMoveMoney,
  apiStartHustle,
  money,
  signedMoney,
  type HustleView,
} from "./hustleData";
import { Inventory } from "./Inventory";
import { apiInventory } from "./inventoryData";
import { ListingBrowser } from "./ListingBrowser";
import { LISTINGS_SHOWN, dealListings } from "./setup";
import type {
  CustomListing,
  FreeBank,
  HaggleEntry,
  HaggleListing,
  HaggleMode,
  HaggleState,
  HaggleSummary,
  HustleRun,
  InventoryItem,
} from "./types";
import "./negotiation.css";

const GAME_TYPE = "negotiation";
// Sales are scored apart from purchases
const SALE_SCORES = "negotiation-sale";
// What is sent when the player bluffs without typing anything. The server uses the same lines.
const BLUFF_MESSAGE = "I think I'll leave it. Thanks anyway.";
const SELL_BLUFF_MESSAGE = "Just a heads up, someone else is coming to look at it later today.";
// The haggle happens in the marketplace chat, so what gives the seller away is how they reply, not how they look.
// The faster the answer, the more room is left in the price.
// How long the payment button stays armed after the first tap
const DOUBLE_TAP_MS = 1200;
// Terms other than money, each offered once per chat. Mirrors SWEETENERS in backend/games/negotiation/extras.py
const SWEETENERS = {
  buy: [
    { id: "cash", label: "Cash, today", said: "I can pay cash, today." },
    { id: "pickup", label: "Pick up now", said: "I can come pick it up right now." },
    { id: "shipping", label: "Cover shipping", said: "I'll cover the shipping." },
  ],
  sell: [
    { id: "dropoff", label: "Drop it off", said: "I can drop it off to you." },
    { id: "hold", label: "Hold it for you", said: "I'll hold it for you, no one else gets it." },
    { id: "anytime", label: "Pickup any time", said: "Pick it up whenever suits you." },
  ],
} as const;
// Checking sold listings costs this much in a Hustle run, as RESEARCH_FEE in hustle.py
const RESEARCH_FEE = 5;
// How long a slow or hesitant reply keeps you waiting, so the pace itself gives something away
const SLOW_REPLY_MS = 1200;
const HESITANT_PAUSE_MS = 900;
const wait = (ms: number) => new Promise((done) => window.setTimeout(done, ms));
const TELLS = {
  quick: "They replied straight away.",
  slow: "They took a while to reply.",
  hesitant: "They started typing, stopped, then started again.",
} as const;

type HaggleSave = GameSave<HaggleState>;


export function Negotiation({ model, onExit }: GameProps) {
  const [save, setSave] = useState<HaggleSave | null>(null);
  // Leaving a finished purchase can go straight to the inventory
  const [showInventory, setShowInventory] = useState(false);
  // Free play or a Hustle run, kept while the player goes in and out of chats
  const [play, setPlay] = useState<"free" | "hustle">("free");

  if (save)
    return (
      <Play
        save={save}
        model={model}
        onSave={setSave}
        onLeave={(toInventory) => {
          setSave(null);
          setShowInventory(toInventory);
        }}
      />
    );
  return (
    <Menu onOpen={setSave} onExit={onExit} startInInventory={showInventory} play={play} onPlay={setPlay} />
  );
}

// ---- Menu: pick what to buy ----

function Menu({
  onOpen,
  onExit,
  startInInventory,
  play,
  onPlay,
}: {
  onOpen: (save: HaggleSave) => void;
  onExit: () => void;
  startInInventory: boolean;
  play: "free" | "hustle";
  onPlay: (play: "free" | "hustle") => void;
}) {
  const [hustle, setHustle] = useState<HustleView | null>(null);
  const [hustleScores, setHustleScores] = useState<GameScoreRow[]>([]);
  const [bankOpen, setBankOpen] = useState(false);
  // Free play has its own account, apart from any Hustle run
  const [freeBank, setFreeBank] = useState<FreeBank | null>(null);
  const [freeBankOpen, setFreeBankOpen] = useState(false);
  const [showScores, setShowScores] = useState(false);
  const [mode, setMode] = useState<HaggleMode>("buy");
  const [inventory, setInventory] = useState<InventoryItem[] | null>(null);
  const [inventoryOpen, setInventoryOpen] = useState(startInInventory);
  const [customOpen, setCustomOpen] = useState(false);
  // Selling: which purchase, and the price it goes up at
  const [sellPick, setSellPick] = useState<string | null>(null);
  const [asking, setAsking] = useState("");
  // Free play: the listing's description, rewritten as the player likes. Hustle: notes added under it
  const [listingText, setListingText] = useState("");
  const [saleScores, setSaleScores] = useState<GameScoreRow[]>([]);
  const [unfinished, setUnfinished] = useState<GameSaveSummary<HaggleSummary> | null>(null);
  const [scores, setScores] = useState<GameScoreRow[]>([]);
  // null is "Surprise me": the server deals a scenario
  const [scenario, setScenario] = useState<string | null>(null);
  // Everything for sale, and the handful on screen; the refresh button deals another
  const [listings, setListings] = useState<HaggleListing[]>([]);
  const [offered, setOffered] = useState<HaggleListing[]>([]);
  const [browsing, setBrowsing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    apiListGames<HaggleSummary>(GAME_TYPE)
      .then((saves) => setUnfinished(saves.find((s) => s.summary.status === "active" || s.summary.status === "choosing") ?? null))
      .catch(() => setUnfinished(null));
    apiGameScores(GAME_TYPE)
      .then(setScores)
      .catch(() => setScores([]));
    apiGameScores(SALE_SCORES)
      .then(setSaleScores)
      .catch(() => setSaleScores([]));
    apiGameScores(HUSTLE_SCORES)
      .then(setHustleScores)
      .catch(() => setHustleScores([]));
    apiHustle()
      .then(setHustle)
      .catch(() => setHustle({ run: null, prices: {} }));
    apiInventory()
      .then(setInventory)
      .catch(() => setInventory([]));
    apiBank()
      .then(setFreeBank)
      .catch(() => setFreeBank(null));
    // Without the list there is still "Surprise me", which the server deals itself
    apiFetch("/api/v1/games/negotiation/listings")
      .then((res) => (res.ok ? res.json() : { listings: [] }))
      .then(({ listings: all }: { listings: HaggleListing[] }) => {
        setListings(all);
        setOffered(dealListings(all));
      })
      .catch(() => {});
  }, []);

  // In a Hustle run, everything comes from the run: its holdings, its prices, its balance
  const hustleRun: HustleRun | null = play === "hustle" ? (hustle?.run ?? null) : null;
  const live = hustleRun?.status === "active" ? hustleRun : null;
  const items = live ? live.holdings : (inventory ?? []);
  const priceOf = (l: HaggleListing) => (live ? (hustle?.prices[l.id] ?? l.list_price) : l.list_price);
  const valueOf = (l: HaggleListing) => (live ? (hustle?.values?.[l.id] ?? l.value) : l.value);
  const browsable = live
    ? listings.map((l) => ({ ...l, list_price: priceOf(l), value: hustle?.values?.[l.id] ?? l.value }))
    : listings;
  const unsold = items.filter((i) => !i.sold);
  const picked = unsold.find((i) => i.id === sellPick) ?? null;
  const askingValue = Math.round(Number(asking));
  const categories = [...new Set(listings.map((l) => l.category).filter(Boolean))];

  const startRun = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      setHustle(await apiStartHustle());
      setMode("buy");
      setSellPick(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  // A Hustle item's own description, which the player's notes follow on from and cannot change
  const lockedText = (item: InventoryItem | null) => (item?.description ? `${item.description}\n\n` : "");
  const locked = live ? lockedText(picked) : "";

  const pickToSell = (item: InventoryItem) => {
    setMode("sell");
    setSellPick(item.id);
    setAsking(String(item.value ?? item.list_price));
    setListingText(live ? lockedText(item) : (item.description ?? ""));
  };

  const run = async (load: () => Promise<HaggleSave>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      onOpen(await load());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setBusy(false);
    }
  };

  return (
    <div className="neg neg--menu">
      <div className="neg-menu">
        <div className="game-menu-head">
          <BackButton label="Back to all games" onClick={onExit} />
          <h2 className="neg-title">Marketplace</h2>
          <div className="neg-modes neg-plays" role="radiogroup" aria-label="How to play">
            {(["free", "hustle"] as const).map((p) => (
              <button
                key={p}
                type="button"
                role="radio"
                aria-checked={play === p}
                className={`neg-chip${play === p ? " is-on" : ""}`}
                onClick={() => onPlay(p)}
              >
                {p === "free" ? "Free play" : "Hustle"}
              </button>
            ))}
          </div>
        </div>
        {play === "hustle" && !live && (
          <HustlePanel run={hustleRun} busy={busy} scores={hustleScores} onStart={startRun} />
        )}
        {bankOpen && hustleRun && <Bank run={hustleRun} onClose={() => setBankOpen(false)} />}
        {live ? (
          <AccountBar
            cash={live.cash}
            detail={[`Day ${live.day} of ${live.days}`, stars(freeBank)].filter(Boolean).join(" · ")}
            progress={live.day / live.days}
            items={items.length}
            onBank={() => setBankOpen(true)}
            onInventory={() => setInventoryOpen(true)}
          />
        ) : (
          play === "free" &&
          freeBank && (
            <AccountBar
              cash={freeBank.cash}
              detail={[`Net worth ${money(freeBank.net_worth)}`, stars(freeBank)].filter(Boolean).join(" · ")}
              items={items.length}
              onBank={() => setFreeBankOpen(true)}
              onInventory={() => setInventoryOpen(true)}
            />
          )
        )}
        {live && (live.callbacks ?? []).length > 0 && (
          <>
            <h3 className="pref-field-label neg-section">Messages</h3>
            <div className="pref-account-card neg-card">
              {(live.callbacks ?? []).map((c) => (
                <div key={c.id} className="pref-list-item neg-row--static">
                  <div className="pref-item-icon">{c.merchant.charAt(0)}</div>
                  <div className="pref-item-info">
                    <div className="pref-item-name">
                      {c.merchant}: Still interested? I can do {money(c.price)} now.
                    </div>
                    <div className="pref-item-desc">
                      {c.item} · was {money(c.was)}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="start-button"
                    onClick={() => run(() => apiCreateGame<HaggleState>(GAME_TYPE, { callback: c.id, hustle: true }))}
                    disabled={busy}
                  >
                    Reply
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
        {freeBankOpen && freeBank && (
          <Bank
            free={freeBank}
            onMove={async (kind, amount) => setFreeBank(await apiMoveMoney(kind, amount))}
            onClose={() => setFreeBankOpen(false)}
          />
        )}

        {(play === "free" || live) && (
          <>
        <div className="neg-modes" role="radiogroup" aria-label="Buying or selling">
          {(["buy", "sell"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              className={`neg-chip${mode === m ? " is-on" : ""}`}
              onClick={() => setMode(m)}
            >
              {m === "buy" ? "Buying" : "Selling"}
            </button>
          ))}
        </div>

        {inventoryOpen && items.length > 0 && (
          <Inventory
            items={live ? [...items].reverse() : items}
            onClose={() => setInventoryOpen(false)}
            onSell={(item) => {
              pickToSell(item);
              setInventoryOpen(false);
            }}
          />
        )}
        {customOpen && (
          <CustomListingForm
            categories={categories}
            busy={busy}
            error={error}
            onClose={() => setCustomOpen(false)}
            onSubmit={(custom: CustomListing) =>
              run(() =>
                apiCreateGame<HaggleState>(GAME_TYPE, { mode: "sell", custom, asking: custom.price }),
              )
            }
          />
        )}

        {unfinished && (
          <>
            <h3 className="pref-field-label neg-section">Still on the table</h3>
            <div className="pref-account-card neg-card">
              <div className="pref-list-item neg-row--static">
                <div className="pref-item-icon">{unfinished.summary.merchant?.charAt(0) ?? unfinished.summary.prospects}</div>
                <div className="pref-item-info">
                  <div className="pref-item-name">{unfinished.summary.item}</div>
                  <div className="pref-item-desc">
                    {unfinished.summary.status === "choosing" || !unfinished.summary.merchant
                      ? `${unfinished.summary.prospects ?? "Some"} buyers waiting in your inbox`
                      : `${unfinished.summary.merchant} is ${unfinished.summary.mode === "sell" ? "offering" : "asking"} ${money(unfinished.summary.ask ?? 0)}`}
                  </div>
                </div>
                <button
                  type="button"
                  className="start-button"
                  onClick={() => run(() => apiGetGame<HaggleState>(unfinished.id))}
                  disabled={busy}
                >
                  Pick it back up
                </button>
              </div>
            </div>
          </>
        )}

        {mode === "buy" ? (
          <>
        <div className="neg-section-row">
          <h3 className="pref-field-label neg-section">Pick a listing</h3>
          <button
            type="button"
            className="neg-link neg-refresh neg-show-all"
            disabled={listings.length === 0}
            onClick={() => setBrowsing(true)}
          >
            Show all {browsable.length > 0 ? browsable.length : ""}
          </button>
          <button
            type="button"
            className="neg-link neg-refresh"
            disabled={listings.length === 0}
            title="Show me others"
            aria-label="Show me others"
            onClick={() => {
              setOffered((current) => dealListings(listings, current.map((s) => s.id)));
              setScenario(null); // the one that was picked may no longer be on the list
            }}
          >
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 12a9 9 0 1 1-2.64-6.36" />
              <path d="M21 3v6h-6" />
            </svg>
          </button>
        </div>
        <div className="pref-account-card neg-card">
          {offered.map((s) => (
            <Option
              key={s.id}
              icon={s.merchant.charAt(0)}
              name={s.item}
              desc={[
                live && priceOf(s) > live.cash ? "Over budget" : "",
                `Resells for ${money(valueOf(s))}`,
                s.condition,
                s.merchant,
              ]
                .filter(Boolean)
                .join(" · ")}
              badge={money(priceOf(s))}
              on={scenario === s.id}
              // Picking it again goes back to a random listing
              onPick={() => setScenario(scenario === s.id ? null : s.id)}
            />
          ))}
        </div>

        {browsing && (
          <ListingBrowser
            listings={browsable}
            selected={scenario}
            onClose={() => setBrowsing(false)}
            onPick={(listing) => {
              // The pick joins the handful on the start screen, at the top, if it was not there already
              setOffered((current) =>
                current.some((s) => s.id === listing.id) ? current : [listing, ...current].slice(0, LISTINGS_SHOWN),
              );
              setScenario(listing.id);
              setBrowsing(false);
            }}
          />
        )}

          </>
        ) : (
          <>
            <h3 className="pref-field-label neg-section">Pick something to sell</h3>
            <div className="pref-account-card neg-card">
              {unsold.map((i) => (
                <Option
                  key={i.id}
                  icon={i.title.charAt(0).toUpperCase()}
                  name={i.title}
                  desc={[i.paid != null ? `You paid ${money(i.paid)}` : "", i.condition, i.category].filter(Boolean).join(" · ")}
                  badge={money(i.value ?? i.list_price)}
                  on={sellPick === i.id}
                  onPick={() => pickToSell(i)}
                />
              ))}
              {unsold.length === 0 && (
                <div className="pref-list-item neg-row--static">
                  <div className="pref-item-info">
                    <div className="pref-item-name">Nothing to sell yet</div>
                    <div className="pref-item-desc">
                      {live ? "Buy something in this run first." : "Buy something first, or sell something of your own."}
                    </div>
                  </div>
                </div>
              )}
              {!live && (
                <Option
                  icon="+"
                  name="Something of your own"
                  desc="Write a listing for anything you like"
                  on={false}
                  onPick={() => setCustomOpen(true)}
                />
              )}
            </div>

            {picked && (
              <div className="neg-asking">
                <label className="neg-offer">
                  <span>Asking price $</span>
                  <input
                    value={asking}
                    onChange={(e) => setAsking(e.target.value.replace(/[^\d]/g, "").slice(0, 7))}
                    inputMode="numeric"
                    aria-label="Your asking price in dollars"
                  />
                </label>
                <span className="pref-setting-hint">
                  Resells for about {money(picked.value ?? picked.list_price)}
                  {picked.paid != null && ` · you paid ${money(picked.paid)}`}
                </span>
                {live ? (
                  <>
                    <textarea
                      className="neg-custom-description"
                      value={listingText}
                      onChange={(e) => e.target.value.startsWith(locked) && setListingText(e.target.value)}
                      maxLength={locked.length + 300}
                      rows={4}
                      aria-label="The listing's description, with your notes added at the end"
                      placeholder="Add your own notes: what is included, why it is a good deal."
                    />
                    <span className="pref-setting-hint">Add your notes at the end. Buyers will not believe claims that contradict the listing.</span>
                  </>
                ) : (
                  <textarea
                    className="neg-custom-description"
                    value={listingText}
                    onChange={(e) => setListingText(e.target.value)}
                    maxLength={600}
                    rows={3}
                    aria-label="The listing's description"
                    placeholder="Condition, what is included, any flaws. The buyer only knows what is written here."
                  />
                )}
              </div>
            )}
          </>
        )}

        {error && <p className="neg-error">{error}</p>}

        <div className="neg-start">
          {mode === "buy" ? (
            <button
              type="button"
              className="start-button"
              onClick={() =>
                run(() => apiCreateGame<HaggleState>(GAME_TYPE, { scenario, hustle: !!live }))
              }
              disabled={busy}
            >
              {busy ? "Opening the chat" : scenario ? "Message the seller" : "Message a random seller"}
            </button>
          ) : (
            <button
              type="button"
              className="start-button"
              onClick={() =>
                picked &&
                run(() =>
                  apiCreateGame<HaggleState>(GAME_TYPE, {
                    mode: "sell",
                    inventory_id: picked.id,
                    asking: askingValue > 0 ? askingValue : undefined,
                    ...(live
                      ? { notes: listingText.slice(locked.length).trim() || undefined }
                      : listingText.trim() !== (picked.description ?? "").trim()
                        ? { description: listingText.trim() }
                        : {}),
                    hustle: !!live,
                  }),
                )
              }
              disabled={busy || !picked || !(askingValue > 0)}
            >
              {busy ? "Posting" : "List it"}
            </button>
          )}
          {(unfinished || live) && (
            <span className="pref-setting-hint">
              {[live ? "Starting a chat uses a day." : "", unfinished ? "It drops the chat still on the table." : ""]
                .filter(Boolean)
                .join(" ")}
            </span>
          )}
        </div>

          </>
        )}

        {play === "free" && (mode === "sell" ? saleScores : scores).length > 0 && (
          <button type="button" className="neg-link neg-scores-toggle" onClick={() => setShowScores((v) => !v)}>
            {showScores ? "Hide" : "Show"} best {mode === "sell" ? "sales" : "deals"}
          </button>
        )}

        {showScores && play === "free" && mode === "sell" && saleScores.length > 0 && (
          <>
            <h3 className="pref-field-label neg-section">Best sales</h3>
            <div className="pref-account-card neg-card">
              {saleScores.map((row, i) => (
                <div key={row.id} className="pref-list-item neg-row--static">
                  <div className="pref-item-icon">{i + 1}</div>
                  <div className="pref-item-info">
                    <div className="pref-item-name">{row.title}</div>
                    <div className="pref-item-desc">
                      {row.paid != null ? `Sold for ${money(row.paid)}` : row.rating}
                      {row.buyer ? ` to ${row.buyer}` : ""}
                      {row.profit != null ? ` · ${signedMoney(row.profit)}` : ""}
                    </div>
                  </div>
                  <span className="pref-content-badge">{row.score}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {showScores && play === "free" && mode === "buy" && scores.length > 0 && (
          <>
            <h3 className="pref-field-label neg-section">Best deals</h3>
            <div className="pref-account-card neg-card">
              {scores.map((row, i) => (
                <div key={row.id} className="pref-list-item neg-row--static">
                  <div className="pref-item-icon">{i + 1}</div>
                  <div className="pref-item-info">
                    <div className="pref-item-name">{row.title}</div>
                    <div className="pref-item-desc">
                      {row.paid != null && row.list_price != null
                        ? `${money(row.paid)} from ${money(row.list_price)}`
                        : row.rating}
                      {row.merchant ? ` · ${row.merchant}` : ""}
                      {row.difficulty && row.difficulty !== "normal" ? ` · ${row.difficulty}` : ""}
                    </div>
                  </div>
                  <span className="pref-content-badge">{row.score}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** Your marketplace rating, once anyone has reviewed you */
function stars(profile: FreeBank | null): string {
  if (!profile?.rating) return "";
  return `${profile.rating.toFixed(1)} stars (${profile.review_count})`;
}

/** The money and the stuff: balance and inventory side by side, each opening its own window */
function AccountBar({
  cash,
  detail,
  progress,
  items,
  onBank,
  onInventory,
}: {
  cash: number;
  detail: string;
  /** Hustle: the share of the run's days used */
  progress?: number;
  items: number;
  onBank: () => void;
  onInventory: () => void;
}) {
  return (
    <div className="neg-account">
      <button type="button" className="neg-account-part" onClick={onBank}>
        <span className="neg-account-value">{money(cash)}</span>
        <span className="pref-item-desc">{detail}</span>
      </button>
      <button type="button" className="neg-account-part" onClick={onInventory} disabled={items === 0}>
        <span className="neg-account-value">
          {items} {items === 1 ? "item" : "items"}
        </span>
        <span className="pref-item-desc">{items === 0 ? "Nothing bought yet" : "Inventory"}</span>
      </button>
      {progress != null && (
        <div className="neg-days neg-account-days" aria-hidden="true">
          <span style={{ width: `${100 * progress}%` }} />
        </div>
      )}
    </div>
  );
}

/** Hustle, outside a run: how to start one, or how the last one went */
function HustlePanel({
  run,
  busy,
  scores,
  onStart,
}: {
  run: HustleRun | null;
  busy: boolean;
  scores: GameScoreRow[];
  onStart: () => void;
}) {
  return (
    <>
      <div className="pref-account-card neg-card neg-hustle-intro">
        {run?.result ? (
          <>
            <span className="pref-field-label">{run.status === "broke" ? "Out of money" : "Run over"}</span>
            <span className="neg-title">{run.result.rating}</span>
            <span className="pref-setting-hint">
              You turned {money(run.start_cash)} into {money(run.result.net_worth)} ({signedMoney(run.result.profit)}) in{" "}
              {run.result.days_used} days, buying {run.result.bought} and selling {run.result.sold}.
              {run.result.best_flip != null && ` Best flip ${signedMoney(run.result.best_flip)}.`}
            </span>
          </>
        ) : (
          <>
            <span className="neg-title">Hustle</span>
            <span className="pref-setting-hint">
              Start with {money(1000)} and {30} days. Every chat uses a day, whether you buy, sell or walk away. Buy
              low, sell high, and finish with as much as you can. Your score is your net worth: cash plus what you paid
              for anything you still hold.
            </span>
          </>
        )}
        <div className="neg-start">
          <button type="button" className="start-button" onClick={onStart} disabled={busy}>
            {busy ? "Opening an account" : run ? "Start a new run" : "Start a run"}
          </button>
        </div>
      </div>

      {scores.length > 0 && (
        <>
          <h3 className="pref-field-label neg-section">Best runs</h3>
          <div className="pref-account-card neg-card">
            {scores.map((row, i) => (
              <div key={row.id} className="pref-list-item neg-row--static">
                <div className="pref-item-icon">{i + 1}</div>
                <div className="pref-item-info">
                  <div className="pref-item-name">{row.rating}</div>
                  <div className="pref-item-desc">
                    {row.profit != null ? `${signedMoney(row.profit)} on ${money(1000)}` : ""}
                    {row.created_at ? ` · ${new Date(row.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : ""}
                  </div>
                </div>
                <span className="pref-content-badge">{money(row.score)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}

/** One choice in a list, laid out like a row of the Presets list */
function Option({
  icon,
  name,
  desc,
  badge,
  on,
  onPick,
}: {
  icon?: string;
  name: string;
  desc: string;
  badge?: string;
  on: boolean;
  onPick: () => void;
}) {
  return (
    <div
      className={`pref-list-item${on ? " active" : ""}`}
      role="radio"
      aria-checked={on}
      tabIndex={0}
      onClick={onPick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onPick();
        }
      }}
    >
      {icon && <div className="pref-item-icon">{icon}</div>}
      <div className="pref-item-info">
        <div className="pref-item-name">{name}</div>
        <div className="pref-item-desc">{desc}</div>
      </div>
      {badge && <span className="pref-content-badge">{badge}</span>}
      <div className={`pref-item-check${on ? " checked" : ""}`}>
        {on && <span className="pref-check-mark">✓</span>}
      </div>
    </div>
  );
}

// ---- Play: the haggle itself ----

function Play({
  save,
  model,
  onSave,
  onLeave,
}: {
  save: HaggleSave;
  model?: string;
  onSave: (next: HaggleSave) => void;
  /** `toInventory`: open the inventory on the way out */
  onLeave: (toInventory: boolean) => void;
}) {
  const state = save.state;
  const { scenario, result } = state;
  // Selling turns the screen round: they offer, you name prices, and they pay you
  const selling = state.mode === "sell";
  const bare = (amount: number) => (selling ? `I can do ${money(amount)}.` : `How about ${money(amount)}?`);
  const sold = result?.outcome === "deal" || result?.outcome === "sold";
  const [draft, setDraft] = useState("");
  const [offerDraft, setOfferDraft] = useState("");
  const [pending, setPending] = useState<{ text: string; offer?: number } | null>(null);
  // While a reply is on its way: typing, or a hesitant stop part way
  const [typing, setTyping] = useState<"typing" | "stopped">("typing");
  const [closing, setClosing] = useState(false);
  // The payment sheet is up: the price on the table, waiting for a double tap
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState("");
  const feedEnd = useRef<HTMLDivElement>(null);
  // A Hustle chat: the run's balance, shown in the header and checked before paying
  const [run, setRun] = useState<HustleRun | null>(null);
  const [bankOpen, setBankOpen] = useState(false);
  const inRun = !!state.run_id;
  // Free play: the free play account pays and gets paid instead
  const [freeBank, setFreeBank] = useState<FreeBank | null>(null);
  const balance = run ? run.cash : freeBank?.cash;
  // Talking on once the haggle is over
  const [chatting, setChatting] = useState(false);
  const [chatDraft, setChatDraft] = useState("");
  const [chatPending, setChatPending] = useState<string | null>(null);

  const refreshRun = useCallback(() => {
    if (!inRun) {
      apiBank()
        .then(setFreeBank)
        .catch(() => {});
      return;
    }
    apiHustle()
      .then(({ run: latest }) => setRun(latest && latest.id === state.run_id ? latest : null))
      .catch(() => {});
  }, [inRun, state.run_id]);

  useEffect(refreshRun, [refreshRun]);

  useEffect(() => {
    feedEnd.current?.scrollIntoView({ block: "end" });
  }, [state.log.length, pending, error, state.status, paying, state.after?.length, chatPending]);

  const offerValue = Math.round(Number(offerDraft));
  const offer = offerValue > 0 ? offerValue : undefined;
  const busy = !!pending || closing;

  const sweeteners = SWEETENERS[selling ? "sell" : "buy"];
  const ping = state.ping ?? null;

  // `bluff`: saying you are leaving to see if the price moves. It works once, and carries no offer.
  // `leverage`: holding up another buyer's real offer. `sweetener`: a term other than money.
  const play = async (move: { bluff?: boolean; leverage?: boolean; sweetener?: string } = {}) => {
    const text = draft.trim();
    const special = move.bluff || move.leverage || !!move.sweetener;
    if ((!special && !text && offer === undefined) || busy) return;
    const said = move.sweetener ? sweeteners.find((x) => x.id === move.sweetener)?.said : undefined;
    setPending(
      move.bluff
        ? { text: text || (selling ? SELL_BLUFF_MESSAGE : BLUFF_MESSAGE) }
        : move.leverage && ping
          ? { text: text || `${ping.merchant} just offered ${money(ping.offer)}. Can you beat that?` }
          : { text: text || said || bare(offer ?? 0), offer },
    );
    setTyping("typing");
    setError("");
    setDraft("");
    setOfferDraft("");
    try {
      const next = await apiPlayTurn<HaggleState>(
        save.id,
        text,
        model,
        undefined,
        move.bluff ? { bluff: true } : move.leverage ? { leverage: true } : { offer, sweetener: move.sweetener },
      );
      // A reply with little room left takes its time, and a hesitant one stops and starts again
      const tell = next.state.log.at(-1)?.tell;
      if (tell === "hesitant") {
        await wait(HESITANT_PAUSE_MS);
        setTyping("stopped");
        await wait(HESITANT_PAUSE_MS);
        setTyping("typing");
        await wait(HESITANT_PAUSE_MS);
      } else if (tell === "slow") {
        await wait(SLOW_REPLY_MS);
      }
      onSave(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setDraft(text);
      setOfferDraft(offer === undefined ? "" : String(offer));
    } finally {
      setPending(null);
    }
  };

  const send = (e: React.FormEvent) => {
    e.preventDefault();
    play();
  };

  // Instant moves outside a turn: no model call
  const edit = async (path: string) => {
    if (busy) return;
    setClosing(true);
    setError("");
    try {
      onSave(await apiEditGame<HaggleState>(save.id, path, {}));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setClosing(false);
      refreshRun();
    }
  };

  // Taking the price or walking away: settled by the server at once, no model involved
  const close = async (path: "accept" | "walk") => {
    if (busy) return;
    setClosing(true);
    setError("");
    try {
      const next = await apiEditGame<HaggleState>(save.id, path, {});
      if (next.state.result?.paid != null) sounds.play("pay");
      const pickup = next.state.result?.pickup?.kind;
      if (pickup === "counterfeit" || pickup === "fake_payment") window.setTimeout(() => sounds.play("warn"), 700);
      onSave(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setClosing(false);
      setPaying(false);
      refreshRun();
    }
  };

  const talk = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = chatDraft.trim();
    if (!text || chatPending) return;
    setChatPending(text);
    setChatDraft("");
    setError("");
    try {
      onSave(await apiGameChat<HaggleState>(save.id, text, model));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setChatDraft(text);
    } finally {
      setChatPending(null);
    }
  };

  if (state.status === "choosing")
    return <Inbox save={save} balance={balance} onSave={onSave} onLeave={() => onLeave(false)} />;

  return (
    <div className="neg neg--play">
      <div className="neg-head">
        <BackButton label="Back to marketplace" onClick={() => onLeave(false)} />
        <h2 className="neg-title">{scenario.item}</h2>
        {(run || freeBank) && (
          <button type="button" className="neg-link neg-balance" onClick={() => setBankOpen(true)} title="Bank account">
            {run ? `${money(run.cash)} · Day ${run.day}/${run.days}` : money(freeBank!.cash)}
          </button>
        )}
        {state.deadline && !result && (
          <span className="pref-content-badge neg-deadline" title="The seller needs it gone. It may sell to someone else.">
            {state.deadline.rounds} {state.deadline.rounds === 1 ? "message" : "messages"} left
          </span>
        )}
        {bankOpen && (run || freeBank) && (
          <Bank
            run={run ?? undefined}
            free={run ? undefined : (freeBank ?? undefined)}
            onMove={run ? undefined : async (kind, amount) => setFreeBank(await apiMoveMoney(kind, amount))}
            onClose={() => setBankOpen(false)}
          />
        )}
        <span className="pref-content-badge">
          {result
            ? { deal: "Deal", walked: "Walked away", sold: "Sold", kept: "Kept it", lost: "Gone" }[result.outcome]
            : state.final
              ? selling
                ? "Final offer"
                : "Final price"
              : `Round ${state.turn + 1}`}
        </span>
      </div>

      <div className="neg-table">
        <div className="neg-merchant">
          <div className="pref-item-icon">{scenario.merchant.charAt(0)}</div>
          <div className="pref-item-info">
            <div className="pref-item-name">{scenario.merchant}</div>
            <div className="pref-item-desc">{selling ? `${scenario.kind ?? "Buyer"} · messaged your listing` : scenario.setting}</div>
          </div>
        </div>
        <div className="neg-patience">
          <span
            className="neg-pips"
            role="img"
            aria-label={`${state.patience} of ${state.patience_max} patience left`}
          >
            {Array.from({ length: state.patience_max }, (_, i) => (
              <span key={i} className={`neg-pip${i < state.patience ? " is-left" : ""}`} />
            ))}
          </span>
          <span className="pref-item-desc">Patience</span>
        </div>
        <div className="neg-price">
          <span className="neg-title">{money(state.ask)}</span>
          {selling ? (
            <span className="pref-item-desc">
              {result?.paid != null ? "They paid" : "Offering"}
              {state.opening_bid != null && state.ask > state.opening_bid && (
                <>
                  , up from <s>{money(state.opening_bid)}</s>
                </>
              )}
            </span>
          ) : (
            <span className="pref-item-desc">
              {result?.paid != null ? "You paid" : "Asking"}
              {state.ask < state.list_price && (
                <>
                  , down from <s>{money(state.list_price)}</s>
                </>
              )}
            </span>
          )}
        </div>
      </div>

      {/* The chat's own bubbles: the seller on the left, you on the right */}
      <div className="neg-feed">
        {(scenario.description || scenario.notes) && (
          <div className="neg-listing">
            <div className="neg-listing-head">
              <span className="pref-item-name">{scenario.item}</span>
              <span className="pref-content-badge">{money(state.list_price)}</span>
            </div>
            <span className="msg-timestamp">
              {[selling ? "Your listing" : "", scenario.condition, scenario.setting].filter(Boolean).join(" · ")}
            </span>
            {scenario.description && <p className="pref-item-desc">{scenario.description}</p>}
            {scenario.notes && <p className="pref-item-desc neg-notes">Seller's notes: {scenario.notes}</p>}
          </div>
        )}
        <p className="msg-timestamp neg-persona">
          {scenario.merchant}: {scenario.persona}.
        </p>
        {state.switched_to && state.log.length === 0 && (
          <p className="msg-timestamp neg-notice">You switched to {state.switched_to}.</p>
        )}
        {state.research && <p className="msg-timestamp neg-notice">Sold listings: {state.research}</p>}
        {/* Buying, you message first; selling, the buyer does */}
        {!selling && <Line who="you" text="Hi, is this still available?" />}
        <Line
          who="them"
          text={state.opening}
          note={state.callback ? `They were asking ${money(state.callback.was)} before.` : undefined}
        />
        {selling && state.opening_agreed && state.log.length === 0 && (
          <PayCard
            who="them"
            label={`${scenario.merchant} sent`}
            amount={state.ask}
            status={sold ? "Received" : undefined}
            action={!result && !pending ? { label: "Accept", onClick: () => setPaying(true), disabled: busy } : undefined}
          />
        )}

        {state.log.map((entry, i) => (
          <Fragment key={entry.turn}>
            {/* An offer sent with nothing typed is just the card */}
            {(entry.offer == null || entry.you !== bare(entry.offer)) && (
              <Line
                who="you"
                text={entry.you}
                note={
                  [
                    entry.bluff ? "A bluff. It only works once." : "",
                    entry.leverage ? "A real offer from another buyer." : "",
                    entry.sweetener ? `Offered: ${sweeteners.find((x) => x.id === entry.sweetener)?.label ?? entry.sweetener}.` : "",
                    i === state.log.length - 1 && !pending ? "Seen" : "",
                  ]
                    .filter(Boolean)
                    .join(" ") || undefined
                }
              />
            )}
            {entry.offer != null && (
              <PayCard
                who="you"
                label={selling ? "Your price" : "Your offer"}
                amount={entry.offer}
                status={entry.agreed ? "Accepted" : "Declined"}
              />
            )}
            <Line
              who="them"
              text={entry.reply}
              note={
                [
                  entry.flaw ? `Not in the listing: ${entry.flaw}. A fair reason to pay less.` : "",
                  entry.insulted
                    ? "That number offended them. It cost extra patience."
                    : entry.bluff
                      ? "They did not like that. It cost extra patience."
                      : entry.repeated
                        ? "You already said that."
                        : entry.persuasion > 0
                          ? "That landed."
                          : entry.persuasion < 0
                            ? "That did not help."
                            : "",
                  // Only when the pace changes: the same remark under every reply says nothing
                  entry.tell && entry.tell !== lastTell(state.log, i) ? TELLS[entry.tell] : "",
                ]
                  .filter(Boolean)
                  .join(" ") || undefined
              }
            />
            {entry.ping && (
              <div className="neg-rival">
                <span className="msg-timestamp">
                  {entry.ping.merchant} also messaged: I can do {money(entry.ping.offer)}.
                </span>
                {/* Only the latest offer from another buyer still stands */}
                {ping && i === state.log.length - 1 && !result && !state.final && (
                  <span className="neg-rival-actions">
                    <button type="button" className="toolbar-chip-btn" onClick={() => play({ leverage: true })} disabled={busy}>
                      Tell {scenario.merchant}
                    </button>
                    <button type="button" className="toolbar-chip-btn" onClick={() => edit("switch")} disabled={busy}>
                      Switch to {entry.ping.merchant}
                    </button>
                  </span>
                )}
              </div>
            )}
            {entry.agreed &&
              (() => {
                // Only the latest request can be paid, and only while its price still stands
                const live = !result && !pending && i === state.log.length - 1 && entry.ask === state.ask;
                return (
                  <PayCard
                    who="them"
                    label={`${scenario.merchant} ${selling ? "sent" : "requests"}`}
                    amount={entry.ask}
                    status={
                      result?.paid === entry.ask && i === state.log.length - 1
                        ? selling
                          ? "Received"
                          : "Paid"
                        : live
                          ? undefined
                          : "Expired"
                    }
                    action={
                      live
                        ? { label: selling ? "Accept" : "Pay", onClick: () => setPaying(true), disabled: busy }
                        : undefined
                    }
                  />
                );
              })()}
          </Fragment>
        ))}

        {pending && (
          <>
            {(pending.offer === undefined || pending.text !== bare(pending.offer)) && <Line who="you" text={pending.text} />}
            {pending.offer !== undefined && (
              <PayCard who="you" label={selling ? "Your price" : "Your offer"} amount={pending.offer} status="Sent" />
            )}
            <div className="message-row assistant neg-waiting">
              <span className="waiting" role="status">
                <span className="waiting-leaves" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
                <span className="thinking-phrase">
                  {scenario.merchant} {typing === "stopped" ? "stopped typing" : "is typing"}
                </span>
              </span>
            </div>
          </>
        )}

        {/* Settling the standing price, with no card of theirs to mark as done */}
        {result?.paid != null &&
          !(state.log.at(-1)?.agreed && state.log.at(-1)?.ask === result.paid) &&
          !(selling && state.opening_agreed && state.log.length === 0) && (
            <PayCard
              who={selling ? "them" : "you"}
              label={selling ? `Received from ${scenario.merchant}` : `Paid to ${scenario.merchant}`}
              amount={result.paid}
              status={selling ? "Received" : "Paid"}
            />
          )}

        {result && (
          <div className="neg-verdict">
            <span className="neg-title">{result.rating}</span>
            {selling ? (
              <>
                <span className="pref-setting-hint">
                  {result.paid != null
                    ? `You sold it to ${scenario.merchant} for ${money(result.paid)}, ${money(result.saved ?? 0)} up from their first offer, in ${result.rounds} ${result.rounds === 1 ? "round" : "rounds"}.`
                    : "You kept it. No sale, no score."}
                </span>
                <span className="pref-setting-hint">
                  {scenario.merchant} would have gone up to {money(result.ceiling ?? result.floor)}.
                  {result.paid != null && ` You won ${result.score}% of the room there was.`}
                </span>
                {balance != null && result.paid != null && (
                  <span className="pref-setting-hint">Your balance is now {money(balance)}.</span>
                )}
                {result.profit != null && state.cost != null && (
                  <span className="pref-setting-hint">
                    You paid {money(state.cost)} for it, so that is a {result.profit >= 0 ? "profit" : "loss"} of{" "}
                    {money(Math.abs(result.profit))}.
                  </span>
                )}
              </>
            ) : (
              <>
                <span className="pref-setting-hint">
                  {result.paid != null
                    ? `You paid ${money(result.paid)} for something listed at ${money(state.list_price)}, saving ${money(result.saved ?? 0)} in ${result.rounds} ${result.rounds === 1 ? "round" : "rounds"}.`
                    : result.outcome === "lost"
                      ? `${scenario.merchant} sold it to someone who turned up first. Nothing was paid.`
                      : "You left without buying. No deal, no score."}
                </span>
                <span className="pref-setting-hint">
                  The lowest {scenario.merchant} would have gone was {money(result.floor)}.
                  {result.paid != null && ` You won ${result.score}% of the discount that was there to be had.`}
                </span>
                {balance != null && result.paid != null && (
                  <span className="pref-setting-hint">Your balance is now {money(balance)}.</span>
                )}
              </>
            )}
            {result.pickup && result.pickup.kind !== "fine" && (
              <div className={`neg-pickup${result.pickup.kind === "flaw" ? "" : " is-scam"}`}>
                <span className="pref-item-name">{result.pickup.issue}</span>
                {result.pickup.loss != null && (
                  <span className="pref-setting-hint">
                    {result.pickup.kind === "fake_payment"
                      ? `You are out the item and the ${money(result.pickup.loss)}.`
                      : `It is worth ${money(result.pickup.loss)} less than you thought.`}
                  </span>
                )}
                {result.pickup.kind === "flaw" &&
                  (result.pickup.asked ? (
                    <span className="pref-setting-hint">
                      {result.pickup.refunded
                        ? `${scenario.merchant} sent ${money(result.pickup.refunded)} back.`
                        : `${scenario.merchant} refused. "Sold as seen."`}
                    </span>
                  ) : (
                    <button type="button" className="toolbar-chip-btn" onClick={() => edit("refund")} disabled={busy}>
                      Ask for {money(result.pickup.refund ?? 0)} back
                    </button>
                  ))}
              </div>
            )}
            {result.pickup?.kind === "fine" && <span className="pref-setting-hint">{result.pickup.issue}</span>}
            {state.review && (
              <span className="pref-setting-hint neg-review">
                {state.review.by} left you {state.review.stars} {state.review.stars === 1 ? "star" : "stars"}: "{state.review.text}"
              </span>
            )}
            {run && run.status !== "active" && run.result && (
              <span className="pref-setting-label neg-run-over">
                That was the end of your run: {run.result.rating}, with a net worth of {money(run.result.net_worth)}.
              </span>
            )}
          </div>
        )}

        {/* Talk after the deal: no prices, no cards, just the chat */}
        {(state.after ?? []).map((a, i) => (
          <Fragment key={`after-${i}`}>
            <Line who="you" text={a.you} />
            <Line who="them" text={a.reply} />
          </Fragment>
        ))}
        {chatPending && (
          <>
            <Line who="you" text={chatPending} />
            <div className="message-row assistant neg-waiting">
              <span className="waiting" role="status">
                <span className="waiting-leaves" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
                <span className="thinking-phrase">{scenario.merchant} is typing</span>
              </span>
            </div>
          </>
        )}

        {error && <p className="neg-error">{error}</p>}
        <div ref={feedEnd} />
      </div>

      {result && chatting ? (
        <form className="input-wrapper neg-composer" onSubmit={talk}>
          <input
            className="chat-textarea"
            value={chatDraft}
            onChange={(e) => setChatDraft(e.target.value)}
            maxLength={400}
            placeholder={`Message ${scenario.merchant}`}
            disabled={!!chatPending}
            aria-label="Your message"
            autoFocus
          />
          <div className="input-toolbar">
            <div className="toolbar-left">
              <span className="pref-setting-hint">The deal is done. This is just talk.</span>
            </div>
            <div className="toolbar-right">
              <button type="button" className="toolbar-chip-btn" onClick={() => setChatting(false)}>
                Done
              </button>
              <button type="submit" className="ask-button" disabled={!!chatPending || !chatDraft.trim()} title="Send (Enter)">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" stroke="none">
                  <path d="M22 2L11 13M22 2L15 22l-4-9-9-4 20-7z" />
                </svg>
              </button>
            </div>
          </div>
        </form>
      ) : result ? (
        <div className="neg-controls">
          <button type="button" className="start-button" onClick={() => onLeave(false)}>
            Back to marketplace
          </button>
          <button type="button" className="pref-confirm-no" onClick={() => setChatting(true)}>
            Keep chatting
          </button>
          {(result.outcome === "deal" || (result.outcome === "sold" && state.cost != null)) && (
            <button type="button" className="pref-confirm-no" onClick={() => onLeave(true)}>
              See your inventory
            </button>
          )}
        </div>
      ) : paying ? (
        <PaySheet
          receiving={selling}
          balance={balance}
          to={scenario.merchant}
          item={scenario.item}
          amount={state.ask}
          busy={closing}
          onConfirm={() => close("accept")}
          onCancel={() => setPaying(false)}
        />
      ) : state.final ? (
        <div className="neg-controls">
          <span className="pref-setting-label">That was their final {selling ? "offer" : "price"}.</span>
          <button type="button" className="start-button" onClick={() => setPaying(true)} disabled={busy}>
            {selling ? "Accept" : "Pay"} {money(state.ask)}
          </button>
          <button type="button" className="pref-confirm-no" onClick={() => close("walk")} disabled={busy}>
            {selling ? "Keep it" : "Walk away"}
          </button>
        </div>
      ) : (
        <>
        <div className="neg-extras" role="group" aria-label="More you can offer">
          {sweeteners
            .filter((x) => !(state.sweeteners ?? []).includes(x.id))
            .map((x) => (
              <button
                key={x.id}
                type="button"
                className="toolbar-chip-btn"
                onClick={() => play({ sweetener: x.id })}
                disabled={busy}
                title="Better terms count for something. Each works once."
              >
                {x.label}
              </button>
            ))}
          {!selling && !state.research && (
            <button
              type="button"
              className="toolbar-chip-btn"
              onClick={() => edit("research")}
              disabled={busy}
              title="See what tends to go wrong with these, so you know what to ask about"
            >
              Check sold listings{inRun ? ` (${money(RESEARCH_FEE)})` : ""}
            </button>
          )}
        </div>
        <form className="input-wrapper neg-composer" onSubmit={send}>
          <input
            className="chat-textarea"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={400}
            placeholder={selling ? `Reply to ${scenario.merchant}` : `Make your case to ${scenario.merchant}`}
            disabled={busy}
            aria-label="Your message"
          />
          <div className="input-toolbar">
            <div className="toolbar-left">
              <label className="neg-offer">
                <span>{selling ? "Your price $" : "Offer $"}</span>
                <input
                  value={offerDraft}
                  onChange={(e) => setOfferDraft(e.target.value.replace(/[^\d]/g, "").slice(0, 8))}
                  inputMode="numeric"
                  placeholder="none"
                  disabled={busy}
                  aria-label={selling ? "Your price in dollars" : "Your offer in dollars"}
                />
              </label>
            </div>
            <div className="toolbar-right">
              {!state.bluffed && (
                <button
                  type="button"
                  className="toolbar-chip-btn"
                  onClick={() => play({ bluff: true })}
                  disabled={busy}
                  title={
                    selling
                      ? "Mention someone else is interested and see if their offer moves. Works once, and costs patience."
                      : "Say you are leaving and see if the price moves. Works once, and costs patience."
                  }
                >
                  {selling ? "Mention another buyer" : "Bluff leaving"}
                </button>
              )}
              <button type="button" className="toolbar-chip-btn" onClick={() => close("walk")} disabled={busy}>
                {selling ? "Keep it" : "Walk away"}
              </button>
              <button type="button" className="toolbar-chip-btn" onClick={() => setPaying(true)} disabled={busy}>
                {selling ? "Sell" : "Take it"} at {money(state.ask)}
              </button>
              <button
                type="submit"
                className="ask-button"
                disabled={busy || (!draft.trim() && offer === undefined)}
                title="Send (Enter)"
              >
                <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" stroke="none">
                  <path d="M22 2L11 13M22 2L15 22l-4-9-9-4 20-7z" />
                </svg>
              </button>
            </div>
          </div>
        </form>
        </>
      )}
    </div>
  );
}

/** Selling: everyone who messaged about the listing, to pick one to answer */
function Inbox({
  save,
  balance,
  onSave,
  onLeave,
}: {
  save: HaggleSave;
  balance?: number;
  onSave: (next: HaggleSave) => void;
  onLeave: () => void;
}) {
  const state = save.state;
  const prospects = state.prospects ?? [];
  const [picking, setPicking] = useState<number | null>(null);
  const [error, setError] = useState("");
  useEscapeKey(onLeave);

  const pick = async (index: number) => {
    if (picking !== null) return;
    setPicking(index);
    setError("");
    try {
      onSave(await apiEditGame<HaggleState>(save.id, "buyer", { index }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setPicking(null);
    }
  };

  return (
    <div className="neg neg--play">
      <div className="neg-head">
        <BackButton label="Back to marketplace" onClick={onLeave} />
        <h2 className="neg-title">{state.scenario.item}</h2>
        {balance != null && <span className="neg-link neg-balance">{money(balance)}</span>}
        <span className="pref-content-badge">Listed at {money(state.list_price)}</span>
      </div>
      {createPortal(
        <div className="chat-preferences-modal-overlay" onClick={onLeave}>
          <div
            className="landing-theme-modal neg-browser neg-inbox"
            role="dialog"
            aria-label="Buyers who messaged"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="landing-theme-modal-header">
              <span>
                {prospects.length} {prospects.length === 1 ? "buyer" : "buyers"} messaged you
              </span>
              <button type="button" className="landing-theme-modal-close" onClick={onLeave} aria-label="Close">
                ✕
              </button>
            </div>
            <p className="pref-setting-hint">
              Your listing for {state.scenario.item} at {money(state.list_price)} got some messages. Pick who to
              answer; the others move on. Their first offer is not their last.
            </p>
            <div className="pref-account-card neg-browser-list">
              {prospects.map((p, i) => (
                <div
                  key={`${p.merchant}-${i}`}
                  className={`pref-list-item${picking === i ? " active" : ""}`}
                  role="button"
                  tabIndex={0}
                  aria-disabled={picking !== null}
                  onClick={() => pick(i)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      pick(i);
                    }
                  }}
                >
                  <div className="pref-item-icon">{p.merchant.charAt(0)}</div>
                  <div className="pref-item-info">
                    <div className="pref-item-name">
                      {p.merchant} <span className="neg-inbox-kind">· {p.kind}</span>
                    </div>
                    <div className="pref-item-desc neg-inbox-message">{p.opening}</div>
                  </div>
                  <span className="pref-content-badge">
                    {picking === i ? "Opening" : p.opening_agreed ? `${money(p.opening_bid)}, full price` : money(p.opening_bid)}
                  </span>
                </div>
              ))}
            </div>
            {error && <p className="neg-error">{error}</p>}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

/** A payment bubble in the chat, as a messaging app shows money: an offer you sent, or the seller asking to be paid */
function PayCard({
  who,
  label,
  amount,
  status,
  action,
}: {
  who: "you" | "them";
  label: string;
  amount: number;
  status?: string;
  action?: { label: string; onClick: () => void; disabled?: boolean };
}) {
  return (
    <div className={`message-row ${who === "you" ? "user" : "assistant"}`}>
      <div className={`neg-pay-card${status === "Declined" || status === "Expired" ? " is-void" : ""}`}>
        <span className="neg-pay-brand">ModelLoop Pay</span>
        <span className="neg-pay-label">{label}</span>
        <span className="neg-pay-amount">{money(amount)}</span>
        {action ? (
          <button type="button" className="neg-pay-button" onClick={action.onClick} disabled={action.disabled}>
            {action.label}
          </button>
        ) : (
          status && <span className="neg-pay-status">{status}</span>
        )}
      </div>
    </div>
  );
}

/** The payment sheet. Nothing changes hands until the button is tapped twice. */
function PaySheet({
  receiving = false,
  balance,
  to,
  item,
  amount,
  busy,
  onConfirm,
  onCancel,
}: {
  /** Selling: the money is coming to you */
  receiving?: boolean;
  /** Hustle: what is in the account, to show what is left after and to refuse what it cannot cover */
  balance?: number;
  to: string;
  item: string;
  amount: number;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  // The first tap arms the button; a second one soon after pays.
  // The ref is what decides: two quick taps can land before the state has redrawn.
  const [armed, setArmed] = useState(false);
  const isArmed = useRef(false);
  const disarm = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(disarm.current), []);

  const arm = (on: boolean) => {
    isArmed.current = on;
    setArmed(on);
  };

  const short = !receiving && balance != null && balance < amount;

  const tap = () => {
    if (busy || short) return;
    window.clearTimeout(disarm.current);
    if (isArmed.current) {
      arm(false);
      onConfirm();
      return;
    }
    arm(true);
    disarm.current = window.setTimeout(() => arm(false), DOUBLE_TAP_MS);
  };

  return (
    <div className="neg-pay-sheet" role="dialog" aria-label={receiving ? "Accept payment" : "Confirm payment"}>
      <div className="neg-pay-sheet-head">
        <span className="neg-pay-brand">ModelLoop Pay</span>
        <button type="button" className="neg-link neg-link--quiet" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
      <dl className="neg-pay-rows">
        <div>
          <dt>{receiving ? "From" : "Pay"}</dt>
          <dd>{to}</dd>
        </div>
        <div>
          <dt>For</dt>
          <dd>{item}</dd>
        </div>
        <div className="neg-pay-total">
          <dt>Total</dt>
          <dd>{money(amount)}</dd>
        </div>
        {balance != null && (
          <div>
            <dt>Balance after</dt>
            <dd className={short ? "is-down" : undefined}>{money(balance + (receiving ? amount : -amount))}</dd>
          </div>
        )}
      </dl>
      {short && <p className="neg-error">Not enough in your account. Talk them down, or walk away.</p>}
      <button
        type="button"
        className={`neg-pay-confirm${armed ? " is-armed" : ""}`}
        onClick={tap}
        disabled={busy || short}
        aria-live="polite"
      >
        <span className="neg-pay-confirm-mark" aria-hidden="true" />
        {receiving
          ? busy
            ? "Accepting"
            : armed
              ? "Tap again to accept"
              : "Double tap to accept"
          : busy
            ? "Paying"
            : armed
              ? "Tap again to pay"
              : "Double tap to pay"}
      </button>
    </div>
  );
}

/** How the seller's last haggling reply before this one was paced. Questions carry no tell. */
function lastTell(log: HaggleEntry[], index: number): HaggleEntry["tell"] {
  for (let i = index - 1; i >= 0; i--) if (!log[i].question) return log[i].tell ?? null;
  return null;
}

/** One line of the haggle as a chat bubble, with an optional note where the timestamp would go */
function Line({ who, text, note }: { who: "you" | "them"; text: string; note?: string }) {
  const role = who === "you" ? "user" : "assistant";
  return (
    <div className={`message-row ${role}`}>
      <div className={`msg-bubble-group${who === "you" ? " user-group" : ""}`}>
        <div className={`message ${role}`}>{text}</div>
        {note && (
          <div className={`msg-meta${who === "you" ? " user-meta" : ""}`}>
            <span className="msg-timestamp">{note}</span>
          </div>
        )}
      </div>
    </div>
  );
}
