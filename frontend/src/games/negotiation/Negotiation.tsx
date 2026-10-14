import { Fragment, useEffect, useRef, useState } from "react";
import {
  apiCreateGame,
  apiEditGame,
  apiGameScores,
  apiGetGame,
  apiListGames,
  apiPlayTurn,
  type GameSave,
  type GameSaveSummary,
  type GameScoreRow,
} from "../api";
import { apiFetch } from "../../components/api";
import { BackButton } from "../BackButton";
import type { GameProps } from "../types";
import { CustomListingForm } from "./CustomListingForm";
import { Inventory } from "./Inventory";
import { apiInventory, inventoryTotals } from "./inventoryData";
import { ListingBrowser } from "./ListingBrowser";
import { DIFFICULTIES, LISTINGS_SHOWN, dealListings, type Difficulty } from "./setup";
import type {
  CustomListing,
  HaggleEntry,
  HaggleListing,
  HaggleMode,
  HaggleState,
  HaggleSummary,
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
const TELLS = {
  quick: "They replied straight away.",
  slow: "They took a while to reply.",
  hesitant: "They started typing, stopped, then started again.",
} as const;

type HaggleSave = GameSave<HaggleState>;

function money(amount: number): string {
  return `$${Math.round(amount).toLocaleString("en-US")}`;
}

/** A profit or loss, with its sign */
function signedMoney(amount: number): string {
  return `${amount < 0 ? "-" : "+"}${money(Math.abs(amount))}`;
}

export function Negotiation({ model, onExit }: GameProps) {
  const [save, setSave] = useState<HaggleSave | null>(null);
  // Leaving a finished purchase can go straight to the inventory
  const [showInventory, setShowInventory] = useState(false);

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
  return <Menu onOpen={setSave} onExit={onExit} startInInventory={showInventory} />;
}

// ---- Menu: pick what to buy ----

function Menu({
  onOpen,
  onExit,
  startInInventory,
}: {
  onOpen: (save: HaggleSave) => void;
  onExit: () => void;
  startInInventory: boolean;
}) {
  const [mode, setMode] = useState<HaggleMode>("buy");
  const [inventory, setInventory] = useState<InventoryItem[] | null>(null);
  const [inventoryOpen, setInventoryOpen] = useState(startInInventory);
  const [customOpen, setCustomOpen] = useState(false);
  // Selling: which purchase, and the price it goes up at
  const [sellPick, setSellPick] = useState<string | null>(null);
  const [asking, setAsking] = useState("");
  const [saleScores, setSaleScores] = useState<GameScoreRow[]>([]);
  const [unfinished, setUnfinished] = useState<GameSaveSummary<HaggleSummary> | null>(null);
  const [scores, setScores] = useState<GameScoreRow[]>([]);
  // null is "Surprise me": the server deals a scenario
  const [scenario, setScenario] = useState<string | null>(null);
  // Everything for sale, and the handful on screen; the refresh button deals another
  const [listings, setListings] = useState<HaggleListing[]>([]);
  const [offered, setOffered] = useState<HaggleListing[]>([]);
  const [browsing, setBrowsing] = useState(false);
  const [difficulty, setDifficulty] = useState<Difficulty>("normal");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    apiListGames<HaggleSummary>(GAME_TYPE)
      .then((saves) => setUnfinished(saves.find((s) => s.summary.status === "active") ?? null))
      .catch(() => setUnfinished(null));
    apiGameScores(GAME_TYPE)
      .then(setScores)
      .catch(() => setScores([]));
    apiGameScores(SALE_SCORES)
      .then(setSaleScores)
      .catch(() => setSaleScores([]));
    apiInventory()
      .then(setInventory)
      .catch(() => setInventory([]));
    // Without the list there is still "Surprise me", which the server deals itself
    apiFetch("/api/v1/games/negotiation/listings")
      .then((res) => (res.ok ? res.json() : { listings: [] }))
      .then(({ listings: all }: { listings: HaggleListing[] }) => {
        setListings(all);
        setOffered(dealListings(all));
      })
      .catch(() => {});
  }, []);

  const unsold = (inventory ?? []).filter((i) => !i.sold);
  const picked = unsold.find((i) => i.id === sellPick) ?? null;
  const askingValue = Math.round(Number(asking));
  const categories = [...new Set(listings.map((l) => l.category).filter(Boolean))];

  const pickToSell = (item: InventoryItem) => {
    setMode("sell");
    setSellPick(item.id);
    setAsking(String(item.list_price));
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
        </div>
        <p className="neg-sub">
          {mode === "buy"
            ? "Pick a listing and message the seller to talk the price down. Questions about the item are free; haggling costs a little of their patience, and you only learn how low they would have gone once it is over."
            : "List something you bought and a buyer messages you with an offer. Talk them up before they lose interest. You only learn how high they would have gone once it is over."}
        </p>

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

        {inventory && inventory.length > 0 && (
          <>
            <h3 className="pref-field-label neg-section">Your inventory</h3>
            <div className="pref-account-card neg-card">
              <div
                className="pref-list-item"
                role="button"
                tabIndex={0}
                onClick={() => setInventoryOpen(true)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setInventoryOpen(true);
                  }
                }}
              >
                <div className="pref-item-icon">{inventory.length}</div>
                <div className="pref-item-info">
                  <div className="pref-item-name">
                    {inventory.length} {inventory.length === 1 ? "thing" : "things"} bought
                  </div>
                  <div className="pref-item-desc">
                    {money(inventoryTotals(inventory).spent)} spent, {money(inventoryTotals(inventory).saved)} saved
                    {inventoryTotals(inventory).sold > 0 &&
                      `, ${inventoryTotals(inventory).sold} sold for ${signedMoney(inventoryTotals(inventory).profit)}`}
                    . Latest: {inventory[0].title}
                  </div>
                </div>
                <span className="pref-content-badge">Open</span>
              </div>
            </div>
          </>
        )}
        {inventoryOpen && inventory && (
          <Inventory
            items={inventory}
            onClose={() => setInventoryOpen(false)}
            onSell={(item) => {
              pickToSell(item);
              setInventoryOpen(false);
            }}
          />
        )}
        {customOpen && (
          <CustomListingForm
            mode={mode}
            categories={categories}
            busy={busy}
            error={error}
            onClose={() => setCustomOpen(false)}
            onSubmit={(custom: CustomListing) =>
              run(() =>
                apiCreateGame<HaggleState>(GAME_TYPE, { mode, custom, difficulty, asking: custom.price }),
              )
            }
          />
        )}

        {unfinished && (
          <>
            <h3 className="pref-field-label neg-section">Still on the table</h3>
            <div className="pref-account-card neg-card">
              <div className="pref-list-item neg-row--static">
                <div className="pref-item-icon">{unfinished.summary.merchant.charAt(0)}</div>
                <div className="pref-item-info">
                  <div className="pref-item-name">{unfinished.summary.item}</div>
                  <div className="pref-item-desc">
                    {unfinished.summary.merchant} is {unfinished.summary.mode === "sell" ? "offering" : "asking"}{" "}
                    {money(unfinished.summary.ask)}
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
          <h3 className="pref-field-label neg-section">What are you buying?</h3>
          <button
            type="button"
            className="neg-link neg-refresh neg-show-all"
            disabled={listings.length === 0}
            onClick={() => setBrowsing(true)}
          >
            Show all {listings.length > 0 ? listings.length : ""}
          </button>
          <button
            type="button"
            className="neg-link neg-refresh"
            disabled={listings.length === 0}
            onClick={() => {
              setOffered((current) => dealListings(listings, current.map((s) => s.id)));
              setScenario(null); // the one that was picked may no longer be on the list
            }}
          >
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 12a9 9 0 1 1-2.64-6.36" />
              <path d="M21 3v6h-6" />
            </svg>
            Show me others
          </button>
        </div>
        <div className="pref-account-card neg-card">
          <Option
            icon="?"
            name="Surprise me"
            desc="A listing picked at random"
            on={scenario === null}
            onPick={() => setScenario(null)}
          />
          {offered.map((s) => (
            <Option
              key={s.id}
              icon={s.merchant.charAt(0)}
              name={s.item}
              desc={[s.condition, s.merchant, s.setting.split("·").pop()?.trim()].filter(Boolean).join(" · ")}
              badge={money(s.list_price)}
              on={scenario === s.id}
              onPick={() => setScenario(s.id)}
            />
          ))}
          <Option
            icon="+"
            name="Write your own listing"
            desc="Anything you want to buy. A seller will be found for it."
            on={false}
            onPick={() => setCustomOpen(true)}
          />
        </div>

        {browsing && (
          <ListingBrowser
            listings={listings}
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
            <h3 className="pref-field-label neg-section">What are you selling?</h3>
            <div className="pref-account-card neg-card">
              {unsold.map((i) => (
                <Option
                  key={i.id}
                  icon={i.title.charAt(0).toUpperCase()}
                  name={i.title}
                  desc={[i.paid != null ? `You paid ${money(i.paid)}` : "", i.condition, i.category].filter(Boolean).join(" · ")}
                  badge={money(i.list_price)}
                  on={sellPick === i.id}
                  onPick={() => pickToSell(i)}
                />
              ))}
              {unsold.length === 0 && (
                <div className="pref-list-item neg-row--static">
                  <div className="pref-item-info">
                    <div className="pref-item-name">Nothing to sell yet</div>
                    <div className="pref-item-desc">Buy something first, or sell something of your own.</div>
                  </div>
                </div>
              )}
              <Option
                icon="+"
                name="Something of your own"
                desc="Write a listing for anything you like"
                on={false}
                onPick={() => setCustomOpen(true)}
              />
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
                  {picked.paid != null && `You paid ${money(picked.paid)}. `}It lists for about {money(picked.list_price)}.
                  Asking higher leaves room to come down; the buyer's limit depends on what it is worth, not on your price.
                </span>
              </div>
            )}
          </>
        )}

        <h3 className="pref-field-label neg-section">How tough is the {mode === "buy" ? "seller" : "buyer"}?</h3>
        <div className="pref-account-card neg-card">
          {DIFFICULTIES.map((d) => (
            <Option
              key={d.id}
              name={d.label}
              desc={d.blurb}
              on={difficulty === d.id}
              onPick={() => setDifficulty(d.id)}
            />
          ))}
        </div>

        {error && <p className="neg-error">{error}</p>}

        <div className="neg-start">
          {mode === "buy" ? (
            <button
              type="button"
              className="start-button"
              onClick={() => run(() => apiCreateGame<HaggleState>(GAME_TYPE, { scenario, difficulty }))}
              disabled={busy}
            >
              {busy ? "Opening the chat" : "Message the seller"}
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
                    difficulty,
                  }),
                )
              }
              disabled={busy || !picked || !(askingValue > 0)}
            >
              {busy ? "Posting" : "List it"}
            </button>
          )}
          {unfinished && (
            <span className="pref-setting-hint">Starting a new chat drops the one still on the table.</span>
          )}
        </div>

        {mode === "sell" && saleScores.length > 0 && (
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

        {mode === "buy" && scores.length > 0 && (
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
  const [closing, setClosing] = useState(false);
  // The payment sheet is up: the price on the table, waiting for a double tap
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState("");
  const feedEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    feedEnd.current?.scrollIntoView({ block: "end" });
  }, [state.log.length, pending, error, state.status, paying]);

  const offerValue = Math.round(Number(offerDraft));
  const offer = offerValue > 0 ? offerValue : undefined;
  const busy = !!pending || closing;

  // `bluff`: saying you are leaving to see if the price moves. It works once, and carries no offer.
  const play = async (bluff: boolean) => {
    const text = draft.trim();
    if ((!bluff && !text && offer === undefined) || busy) return;
    setPending(
      bluff
        ? { text: text || (selling ? SELL_BLUFF_MESSAGE : BLUFF_MESSAGE) }
        : { text: text || bare(offer ?? 0), offer },
    );
    setError("");
    setDraft("");
    setOfferDraft("");
    try {
      onSave(await apiPlayTurn<HaggleState>(save.id, text, model, undefined, bluff ? { bluff: true } : { offer }));
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
    play(false);
  };

  // Taking the price or walking away: settled by the server at once, no model involved
  const close = async (path: "accept" | "walk") => {
    if (busy) return;
    setClosing(true);
    setError("");
    try {
      onSave(await apiEditGame<HaggleState>(save.id, path, {}));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setClosing(false);
      setPaying(false);
    }
  };

  return (
    <div className="neg neg--play">
      <div className="neg-head">
        <BackButton label="Back to marketplace" onClick={() => onLeave(false)} />
        <h2 className="neg-title">{scenario.item}</h2>
        <span className="pref-content-badge">
          {result
            ? { deal: "Deal", walked: "Walked away", sold: "Sold", kept: "Kept it" }[result.outcome]
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
        {scenario.description && (
          <div className="neg-listing">
            <div className="neg-listing-head">
              <span className="pref-item-name">{scenario.item}</span>
              <span className="pref-content-badge">{money(state.list_price)}</span>
            </div>
            <span className="msg-timestamp">
              {[selling ? "Your listing" : "", scenario.condition, scenario.setting].filter(Boolean).join(" · ")}
            </span>
            <p className="pref-item-desc">{scenario.description}</p>
          </div>
        )}
        <p className="msg-timestamp neg-persona">
          {scenario.merchant}: {scenario.persona}.
        </p>
        {/* Buying, you message first; selling, the buyer does */}
        {!selling && <Line who="you" text="Hi, is this still available?" />}
        <Line who="them" text={state.opening} />
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
              <Line who="you" text={entry.you} note={entry.bluff ? "A bluff. It only works once." : undefined} />
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
                <span className="thinking-phrase">{scenario.merchant} is thinking it over</span>
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
                    : "You left without buying. No deal, no score."}
                </span>
                <span className="pref-setting-hint">
                  The lowest {scenario.merchant} would have gone was {money(result.floor)}.
                  {result.paid != null && ` You won ${result.score}% of the discount that was there to be had.`}
                </span>
              </>
            )}
          </div>
        )}

        {error && <p className="neg-error">{error}</p>}
        <div ref={feedEnd} />
      </div>

      {result ? (
        <div className="neg-controls">
          <button type="button" className="start-button" onClick={() => onLeave(false)}>
            Back to marketplace
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
                  onClick={() => play(true)}
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
  to,
  item,
  amount,
  busy,
  onConfirm,
  onCancel,
}: {
  /** Selling: the money is coming to you */
  receiving?: boolean;
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

  const tap = () => {
    if (busy) return;
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
      </dl>
      <button
        type="button"
        className={`neg-pay-confirm${armed ? " is-armed" : ""}`}
        onClick={tap}
        disabled={busy}
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
