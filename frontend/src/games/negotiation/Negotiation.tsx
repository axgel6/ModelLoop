import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  apiCreateGame,
  apiEditGame,
  apiGameChat,
  apiGetGame,
  apiPlayTurn,
  type GameSave,
  type GameSaveSummary,
  type GameScoreRow,
} from "../api";
import { useEscapeKey } from "../../components/useEscapeKey";
import { sounds } from "../../sounds";
import { createPortal } from "react-dom";
import { BackButton } from "../BackButton";
import { useOpenSave } from "../useOpenSave";
import type { GameProps } from "../types";
import { Avatar } from "./Avatar";
import { avatarSeed } from "./avatarSeed";
import { Bank } from "./Bank";
import { Profile, Stars } from "./Profile";
import { CustomListingForm } from "./CustomListingForm";
import {
  apiBank,
  apiHustle,
  apiMoveMoney,
  apiStartHustle,
  apiToggleSaved,
  money,
  signedMoney,
  type HustleView,
} from "./hustleData";
import { Inventory } from "./Inventory";
import { CONDITIONS } from "./inventoryData";
import { ListingBrowser } from "./ListingBrowser";
import { apiListings, apiOverview, cachedListings, cachedOverview, type Overview } from "./menuData";
import { cleanText, isCleanLanguage } from "./settings";
import { BadgeMark } from "./Profile";
import { Promote } from "./Promote";
import { SaveHeart } from "./SaveHeart";
import {
  LISTINGS_SHOWN,
  authFee,
  buzzLine,
  canAuthenticate,
  dealListings,
  droppedPrice,
  sellerLine,
  withYourStars,
} from "./setup";
import type {
  AuthCheck,
  Badge,
  CustomListing,
  FreeBank,
  HaggleEntry,
  HaggleListing,
  HaggleMode,
  HaggleResult,
  HaggleState,
  HaggleSummary,
  HustleRun,
  InventoryItem,
  MarketProfile,
  Review,
  SavedListing,
  SellerProfile,
} from "./types";
import "./negotiation.css";

const GAME_TYPE = "negotiation";
// What is sent when the player bluffs without typing anything. The server uses the same lines.
const BLUFF_MESSAGE = "I think I'll leave it. Thanks anyway.";
const SELL_BLUFF_MESSAGE = "Just a heads up, someone else is coming to look at it later today.";
// The haggle happens in the marketplace chat, so what gives the seller away is how they reply, not how they look.
// The faster the answer, the more room is left in the price.
// Buyers who send a parting shot when the player keeps the item. The server has the same list.
const SORE_LOSERS = ["Unhinged", "Lowballer", "Scalper"];
// How long the payment button stays armed after the first tap
const DOUBLE_TAP_MS = 1200;
// How long a payment the account cannot cover seems to go through before it is declined
const FAKE_PAYING_MS = 1400;
// Terms other than money, each offered once per chat. Mirrors SWEETENERS in backend/games/negotiation/extras.py.
// `calms`: it puts them in a better mood and wins back patience (CALMING); `words`: kind words only, the price stays (WORDS_ONLY)
const SWEETENERS: Record<"buy" | "sell", { id: string; label: string; said: string; calms?: boolean; words?: boolean }[]> = {
  buy: [
    { id: "cash", label: "Cash today", said: "I can pay cash, today." },
    { id: "pickup", label: "Pick up now", said: "I can come pick it up right now." },
    { id: "shipping", label: "Cover shipping", said: "I'll cover the shipping." },
    // What is said comes from COMPLIMENTS, to suit what is being sold
    { id: "compliment", label: "Compliment", said: "", calms: true, words: true },
  ],
  sell: [
    { id: "dropoff", label: "Drop it off", said: "I can drop it off to you.", calms: true },
    { id: "hold", label: "Hold it for you", said: "I'll hold it for you, no one else gets it.", calms: true },
    { id: "anytime", label: "Pickup any time", said: "Pick it up whenever suits you.", calms: true },
  ],
};
// A compliment that suits the listing, by category; one is picked per listing so it stays the same
const COMPLIMENTS: Record<string, string[]> = {
  Homes: ["Love what you've done with the place, by the way.", "The photos honestly don't do this place justice."],
  "Mobile homes and RVs": ["You've kept this really clean, by the way.", "Honestly one of the nicest ones I've looked at."],
  Land: ["Beautiful piece of land, by the way. I can see why you bought it.", "That view is something else, by the way."],
  Businesses: ["You've built something really good here, by the way.", "Honestly, I can tell how much work went into this."],
  "Yachts and aircraft": ["She's beautiful, by the way. You've clearly looked after her."],
  Vehicles: ["Really clean, by the way. You can tell it's been looked after.", "Love the color on this one, by the way."],
  Tickets: ["Great seats, by the way. Good taste.", "Love that you're a fan too, by the way."],
  "Flowers and ramos": ["These are honestly gorgeous, by the way. You've got a real eye."],
  "Art and rare finds": ["It's a stunning piece, by the way.", "You've got a great eye, by the way."],
  "Fun stuff": ["Gotta say, best listing I've seen all week.", "Honestly, respect for even listing this."],
  Books: ["Nice copy, by the way. You've taken good care of it."],
  Vintage: ["They don't make them like this anymore, by the way."],
};
const COMPLIMENT_DEFAULT = [
  "Thanks for being so easy to deal with, by the way.",
  "Great listing, by the way. Really clear photos.",
  "It looks great, by the way. You can tell it's been looked after.",
];
const complimentFor = (scenario: { id: string; category?: string | null }) => {
  const lines = COMPLIMENTS[scenario.category ?? ""] ?? COMPLIMENT_DEFAULT;
  const pick = [...scenario.id].reduce((n, c) => n + c.charCodeAt(0), 0);
  return lines[pick % lines.length];
};
// What Purchase Protection gives back for a scam paid in the app, as PROTECTION_SHARE in extras.py
const PROTECTION_PERCENT = 60;
// Checking sold listings costs this much in a Hustle run, as RESEARCH_FEE in hustle.py
const RESEARCH_FEE = 5;
// How long a slow or hesitant reply keeps you waiting, so the pace itself gives something away
const SLOW_REPLY_MS = 1200;
const HESITANT_PAUSE_MS = 900;
const wait = (ms: number) => new Promise((done) => window.setTimeout(done, ms));
// A gap this long between messages earns a time marker in the chat, as messaging apps do
const TIME_GAP_MS = 10 * 60 * 1000;

/** "3:42 PM", or "Oct 12, 3:42 PM" for another day */
function clock(iso: string): string {
  const at = new Date(iso);
  const time = at.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (at.toDateString() === new Date().toDateString()) return time;
  return `${at.toLocaleDateString("en-US", { month: "short", day: "numeric" })}, ${time}`;
}

/** "Active now", or how long ago they were last around */
function presence(iso: string | undefined, here: boolean): string {
  if (here || !iso) return "Active now";
  const minutes = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (minutes < 60) return `Active ${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Active ${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  return `Active ${Math.round(hours / 24)} ${Math.round(hours / 24) === 1 ? "day" : "days"} ago`;
}

/** A time marker when enough time has passed since the message before */
function gap(at: string | undefined, before: string | undefined): string | null {
  if (!at) return null;
  if (!before || new Date(at).getTime() - new Date(before).getTime() >= TIME_GAP_MS) return clock(at);
  return null;
}
const TELLS = {
  quick: "They replied straight away.",
  slow: "They took a while to reply.",
  hesitant: "They started typing, stopped, then started again.",
} as const;

type HaggleSave = GameSave<HaggleState>;
// Which of Free play and Hustle the menu is on, kept for the tab
const PLAY_KEY = "marketplace_play";


export function Negotiation({ model, onExit }: GameProps) {
  // The open chat is kept in the address bar, so a refresh reopens it
  const [save, setSave, restoring] = useOpenSave<HaggleState>(GAME_TYPE);
  // Leaving a finished purchase can go straight to the inventory
  const [showInventory, setShowInventory] = useState(false);
  // Free play or a Hustle run, kept while the player goes in and out of chats, and through a refresh
  const [play, setPlayState] = useState<"free" | "hustle">(() => {
    try {
      return sessionStorage.getItem(PLAY_KEY) === "hustle" ? "hustle" : "free";
    } catch {
      return "free";
    }
  });
  const setPlay = (next: "free" | "hustle") => {
    setPlayState(next);
    try {
      sessionStorage.setItem(PLAY_KEY, next);
    } catch {
      // private mode: it just will not survive a refresh
    }
  };

  if (restoring)
    return (
      <div className="games-restoring" role="status">
        <span className="waiting">
          <span className="waiting-leaves" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span className="thinking-phrase">Picking up where you left off</span>
        </span>
      </div>
    );
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
  // What this visit already loaded draws the menu at once; a fresh copy replaces it as it arrives
  const cached = cachedOverview();
  // The stars you gave sellers count in their ratings
  const cachedAll = cachedListings() && withYourStars(cachedListings()!, cached?.bank?.given);
  const [ready, setReady] = useState(!!cached && !!cachedAll);
  const [hustle, setHustle] = useState<HustleView | null>(cached?.hustle ?? null);
  const [hustleScores, setHustleScores] = useState<GameScoreRow[]>(cached?.scores.hustle ?? []);
  const [bankOpen, setBankOpen] = useState(false);
  // Free play has its own account, apart from any Hustle run
  const [freeBank, setFreeBank] = useState<FreeBank | null>(cached?.bank ?? null);
  const [freeBankOpen, setFreeBankOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profile, setProfile] = useState<MarketProfile | null>(cached?.profile ?? null);
  const [showScores, setShowScores] = useState(false);
  const [mode, setMode] = useState<HaggleMode>("buy");
  const [inventory, setInventory] = useState<InventoryItem[] | null>(cached?.inventory ?? null);
  const [inventoryOpen, setInventoryOpen] = useState(startInInventory);
  const [customOpen, setCustomOpen] = useState(false);
  // Selling: which purchase, and the price it goes up at
  const [sellPick, setSellPick] = useState<string | null>(null);
  const [asking, setAsking] = useState("");
  // Selling: paying to reach more buyers, and to have it authenticated first
  const [boost, setBoost] = useState(0);
  const [authenticate, setAuthenticate] = useState(false);
  const [buzz, setBuzz] = useState<Overview["buzz"] | null>(cached?.buzz ?? null);
  // Free play: the listing's description, rewritten as the player likes. Hustle: notes added under it
  const [listingText, setListingText] = useState("");
  // Free play: the rest of the listing, also the player's to change
  const [listingTitle, setListingTitle] = useState("");
  const [listingCondition, setListingCondition] = useState("");
  const [listingCategory, setListingCategory] = useState("");
  const [saleScores, setSaleScores] = useState<GameScoreRow[]>(cached?.scores.sell ?? []);
  const [unfinished, setUnfinished] = useState<GameSaveSummary<HaggleSummary> | null>(cached?.unfinished ?? null);
  const [scores, setScores] = useState<GameScoreRow[]>(cached?.scores.buy ?? []);
  // null is "Surprise me": the server deals a scenario
  const [scenario, setScenario] = useState<string | null>(null);
  // Everything for sale, and the handful on screen; the refresh button deals another
  const [listings, setListings] = useState<HaggleListing[]>(cachedAll ?? []);
  const [offered, setOffered] = useState<HaggleListing[]>(() => (cachedAll ? dealListings(cachedAll) : []));
  const [browsing, setBrowsing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Everything in two requests, drawn together: one for the player's own things, one for the catalogue
  useEffect(() => {
    let current = true;
    Promise.all([apiOverview().catch(() => null), apiListings().catch(() => [] as HaggleListing[])]).then(
      ([fresh, all]) => {
        if (!current) return;
        if (fresh) {
          setUnfinished(fresh.unfinished);
          setHustle(fresh.hustle);
          setInventory(fresh.inventory);
          setFreeBank(fresh.bank);
          setProfile(fresh.profile ?? null);
          setBuzz(fresh.buzz ?? null);
          setScores(fresh.scores.buy);
          setSaleScores(fresh.scores.sell);
          setHustleScores(fresh.scores.hustle);
        } else {
          setHustle((h) => h ?? { run: null, prices: {} });
          setInventory((i) => i ?? []);
        }
        const rated = withYourStars(all, fresh?.bank?.given);
        setListings(rated);
        // Keep the handful on screen if this visit already dealt them; their stars may have changed
        setOffered((shown) =>
          shown.length > 0 ? shown.map((s) => rated.find((l) => l.id === s.id) ?? s) : dealListings(rated),
        );
        setReady(true);
      },
    );
    return () => {
      current = false;
    };
  }, []);

  // In a Hustle run, everything comes from the run: its holdings, its prices, its balance
  const hustleRun: HustleRun | null = play === "hustle" ? (hustle?.run ?? null) : null;
  const live = hustleRun?.status === "active" ? hustleRun : null;
  const items = live ? live.holdings : (inventory ?? []);
  // Saved listings, free play's or the run's: one that has dropped is listed at its new price
  const saved: SavedListing[] = (live ? live.saved : freeBank?.saved) ?? [];
  const savedOf = (id: string) => saved.find((x) => x.listing === id);
  const priceOf = (l: HaggleListing) => {
    const base = live ? (hustle?.prices[l.id] ?? l.list_price) : l.list_price;
    const cut = savedOf(l.id)?.gone ? 1 : (savedOf(l.id)?.cut ?? 1);
    return cut < 1 ? droppedPrice(base, cut) : base;
  };
  const buzzOf = (id: string) => (live ? buzz?.hustle : buzz?.free)?.[id] ?? null;
  // The heart fills at once; the server catches up behind it, and an error puts it back
  const setSaved = (next: SavedListing[]) => {
    if (live) setHustle((h) => (h?.run ? { ...h, run: { ...h.run, saved: next } } : h));
    else setFreeBank((b) => (b ? { ...b, saved: next } : b));
  };
  const toggleSave = async (id: string) => {
    setError("");
    const before = saved;
    setSaved(
      saved.some((x) => x.listing === id)
        ? saved.filter((x) => x.listing !== id)
        : [...saved, { listing: id, cut: 1, news: null }],
    );
    try {
      setSaved(await apiToggleSaved(id, !!live));
    } catch (err) {
      setSaved(before);
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  };
  // One set for the browser, not a new one every render, so its filtering is not redone for nothing
  const savedIds = useMemo(() => new Set(saved.filter((x) => !x.gone).map((x) => x.listing)), [saved]);
  const valueOf = (l: HaggleListing) => (live ? (hustle?.values?.[l.id] ?? l.value) : l.value);
  // At the prices that apply: the run's, and a saved listing's after it dropped
  const browsable = listings.map((l) => ({ ...l, list_price: priceOf(l), value: valueOf(l) }));
  // The handful on the start screen is only what the balance covers. Show all still lists everything.
  const cash = live ? live.cash : (freeBank?.cash ?? null);
  const affordable = cash == null ? listings : listings.filter((l) => priceOf(l) <= cash);
  const affordableIds = affordable.map((l) => l.id).join(",");
  useEffect(() => {
    const ok = new Set(affordableIds ? affordableIds.split(",") : []);
    setOffered((current) => {
      // Keep what is still affordable, and top up from the rest
      const kept = current.filter((s) => ok.has(s.id));
      const want = Math.min(LISTINGS_SHOWN, ok.size);
      if (kept.length === current.length && kept.length >= want) return current;
      const more = dealListings(affordable, kept.map((s) => s.id)).filter((s) => !kept.some((k) => k.id === s.id));
      return [...kept, ...more].slice(0, LISTINGS_SHOWN);
    });
    setScenario((id) => (id && !ok.has(id) ? null : id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [affordableIds]);
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
    setBoost(0);
    setAuthenticate(false);
    // Whatever the player changed the last time it went up for sale, for this item alone
    setListingText(live ? lockedText(item) + (item.notes ?? "") : (item.description ?? ""));
    setListingTitle(item.title);
    setListingCondition(item.condition ?? "");
    setListingCategory(item.category ?? "");
  };

  // Free play: only what the player changed goes with the listing
  const listingEdits = (item: InventoryItem) => {
    const edits: Record<string, string> = {};
    const title = listingTitle.trim().replace(/\s+/g, " ");
    if (title !== item.title) edits.title = title;
    if (listingCondition !== (item.condition ?? "")) edits.condition = listingCondition;
    if (listingCategory !== (item.category ?? "")) edits.category = listingCategory;
    if (listingText.trim() !== (item.description ?? "").trim()) edits.description = listingText.trim();
    return edits;
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

  if (!ready)
    return (
      <div className="neg neg--menu">
        <div className="neg-menu">
          <div className="game-menu-head">
            <BackButton label="Back to all games" onClick={onExit} />
            <h2 className="neg-title">Marketplace</h2>
          </div>
          <div className="neg-loading">
            <span className="waiting" role="status">
              <span className="waiting-leaves" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              <span className="thinking-phrase">Opening the marketplace</span>
            </span>
          </div>
        </div>
      </div>
    );

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
            detail={`Day ${live.day} of ${live.days}`}
            progress={live.day / live.days}
            items={items.length}
            rating={freeBank?.rating ?? null}
            reviews={freeBank?.review_count ?? 0}
            onBank={() => setBankOpen(true)}
            onInventory={() => setInventoryOpen(true)}
            onProfile={() => setProfileOpen(true)}
          />
        ) : (
          play === "free" &&
          freeBank && (
            <AccountBar
              cash={freeBank.cash}
              detail={`Net worth ${money(freeBank.net_worth)}`}
              items={items.length}
              rating={freeBank.rating}
              reviews={freeBank.review_count}
              onBank={() => setFreeBankOpen(true)}
              onInventory={() => setInventoryOpen(true)}
              onProfile={() => setProfileOpen(true)}
            />
          )
        )}
        {profileOpen && (
          <Profile
            initial={profile}
            onGiven={(given) => {
              // Sellers' stars stop counting the review straight away
              setFreeBank((b) => (b ? { ...b, given } : b));
              const rated = withYourStars(cachedListings() ?? [], given);
              setListings(rated);
              setOffered((shown) => shown.map((s) => rated.find((l) => l.id === s.id) ?? s));
            }}
            onClose={() => setProfileOpen(false)}
          />
        )}
        {live && (live.callbacks ?? []).length > 0 && (
          <>
            <h3 className="pref-field-label neg-section">Messages</h3>
            <div className="pref-account-card neg-card">
              {(live.callbacks ?? []).map((c) => (
                <div key={c.id} className="pref-list-item neg-row--static">
                  <div className="pref-item-icon neg-face">
                    <Avatar seed={avatarSeed(c.merchant, c.scenario)} />
                  </div>
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
            onSubmit={(custom: CustomListing, promote) =>
              run(() =>
                apiCreateGame<HaggleState>(GAME_TYPE, { mode: "sell", custom, asking: custom.price, ...promote }),
              )
            }
          />
        )}

        {unfinished && (
          <>
            <h3 className="pref-field-label neg-section">Still on the table</h3>
            <div className="pref-account-card neg-card">
              <div className="pref-list-item neg-row--static">
                {unfinished.summary.merchant ? (
                  <div className="pref-item-icon neg-face">
                    <Avatar
                      seed={avatarSeed(
                        unfinished.summary.merchant,
                        unfinished.summary.listing,
                        unfinished.summary.mode === "sell",
                      )}
                    />
                  </div>
                ) : (
                  <div className="pref-item-icon">{unfinished.summary.prospects}</div>
                )}
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
        {saved.length > 0 && (
          <>
            <h3 className="pref-field-label neg-section">Saved</h3>
            <div className="pref-account-card neg-card">
              {saved.map((x) => {
                const l = listings.find((y) => y.id === x.listing);
                if (!l) return null;
                const was = x.news === "drop" && x.was ? droppedPrice(live ? (hustle?.prices[l.id] ?? l.list_price) : l.list_price, x.was) : null;
                return (
                  <Option
                    key={x.listing}
                    face={avatarSeed(l.merchant, l.id)}
                    name={l.item}
                    desc={
                      x.gone
                        ? `Sold to someone else. Tap the heart to clear it.`
                        : [
                            x.news === "drop" ? `Price dropped${was ? ` from ${money(was)}` : ""}` : "",
                            `Resells for ${money(valueOf(l))}`,
                            buzzLine(buzzOf(l.id)),
                          ]
                            .filter(Boolean)
                            .join(" · ")
                    }
                    badge={x.gone ? "Sold" : money(priceOf(l))}
                    news={x.news === "drop" || x.gone}
                    saved
                    onSave={() => toggleSave(l.id)}
                    on={!x.gone && scenario === l.id}
                    onPick={() => !x.gone && setScenario(scenario === l.id ? null : l.id)}
                  />
                );
              })}
            </div>
          </>
        )}
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
            disabled={affordable.length === 0}
            title="Show me others"
            aria-label="Show me others"
            onClick={() => {
              setOffered((current) => dealListings(affordable, current.map((s) => s.id)));
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
          {offered.length === 0 && listings.length > 0 && (
            <div className="pref-list-item neg-row--static">
              <div className="pref-item-info">
                <div className="pref-item-name">Nothing you can afford right now</div>
                <div className="pref-item-desc">
                  {live ? "Sell something to raise cash." : "Add money in the Bank, or sell something first."}
                </div>
              </div>
            </div>
          )}
          {offered.map((s) => (
            <Option
              key={s.id}
              face={avatarSeed(s.merchant, s.id)}
              name={s.item}
              desc={[
                live && priceOf(s) > live.cash ? "Over budget" : "",
                `Resells for ${money(valueOf(s))}`,
                s.condition,
                sellerLine(s.merchant, s.seller),
                buzzLine(buzzOf(s.id)),
              ]
                .filter(Boolean)
                .join(" · ")}
              badge={money(priceOf(s))}
              saved={!!savedOf(s.id)}
              onSave={() => toggleSave(s.id)}
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
            busy={busy}
            error={error}
            note={
              [live ? "Starting a chat uses a day." : "", unfinished ? "It drops the chat still on the table." : ""]
                .filter(Boolean)
                .join(" ") || undefined
            }
            onMessage={(listing) => run(() => apiCreateGame<HaggleState>(GAME_TYPE, { scenario: listing.id, hustle: !!live }))}
            onClose={() => setBrowsing(false)}
            saved={savedIds}
            onSave={(listing) => toggleSave(listing.id)}
            buzzOf={buzzOf}
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
              <>
                <h3 className="pref-field-label neg-section">Your listing</h3>
                <div className="pref-account-card neg-card neg-relist">
                  {!live && (
                    <label className="neg-field">
                      <span className="neg-field-label">Title</span>
                      <input
                        className="neg-field-input"
                        value={listingTitle}
                        onChange={(e) => setListingTitle(e.target.value)}
                        maxLength={80}
                        placeholder={picked.title}
                      />
                    </label>
                  )}
                  <div className="neg-relist-grid">
                    <label className="neg-field">
                      <span className="neg-field-label">Asking price</span>
                      <span className="neg-field-input neg-field-money">
                        $
                        <input
                          value={asking}
                          onChange={(e) => setAsking(e.target.value.replace(/[^\d]/g, "").slice(0, 10))}
                          inputMode="numeric"
                          aria-label="Your asking price in dollars"
                        />
                      </span>
                    </label>
                    {!live && (
                      <>
                        <label className="neg-field">
                          <span className="neg-field-label">Condition</span>
                          <select
                            className="neg-field-input"
                            value={listingCondition}
                            onChange={(e) => setListingCondition(e.target.value)}
                          >
                            <option value="">Not stated</option>
                            {CONDITIONS.map((c) => (
                              <option key={c} value={c}>
                                {c}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="neg-field">
                          <span className="neg-field-label">Category</span>
                          <select
                            className="neg-field-input"
                            value={listingCategory}
                            onChange={(e) => setListingCategory(e.target.value)}
                          >
                            <option value="">Custom</option>
                            {[...new Set([...(picked.category ? [picked.category] : []), ...categories])].map((c) => (
                              <option key={c} value={c}>
                                {c}
                              </option>
                            ))}
                          </select>
                        </label>
                      </>
                    )}
                  </div>
                  <span className="pref-setting-hint">
                    Resells for about {money(picked.value ?? picked.list_price)}
                    {picked.paid != null && `. You paid ${money(picked.paid)}`}.
                  </span>
                  <label className="neg-field">
                    <span className="neg-field-label">{live ? "Description and your notes" : "Description"}</span>
                    {live ? (
                      <textarea
                        className="neg-custom-description"
                        value={listingText}
                        onChange={(e) => e.target.value.startsWith(locked) && setListingText(e.target.value)}
                        maxLength={locked.length + 300}
                        rows={4}
                        placeholder="Add your own notes: what is included, why it is a good deal."
                      />
                    ) : (
                      <textarea
                        className="neg-custom-description"
                        value={listingText}
                        onChange={(e) => setListingText(e.target.value)}
                        maxLength={600}
                        rows={3}
                        placeholder="Condition, what is included, any flaws. The buyer only knows what is written here."
                      />
                    )}
                  </label>
                  {live && (
                    <span className="pref-setting-hint">
                      Add your notes at the end. Buyers will not believe claims that contradict the listing.
                    </span>
                  )}
                  <Promote
                    asking={askingValue}
                    boost={boost}
                    onBoost={setBoost}
                    authenticable={canAuthenticate({
                      category: live ? picked.category : listingCategory || picked.category,
                      condition: live ? picked.condition : listingCondition,
                      title: live ? picked.title : listingTitle,
                    })}
                    authenticate={authenticate}
                    onAuthenticate={setAuthenticate}
                  />
                </div>
              </>
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
                run(() =>
                  apiCreateGame<HaggleState>(GAME_TYPE, {
                    // A random seller is one whose price the balance covers
                    scenario: scenario ?? affordable[Math.floor(Math.random() * affordable.length)]?.id ?? null,
                    hustle: !!live,
                  }),
                )
              }
              disabled={busy || (!scenario && affordable.length === 0)}
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
                    boost,
                    authenticate,
                    ...(live
                      ? { notes: listingText.slice(locked.length).trim() || undefined }
                      : listingEdits(picked)),
                    hustle: !!live,
                  }),
                )
              }
              disabled={busy || !picked || !(askingValue > 0) || (!live && listingTitle.trim().length < 3)}
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

/** The money, the stuff and your standing: balance, inventory and profile side by side, each opening its own window */
function AccountBar({
  cash,
  detail,
  progress,
  items,
  rating,
  reviews,
  onBank,
  onInventory,
  onProfile,
}: {
  cash: number;
  detail: string;
  /** Hustle: the share of the run's days used */
  progress?: number;
  items: number;
  /** Your marketplace rating, once anyone has reviewed you */
  rating: number | null;
  reviews: number;
  onBank: () => void;
  onInventory: () => void;
  onProfile: () => void;
}) {
  return (
    <div className="neg-account">
      <button type="button" className="neg-account-part neg-account-part--money" onClick={onBank}>
        <span className="neg-account-value">{money(cash)}</span>
        <span className="pref-item-desc">{detail}</span>
      </button>
      <button type="button" className="neg-account-part neg-account-part--stuff" onClick={onInventory} disabled={items === 0}>
        <span className="neg-account-value">
          {items} {items === 1 ? "item" : "items"}
        </span>
        <span className="pref-item-desc">{items === 0 ? "Nothing bought yet" : "Inventory"}</span>
      </button>
      <button type="button" className="neg-account-part neg-account-part--profile" onClick={onProfile}>
        <span className="neg-account-value">
          {rating != null ? (
            <>
              {rating.toFixed(1)} <Stars value={rating} />
            </>
          ) : (
            "No reviews yet"
          )}
        </span>
        <span className="pref-item-desc">
          {reviews > 0 ? `Profile · ${reviews} ${reviews === 1 ? "review" : "reviews"}` : "Your profile"}
        </span>
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
  face,
  name,
  desc,
  badge,
  saved,
  onSave,
  news,
  on,
  onPick,
}: {
  icon?: string;
  /** A person's face in place of the icon, by avatar seed */
  face?: string;
  name: string;
  desc: string;
  badge?: string;
  /** A listing: whether it is saved, and the heart that saves it */
  saved?: boolean;
  onSave?: () => void;
  /** Something changed: a saved listing dropped or sold */
  news?: boolean;
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
      {face ? (
        <div className="pref-item-icon neg-face">
          <Avatar seed={face} />
        </div>
      ) : (
        icon && <div className="pref-item-icon">{icon}</div>
      )}
      <div className="pref-item-info">
        <div className="pref-item-name">{name}</div>
        <div className={`pref-item-desc${news ? " neg-news" : ""}`}>{desc}</div>
      </div>
      {onSave && <SaveHeart saved={!!saved} onSave={onSave} />}
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
  const [draft, setDraft] = useState("");
  const [offerDraft, setOfferDraft] = useState("");
  // `bounced`: not a message but a payment that just failed, shown as its declined card
  const [pending, setPending] = useState<{ text: string; offer?: number; bounced?: number } | null>(null);
  // While a reply is on its way: typing, or a hesitant stop part way
  const [typing, setTyping] = useState<"typing" | "stopped">("typing");
  const [closing, setClosing] = useState(false);
  // The payment sheet is up: the price on the table, waiting for a double tap
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState("");
  const feedEnd = useRef<HTMLDivElement>(null);
  // The message boxes, focused again once a reply lands so the next message can be typed straight away
  const draftInput = useRef<HTMLInputElement>(null);
  const chatInput = useRef<HTMLInputElement>(null);
  // A Hustle chat: the run's balance, shown in the header and checked before paying
  const [run, setRun] = useState<HustleRun | null>(null);
  const [bankOpen, setBankOpen] = useState(false);
  const inRun = !!state.run_id;
  // Free play: the free play account pays and gets paid instead
  const [freeBank, setFreeBank] = useState<FreeBank | null>(null);
  const balance = run ? run.cash : freeBank?.cash;
  // Talking on once the haggle is over
  const [chatting, setChatting] = useState(false);
  // A sore loser turned down is typing their parting shot
  const [ranting, setRanting] = useState(false);
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
  }, [state.log.length, pending, error, state.status, paying, state.after?.length, chatPending, state.research, state.auth]);

  // Checking sold listings and authenticating show in the chat after the message they followed.
  // Checks made before that was kept (turn unknown) go at the end.
  const lastTurn = state.log.length ? state.log[state.log.length - 1].turn : 0;
  const checksAt = (turn: number) => {
    const at = (t: number | undefined) => (t ?? lastTurn) === turn;
    return (
      <>
        {!selling && state.auth && at(state.auth.turn) && <AuthNote auth={state.auth} inFeed />}
        {state.research && at(state.research_turn) && (
          <p className="neg-feed-note" role="note">
            <ExtraIcon name="research" />
            <span>
              <strong>Sold listings:</strong> {state.research}
            </span>
          </p>
        )}
      </>
    );
  };

  const offerValue = Math.round(Number(offerDraft));
  // The offer is kept as bare digits and shown with commas
  const offerShown = offerDraft ? Number(offerDraft).toLocaleString("en-US") : "";
  const offer = offerValue > 0 ? offerValue : undefined;
  const busy = !!pending || closing;

  // The box is disabled while a reply is on its way, which drops focus; give it back when the reply lands.
  // Only on that change, so opening a chat does not pull up the keyboard on a phone.
  const waited = useRef(false);
  useEffect(() => {
    const waiting = busy || !!chatPending;
    if (waited.current && !waiting && !paying) (chatInput.current ?? draftInput.current)?.focus();
    waited.current = waiting;
  }, [busy, chatPending, paying]);

  // The review they left is written in their voice after the chat closes, so the result never waits for it.
  // If it cannot be written, their stock line stands.
  const writing = useRef(false);
  const reviewPending = !!state.review?.pending;
  useEffect(() => {
    if (!reviewPending || writing.current) return;
    writing.current = true;
    apiEditGame<HaggleState>(save.id, "review-text", { model, clean: isCleanLanguage() })
      .then(onSave)
      .catch(() => {});
  }, [reviewPending, save.id, model, onSave]);

  const [rating, setRating] = useState(false);
  const rateBack = async (stars: number, text: string) => {
    setRating(true);
    setError("");
    try {
      onSave(await apiEditGame<HaggleState>(save.id, "rate", { stars, text }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setRating(false);
    }
  };

  const sweeteners = SWEETENERS[selling ? "sell" : "buy"];
  // Clean language (Marketplace settings): characters are told not to swear, and anything they still say is softened
  const clean = isCleanLanguage();
  const say = (text: string) => (clean ? cleanText(text) : text);
  const ping = state.ping ?? null;
  // Their face, the same one shown in the listing and the inbox
  const face = avatarSeed(scenario.merchant, scenario.id, selling);
  // When each message landed: the chat opened, then every round, then talk after the deal
  const lastAt = state.after?.at(-1)?.at ?? state.log.at(-1)?.at ?? state.started_at;

  // `bluff`: saying you are leaving to see if the price moves. It works once, and carries no offer.
  // `leverage`: holding up another buyer's real offer. `sweetener`: a term other than money.
  const play = async (move: { bluff?: boolean; leverage?: boolean; sweetener?: string } = {}) => {
    const text = draft.trim();
    const special = move.bluff || move.leverage || !!move.sweetener;
    if ((!special && !text && offer === undefined) || busy) return;
    const said =
      move.sweetener === "compliment"
        ? complimentFor(scenario)
        : move.sweetener
          ? sweeteners.find((x) => x.id === move.sweetener)?.said
          : undefined;
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
        // A compliment is worded for this listing here, not by the server
        text || (move.sweetener === "compliment" ? (said ?? "") : ""),
        model,
        undefined,
        { clean, ...(move.bluff ? { bluff: true } : move.leverage ? { leverage: true } : { offer, sweetener: move.sweetener }) },
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

  // Buying: offer one of your things, and cash if you like. The seller answers like any other message.
  const [trading, setTrading] = useState(false);
  const offerTrade = async (item: { id: string; title: string }, cash: number) => {
    if (busy) return;
    setTrading(false);
    setPending({ text: `Would you take my ${item.title}${cash ? ` plus ${money(cash)}` : ""} for it?` });
    setTyping("typing");
    setError("");
    try {
      onSave(await apiEditGame<HaggleState>(save.id, "trade-offer", { item_id: item.id, cash, model, clean }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setPending(null);
    }
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
  const close = async (path: "accept" | "walk" | "trade") => {
    if (busy) return;
    setClosing(true);
    setError("");
    try {
      const next = await apiEditGame<HaggleState>(save.id, path, {});
      if (next.state.result?.paid != null) sounds.play("pay");
      const pickup = next.state.result?.pickup?.kind;
      if (pickup === "counterfeit" || pickup === "fake_payment" || pickup === "scam") window.setTimeout(() => sounds.play("warn"), 700);
      onSave(next);
      if (selling && next.state.result?.outcome === "kept" && SORE_LOSERS.includes(scenario.kind ?? "")) void lastWord();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setClosing(false);
      setPaying(false);
      refreshRun();
    }
  };

  // Kept the item from a sore loser: they say their piece unprompted, and the chat stays open to answer
  const lastWord = async () => {
    setRanting(true);
    try {
      onSave(await apiEditGame<HaggleState>(save.id, "last-word", { model, clean }));
      setChatting(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setRanting(false);
    }
  };

  // The first payment that bounces in a chat reaches the seller, who reacts to it. After that the
  // sheet still refuses, but the seller is not told again.
  const bouncing = useRef(false);
  const bounce = async () => {
    if (selling || state.bounced || bouncing.current) return;
    bouncing.current = true;
    // Let the refusal play out on the sheet first
    await wait(DOUBLE_TAP_MS);
    setPaying(false);
    setPending({ text: "", bounced: state.ask });
    setTyping("typing");
    setError("");
    try {
      onSave(await apiEditGame<HaggleState>(save.id, "bounce", { model, clean }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setPending(null);
      bouncing.current = false;
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
      onSave(await apiGameChat<HaggleState>(save.id, text, model, { clean }));
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
        {trading && (
          <TradePicker
            items={(run ? run.holdings : (cachedOverview()?.inventory ?? [])).filter((x) => !x.sold)}
            refresh={!run}
            balance={balance ?? null}
            onOffer={offerTrade}
            onClose={() => setTrading(false)}
          />
        )}
        {bankOpen && (run || freeBank) && (
          <Bank
            run={run ?? undefined}
            free={run ? undefined : (freeBank ?? undefined)}
            onMove={run ? undefined : async (kind, amount) => setFreeBank(await apiMoveMoney(kind, amount))}
            onClose={() => setBankOpen(false)}
          />
        )}
        {/* No round count: a chat, not a game board. Only how it stands once that changes. */}
        {(result || state.final) && (
          <span className="pref-content-badge">
            {result
              ? { deal: "Deal", walked: "Walked away", sold: "Sold", kept: "Kept it", lost: "Gone" }[result.outcome]
              : selling
                ? "Final offer"
                : "Final price"}
          </span>
        )}
      </div>

      <div className="neg-table">
        <div className="neg-merchant">
          <div className="pref-item-icon neg-face neg-face--head">
            <Avatar seed={face} size={44} />
          </div>
          <div className="pref-item-info">
            <div className="pref-item-name neg-merchant-name">
              {scenario.merchant}
              {!selling && state.seller && <SellerStars seller={state.seller} />}
            </div>
            <div className="pref-item-desc">
              <span className={`neg-presence${!result ? " is-on" : ""}`}>{presence(lastAt, !result)}</span>
              {" · "}
              {selling ? scenario.kind ?? "Buyer" : scenario.setting.split("·").pop()?.trim()}
            </div>
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
              {[
                selling ? "Your listing" : "",
                // Selling something real: what buyers pay for these, about. A listing of your own has no market to go by.
                selling && state.worth != null && scenario.id !== "custom" ? `Resells for about ${money(state.worth)}` : "",
                scenario.condition,
                scenario.setting,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
            {scenario.description && <p className="pref-item-desc">{scenario.description}</p>}
            {scenario.notes && <p className="pref-item-desc neg-notes">Seller's notes: {scenario.notes}</p>}
            {(state.buzz || state.boost || (selling && state.auth)) && (
              <span className="neg-listing-tags">
                {state.buzz && (
                  <span className="msg-timestamp">
                    {state.buzz.views} {state.buzz.views === 1 ? "view" : "views"} today
                    {state.buzz.saves ? ` · ${state.buzz.saves} saved` : ""}
                  </span>
                )}
                {!!state.boost && <span className="neg-tag">{state.boost === 2 ? "Top boost" : "Boosted"}</span>}
                {selling && state.auth?.verdict === "passed" && <span className="neg-tag is-good">Authenticated</span>}
              </span>
            )}
            {selling && state.auth && <AuthNote auth={state.auth} />}
          </div>
        )}
        <p className="msg-timestamp neg-persona">
          {scenario.merchant}: {scenario.persona}.
        </p>
        {state.switched_to && state.log.length === 0 && (
          <p className="msg-timestamp neg-notice">You switched to {state.switched_to}.</p>
        )}
        {/* Buying, you message first; selling, the buyer does */}
        {state.started_at && <p className="neg-time">{clock(state.started_at)}</p>}
        {!selling && <Line who="you" text="Hi, is this still available?" />}
        <Line
          face={face}
          who="them"
          text={say(state.opening)}
          note={state.callback ? `They were asking ${money(state.callback.was)} before.` : undefined}
        />
        {/* Selling: the buyer's opening offer comes as money you can take, as every new offer after it does */}
        {/* Selling: some buyers offer one of theirs plus cash, which stands the whole chat */}
        {selling && state.trade_in && (
          <PayCard
            who="them"
            label={`${scenario.merchant} offered a trade`}
            trade={state.trade_in.item}
            amount={state.trade_in.cash}
            status={result ? (result.trade ? "Traded" : "Expired") : undefined}
            action={!result && !pending ? { label: "Trade", onClick: () => close("trade"), disabled: busy } : undefined}
          />
        )}
        {selling &&
          (() => {
            const opening = state.opening_bid ?? state.ask;
            // A buyer's offer only goes up, so the card for the amount on the table is the one that stands
            const live = !result && !pending && opening === state.ask;
            return (
              <PayCard
                who="them"
                label={`${scenario.merchant} ${state.opening_agreed ? "sent" : "offered"}`}
                amount={opening}
                status={result?.paid === opening ? "Received" : live ? undefined : "Expired"}
                action={live ? { label: "Accept", onClick: () => setPaying(true), disabled: busy } : undefined}
              />
            );
          })()}

        {checksAt(0)}
        {state.log.map((entry, i) => (
          <Fragment key={entry.turn}>
            {gap(entry.at, i > 0 ? state.log[i - 1].at : state.started_at) && (
              <p className="neg-time">{gap(entry.at, i > 0 ? state.log[i - 1].at : state.started_at)}</p>
            )}
            {/* A payment that bounced is its declined card, not a message */}
            {entry.bounced && <PayCard who="you" label="Your payment" amount={entry.ask} status="Declined" />}
            {/* An offer sent with nothing typed is just the card */}
            {!entry.bounced && (entry.offer == null || entry.you !== bare(entry.offer)) && (
              <Line
                who="you"
                text={entry.you}
                note={
                  [
                    entry.bluff ? "A bluff. It only works once." : "",
                    entry.leverage ? "A real offer from another buyer." : "",
                    entry.sweetener && !sweeteners.find((x) => x.id === entry.sweetener)?.words
                      ? `Offered: ${sweeteners.find((x) => x.id === entry.sweetener)?.label ?? entry.sweetener}.`
                      : "",
                    i === state.log.length - 1 && !pending ? (entry.at ? `Seen ${clock(entry.at)}` : "Seen") : "",
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
            {entry.trade && (
              <PayCard
                who="you"
                label="Your trade"
                trade={entry.trade.item}
                amount={entry.trade.cash}
                status={{ accept: "Accepted", counter: "Countered", decline: "Declined", cash_only: "Declined" }[entry.trade.verdict]}
              />
            )}
            <Line
              face={face}
              who="them"
              text={say(entry.reply)}
              note={
                [
                  entry.flaw ? `Not in the listing: ${entry.flaw}. A fair reason to pay less.` : "",
                  entry.bounced
                    ? "They saw your payment bounce. It cost patience."
                    : entry.insulted
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
                  entry.calmed ? "That put them in a better mood. They have more patience now." : "",
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
            {/* Buying: a trade they said yes to, or would do for more cash, standing until the next message */}
            {entry.trade &&
              (entry.trade.verdict === "accept" || entry.trade.verdict === "counter") &&
              (() => {
                const standing = i === state.log.length - 1 && state.trade_offer;
                const traded = result?.trade && i === state.log.length - 1;
                return (
                  <PayCard
                    who="them"
                    label={entry.trade.verdict === "accept" ? `${scenario.merchant} will trade` : `${scenario.merchant} wants`}
                    trade={entry.trade.item}
                    amount={entry.trade.counter ?? entry.trade.cash}
                    status={traded ? "Traded" : standing && !result ? undefined : "Expired"}
                    action={
                      standing && !result && !pending
                        ? { label: "Trade", onClick: () => close("trade"), disabled: busy }
                        : undefined
                    }
                  />
                );
              })()}
            {/* Selling: a new offer from the buyer, which can be taken as it stands */}
            {selling &&
              !entry.agreed &&
              entry.ask !== (i > 0 ? state.log[i - 1].ask : (state.opening_bid ?? entry.ask)) &&
              (() => {
                const live = !result && !pending && entry.ask === state.ask;
                return (
                  <PayCard
                    who="them"
                    label={`${scenario.merchant} offered`}
                    amount={entry.ask}
                    status={result?.paid === entry.ask ? "Received" : live ? undefined : "Expired"}
                    action={live ? { label: "Accept", onClick: () => setPaying(true), disabled: busy } : undefined}
                  />
                );
              })()}
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
            {checksAt(entry.turn)}
          </Fragment>
        ))}

        {pending && (
          <>
            {pending.bounced !== undefined ? (
              <PayCard who="you" label="Your payment" amount={pending.bounced} status="Declined" />
            ) : (
              (pending.offer === undefined || pending.text !== bare(pending.offer)) && <Line who="you" text={pending.text} />
            )}
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

        {/* Settling the standing price, with no card of theirs to mark as done. Selling always has one:
            every offer from the buyer is a card, and the one taken shows it was received. */}
        {result?.paid != null && !selling && !(state.log.at(-1)?.agreed && state.log.at(-1)?.ask === result.paid) && (
          <PayCard who="you" label={`Paid to ${scenario.merchant}`} amount={result.paid} status="Paid" />
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
                  {state.scam
                    ? result.paid != null
                      ? `${scenario.merchant} took your ${money(result.paid)} and vanished. The listing is gone.`
                      : `${scenario.merchant} never had it. The listing was bait, and you kept your money.`
                    : result.paid != null
                      ? `You paid ${money(result.paid)} for something listed at ${money(state.list_price)}, saving ${money(result.saved ?? 0)} in ${result.rounds} ${result.rounds === 1 ? "round" : "rounds"}.`
                      : result.outcome === "lost"
                        ? `${scenario.merchant} sold it to someone who turned up first. Nothing was paid.`
                        : "You left without buying. No deal, no score."}
                </span>
                {/* A scammer had no price to hold out for */}
                {!state.scam && (
                  <span className="pref-setting-hint">
                    The lowest {scenario.merchant} would have gone was {money(result.floor)}.
                    {result.paid != null && ` You won ${result.score}% of the discount that was there to be had.`}
                  </span>
                )}
                {balance != null && result.paid != null && (
                  <span className="pref-setting-hint">Your balance is now {money(balance)}.</span>
                )}
              </>
            )}
            {result.pickup && result.pickup.kind !== "fine" && result.pickup.kind !== "scam" && (
              <div className={`neg-pickup${result.pickup.kind === "flaw" || result.pickup.kind === "trade_flaw" ? "" : " is-scam"}`}>
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
            {state.scam && (
              <ScamReport result={result} merchant={scenario.merchant} face={face} busy={busy} onReport={() => edit("report")} />
            )}
            {result.trade && (
              <span className="pref-setting-hint">
                {result.trade.gave
                  ? `You traded your ${result.trade.gave}${result.trade.cash ? ` and ${money(result.trade.cash)}` : ""} for it.`
                  : `You got their ${result.trade.got}${result.trade.cash ? ` and ${money(result.trade.cash)}` : ""}. It is in your inventory.`}
              </span>
            )}
            {state.auth && !selling && <AuthNote auth={state.auth} />}
            {(state.badges_new ?? []).length > 0 && <NewBadges badges={state.badges_new!} />}
            {state.review && <ReviewCard review={state.review} face={face} say={say} />}
            {result.paid != null && (
              <RateBack
                merchant={scenario.merchant}
                face={face}
                selling={selling}
                given={state.your_review ?? null}
                busy={rating}
                onRate={rateBack}
              />
            )}
            {run && run.status !== "active" && run.result && (
              <span className="pref-setting-label neg-run-over">
                That was the end of your run: {run.result.rating}, with a net worth of {money(run.result.net_worth)}.
              </span>
            )}
          </div>
        )}

        {/* Talk after the deal: no prices, no cards, just the chat */}
        {(state.after ?? []).map((a, i, all) => (
          <Fragment key={`after-${i}`}>
            {gap(a.at, i > 0 ? all[i - 1].at : (state.log.at(-1)?.at ?? state.started_at)) && (
              <p className="neg-time">{gap(a.at, i > 0 ? all[i - 1].at : (state.log.at(-1)?.at ?? state.started_at))}</p>
            )}
            {/* Nothing of yours before a message they sent unprompted */}
            {a.you && <Line who="you" text={a.you} />}
            <Line face={face} who="them" text={say(a.reply)} />
          </Fragment>
        ))}
        {(chatPending || ranting) && (
          <>
            {chatPending && <Line who="you" text={chatPending} />}
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
        {/* Messages blur and fade as they pass under the chips and the message box */}
        <div className="neg-feed-fade" aria-hidden="true" />
        <div ref={feedEnd} />
      </div>

      {result && chatting ? (
        <form className="input-wrapper neg-composer" onSubmit={talk}>
          <input
            ref={chatInput}
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
              <span className="pref-setting-hint">
                {result.paid == null ? "No sale." : "The deal is done."} This is just talk.
              </span>
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
          face={face}
          seller={selling ? null : state.seller}
          item={scenario.item}
          amount={state.ask}
          busy={closing}
          onConfirm={() => close("accept")}
          onDecline={bounce}
          onCancel={() => setPaying(false)}
        />
      ) : state.final ? (
        <div className="neg-controls">
          <span className="pref-setting-label">That was their final {selling ? "offer" : "price"}.</span>
          <button type="button" className="start-button" onClick={() => setPaying(true)} disabled={busy}>
            {selling ? "Accept" : "Pay"} {money(state.ask)}
          </button>
          <button type="button" className="pref-confirm-no" onClick={() => close("walk")} disabled={busy}>
            {selling ? "Reject buyer" : "Walk away"}
          </button>
        </div>
      ) : (
        <>
        <div className="neg-extras" role="group" aria-label="More you can offer">
          {sweeteners
            .filter((x) => !(state.sweeteners ?? []).includes(x.id))
            // Covering shipping only means something on a listing that ships
            .filter((x) => x.id !== "shipping" || /shipping/i.test(scenario.setting))
            // ...and coming to collect it, only on one that is picked up: not a house, a ticket or a jet
            .filter((x) => x.id !== "pickup" || /pickup/i.test(scenario.setting))
            .map((x) => (
              <button
                key={x.id}
                type="button"
                className="neg-extra"
                onClick={() => play({ sweetener: x.id })}
                disabled={busy}
                title={
                  x.words
                    ? "Puts them in a better mood and wins back some patience. It will not lower the price. Works once."
                    : x.calms
                      ? "Better terms count for something, and win back some patience. Each works once."
                      : "Better terms count for something. Each works once."
                }
              >
                <ExtraIcon name={x.id} />
                {x.label}
              </button>
            ))}
          {/* A tactic like the others, played once: not a way out, so not beside taking the price */}
          {!state.bluffed && (
            <button
              type="button"
              className="neg-extra"
              onClick={() => play({ bluff: true })}
              disabled={busy}
              title={
                selling
                  ? "Mention someone else is interested and see if their offer moves. Works once, and costs patience."
                  : "Say you are leaving and see if the price moves. Works once, and costs patience."
              }
            >
              <ExtraIcon name="bluff" />
              {selling ? "Mention another buyer" : "Bluff leaving"}
            </button>
          )}
          {!selling && (
            <button
              type="button"
              className="neg-extra"
              onClick={() => setTrading(true)}
              disabled={busy}
              title="Offer one of your things, and cash if you like, instead of paying the price"
            >
              <ExtraIcon name="trade" />
              Trade
            </button>
          )}
          {/* Finding something out, not offering anything: last, and dashed */}
          {!selling && !state.auth && canAuthenticate(scenario) && (
            <button
              type="button"
              className="neg-extra neg-extra--research"
              onClick={() => edit("authenticate")}
              disabled={busy}
              title="A third party checks it before you pay: fakes and tampering, not ordinary wear"
            >
              <ExtraIcon name="auth" />
              Authenticate
              <span className="neg-extra-cost">{money(authFee(state.ask))}</span>
            </button>
          )}
          {!selling && !state.research && (
            <button
              type="button"
              className="neg-extra neg-extra--research"
              onClick={() => edit("research")}
              disabled={busy}
              title="See what tends to go wrong with these, so you know what to ask about"
            >
              <ExtraIcon name="research" />
              Sold listings
              {inRun && <span className="neg-extra-cost">{money(RESEARCH_FEE)}</span>}
            </button>
          )}
        </div>
        <form className="input-wrapper neg-composer" onSubmit={send}>
          <input
            ref={draftInput}
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
              <label className={`neg-offer${offerDraft ? " has-value" : ""}`}>
                <span>{selling ? "Your price" : "Offer"}</span>
                {/* The field grows to fit the figure */}
                <span className="neg-offer-field">
                  <span className="neg-offer-sign" aria-hidden="true">$</span>
                  <input
                    value={offerShown}
                    style={{ width: `${Math.max(5, offerShown.length) + 0.5}ch` }}
                    onChange={(e) => setOfferDraft(e.target.value.replace(/[^\d]/g, "").slice(0, 10))}
                    inputMode="numeric"
                    placeholder="none"
                    disabled={busy}
                    aria-label={selling ? "Your price in dollars" : "Your offer in dollars"}
                  />
                </span>
              </label>
            </div>
            <div className="toolbar-right">
              {/* Walking away ends the chat, so it sits with taking the price */}
              <button type="button" className="toolbar-chip-btn neg-walk" onClick={() => close("walk")} disabled={busy}>
                {selling ? "Reject buyer" : "Walk away"}
              </button>
              <button type="button" className="neg-take" onClick={() => setPaying(true)} disabled={busy}>
                {selling ? "Sell" : "Take it"} at <strong>{money(state.ask)}</strong>
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
              Your listing for {state.scenario.item} at {money(state.list_price)} got some messages.
              {state.worth != null && state.scenario.id !== "custom" && ` It resells for about ${money(state.worth)}.`} Pick
              who to answer; the others move on. Their first offer is not their last.
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
                  <div className="pref-item-icon neg-face">
                    <Avatar seed={avatarSeed(p.merchant, null, true)} />
                  </div>
                  <div className="pref-item-info">
                    <div className="pref-item-name">
                      {p.merchant} <span className="neg-inbox-kind">· {p.kind}</span>
                    </div>
                    <div className="pref-item-desc neg-inbox-message">
                      {isCleanLanguage() ? cleanText(p.opening) : p.opening}
                    </div>
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

// Line icons for the chips above the message box, drawn on a 24 by 24 grid
const EXTRA_ICONS: Record<string, React.ReactNode> = {
  cash: (
    <>
      <rect x="2.5" y="6" width="19" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M6 9.5v5M18 9.5v5" />
    </>
  ),
  pickup: (
    <>
      <path d="M3 13l2-5.5A2 2 0 0 1 6.9 6h10.2a2 2 0 0 1 1.9 1.5L21 13v4h-2" />
      <path d="M5 17H3v-4h18" />
      <circle cx="7" cy="17" r="1.8" />
      <circle cx="17" cy="17" r="1.8" />
      <path d="M9 17h6" />
    </>
  ),
  shipping: (
    <>
      <path d="M12 3l8.5 4.5v9L12 21l-8.5-4.5v-9z" />
      <path d="M3.5 7.5L12 12l8.5-4.5M12 12v9" />
    </>
  ),
  dropoff: (
    <>
      <path d="M2.5 6h11v10h-11z" />
      <path d="M13.5 9.5h4l3 3.5V16h-7" />
      <circle cx="6.5" cy="17.5" r="1.8" />
      <circle cx="17" cy="17.5" r="1.8" />
    </>
  ),
  hold: (
    <>
      <rect x="5" y="11" width="14" height="9.5" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </>
  ),
  anytime: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  compliment: (
    <>
      <path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z" />
    </>
  ),
  auth: (
    <>
      <path d="M12 3l7.5 3v5.5c0 4.5-3.2 8.2-7.5 9.5-4.3-1.3-7.5-5-7.5-9.5V6z" />
      <path d="M8.8 12.2l2.2 2.2 4.4-4.6" />
    </>
  ),
  trade: (
    <>
      <path d="M4 8h13l-3.5-3.5" />
      <path d="M20 16H7l3.5 3.5" />
    </>
  ),
  research: (
    <>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="M15 15l5.5 5.5" />
    </>
  ),
  bluff: (
    <>
      <path d="M14 4h5v16h-5" />
      <path d="M10 8l4 4-4 4M14 12H4" />
    </>
  ),
};

function ExtraIcon({ name }: { name: string }) {
  return (
    <svg
      className="neg-extra-icon"
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {EXTRA_ICONS[name]}
    </svg>
  );
}

/** A payment bubble in the chat, as a messaging app shows money: an offer you sent, or the seller asking to be paid */
function PayCard({
  who,
  label,
  amount,
  status,
  action,
  trade,
}: {
  who: "you" | "them";
  label: string;
  amount: number;
  status?: string;
  action?: { label: string; onClick: () => void; disabled?: boolean };
  /** A trade: the item that goes with the cash, and `amount` is only the cash on top */
  trade?: string;
}) {
  // The pearl catches the light where the mouse is. Written straight to the card's style,
  // so moving the mouse never re-renders the chat.
  const tilt = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "touch") return;
    const card = e.currentTarget;
    const box = card.getBoundingClientRect();
    const x = (e.clientX - box.left) / box.width;
    const y = (e.clientY - box.top) / box.height;
    card.style.setProperty("--mx", `${(x * 100).toFixed(1)}%`);
    card.style.setProperty("--my", `${(y * 100).toFixed(1)}%`);
    card.style.setProperty("--rx", `${((0.5 - y) * 14).toFixed(2)}deg`);
    card.style.setProperty("--ry", `${((x - 0.5) * 16).toFixed(2)}deg`);
    // The raised price's depth falls away from the light, and deepens towards the edges
    card.style.setProperty("--sx", `${((0.5 - x) * 6).toFixed(2)}px`);
    card.style.setProperty("--sy", `${((0.5 - y) * 6).toFixed(2)}px`);
    card.classList.add("is-lit");
  };
  const rest = (e: React.PointerEvent<HTMLDivElement>) => {
    const card = e.currentTarget;
    for (const name of ["--mx", "--my", "--rx", "--ry", "--sx", "--sy"]) card.style.removeProperty(name);
    card.classList.remove("is-lit");
  };

  return (
    <div className={`message-row ${who === "you" ? "user" : "assistant"}`}>
      <div
        className={`neg-pay-card${status === "Declined" || status === "Expired" ? " is-void" : ""}`}
        onPointerMove={tilt}
        onPointerLeave={rest}
      >
        <span className="neg-pay-brand">{trade ? "ModelLoop Trade" : "ModelLoop Pay"}</span>
        <span className="neg-pay-label">{label}</span>
        {trade && <span className="neg-pay-trade">{trade}</span>}
        {/* The figure again in data-amount: CSS lays its metal face over the raised body */}
        {(!trade || amount > 0) && (
          <span className="neg-pay-amount" data-amount={`${trade ? "+" : ""}${money(amount)}`}>
            {trade ? "+" : ""}
            {money(amount)}
          </span>
        )}
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
  face,
  seller,
  item,
  amount,
  busy,
  onConfirm,
  onDecline,
  onCancel,
}: {
  /** Selling: the money is coming to you */
  receiving?: boolean;
  /** Hustle: what is in the account, to show what is left after and to refuse what it cannot cover */
  balance?: number;
  /** The other side: their name, face and, for a seller, their stars */
  to: string;
  face: string;
  seller?: SellerProfile | null;
  item: string;
  amount: number;
  busy: boolean;
  onConfirm: () => void;
  /** A payment the account cannot cover has just been turned down */
  onDecline?: () => void;
  onCancel: () => void;
}) {
  // The first tap arms the button; a second one soon after pays.
  // The ref is what decides: two quick taps can land before the state has redrawn.
  const [armed, setArmed] = useState(false);
  const isArmed = useRef(false);
  const disarm = useRef<number | undefined>(undefined);
  // Paying more than the account holds goes through the whole double tap, and is turned down
  const [declined, setDeclined] = useState(false);
  const undecline = useRef<number | undefined>(undefined);
  // ...after looking, for a moment, exactly like a payment going through
  const [stalling, setStalling] = useState(false);
  const stall = useRef<number | undefined>(undefined);
  const sheet = useRef<HTMLDivElement>(null);
  useEffect(
    () => () => {
      window.clearTimeout(disarm.current);
      window.clearTimeout(undecline.current);
      window.clearTimeout(stall.current);
    },
    [],
  );
  const working = busy || stalling;

  const arm = (on: boolean) => {
    isArmed.current = on;
    setArmed(on);
  };

  const short = !receiving && balance != null && balance < amount;

  const decline = () => {
    sounds.play("declined");
    setDeclined(true);
    onDecline?.();
    window.clearTimeout(undecline.current);
    undecline.current = window.setTimeout(() => setDeclined(false), DOUBLE_TAP_MS);
    // The sheet shakes its head
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      sheet.current?.animate(
        [0, -10, 9, -7, 5, -3, 0].map((x) => ({ transform: `translateX(${x}px)` })),
        { duration: 420, easing: "ease-out" },
      );
    }
  };

  const tap = () => {
    if (working) return;
    window.clearTimeout(disarm.current);
    if (isArmed.current) {
      arm(false);
      if (short) {
        setStalling(true);
        stall.current = window.setTimeout(() => {
          setStalling(false);
          decline();
        }, FAKE_PAYING_MS);
      } else onConfirm();
      return;
    }
    // A fresh try clears the last refusal
    window.clearTimeout(undecline.current);
    setDeclined(false);
    arm(true);
    disarm.current = window.setTimeout(() => arm(false), DOUBLE_TAP_MS);
  };

  return (
    <div ref={sheet} className="neg-pay-sheet" role="dialog" aria-label={receiving ? "Accept payment" : "Confirm payment"}>
      <div className="neg-pay-sheet-head">
        <span className="neg-pay-brand">ModelLoop Pay</span>
        <button type="button" className="neg-link neg-link--quiet" onClick={onCancel} disabled={working}>
          Cancel
        </button>
      </div>
      <dl className="neg-pay-rows">
        <div>
          <dt>{receiving ? "From" : "To"}</dt>
          <dd className="neg-pay-who">
            <Avatar seed={face} size={22} />
            <span className="neg-pay-name">{to}</span>
            {seller && (
              <span className={`neg-pay-stars${seller.rating < 3.5 ? " is-low" : ""}`}>★ {seller.rating.toFixed(1)}</span>
            )}
          </dd>
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
      <button
        type="button"
        className={`neg-pay-confirm${armed ? " is-armed" : ""}${declined ? " is-declined" : ""}`}
        onClick={tap}
        disabled={working}
        aria-live="polite"
      >
        <span className="neg-pay-confirm-mark" aria-hidden="true" />
        {receiving
          ? busy
            ? "Accepting"
            : armed
              ? "Tap again to accept"
              : "Double tap to accept"
          : working
            ? "Paying"
            : declined
              ? "Declined"
              : armed
                ? "Tap again to pay"
                : "Double tap to pay"}
      </button>
      {!receiving && (
        <p
          className="neg-pay-note"
          title={`${PROTECTION_PERCENT}% back if this seller turns out to be a scam. Payments made outside the app aren't covered.`}
        >
          Purchase Protection included
        </p>
      )}
    </div>
  );
}

/** How the seller's last haggling reply before this one was paced. Questions carry no tell. */
function lastTell(log: HaggleEntry[], index: number): HaggleEntry["tell"] {
  for (let i = index - 1; i >= 0; i--) if (!log[i].question) return log[i].tell ?? null;
  return null;
}

/** What the authenticator said, as a note in the chat */
function AuthNote({ auth, inFeed }: { auth: AuthCheck; inFeed?: boolean }) {
  const title = { passed: "Authenticated", failed: "Did not pass", fake: "Counterfeit", refused: "Refused" }[auth.verdict];
  return (
    <p className={`${inFeed ? "neg-feed-note" : "neg-research"} neg-auth is-${auth.verdict}`} role="note">
      <ExtraIcon name="auth" />
      <span>
        <strong>{title}:</strong> {auth.note}
        {auth.fee > 0 && ` Fee ${money(auth.fee)}.`}
      </span>
    </p>
  );
}

/** Badges a chat just earned */
function NewBadges({ badges }: { badges: Badge[] }) {
  return (
    <div className="neg-new-badges" role="status">
      {badges.map((b) => (
        <span key={b.id} className="neg-new-badge">
          <span className="neg-badge is-earned">
            <BadgeMark id={b.id} />
            New badge: {b.name}
          </span>
          <span className="pref-setting-hint">{b.how}</span>
        </span>
      ))}
    </div>
  );
}

/** Buying: pick one of your things, and cash on top if you like, to offer instead of the price */
function TradePicker({
  items,
  refresh,
  balance,
  onOffer,
  onClose,
}: {
  items: InventoryItem[];
  /** Free play: the inventory is fetched fresh, the list given is only what was known */
  refresh: boolean;
  balance: number | null;
  onOffer: (item: InventoryItem, cash: number) => void;
  onClose: () => void;
}) {
  useEscapeKey(onClose);
  const [list, setList] = useState(items);
  const [pick, setPick] = useState<string | null>(null);
  const [cash, setCash] = useState("");
  useEffect(() => {
    if (!refresh) return;
    apiOverview()
      .then((o) => setList(o.inventory.filter((x) => !x.sold)))
      .catch(() => {});
  }, [refresh]);
  const amount = Math.round(Number(cash)) || 0;
  const chosen = list.find((x) => x.id === pick);
  const short = balance != null && amount > balance;
  return createPortal(
    <div className="chat-preferences-modal-overlay" onClick={onClose}>
      <div className="landing-theme-modal neg-browser neg-trade" role="dialog" aria-label="Offer a trade" onClick={(e) => e.stopPropagation()}>
        <div className="landing-theme-modal-header">
          <span>Offer a trade</span>
          <button type="button" className="landing-theme-modal-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <p className="pref-setting-hint">
          Pick something of yours. Sellers value it at what it resells for, a bit more if it is their kind of thing. Some only take cash.
        </p>
        <div className="pref-account-card neg-browser-list">
          {list.map((x) => (
            <div
              key={x.id}
              className={`pref-list-item${pick === x.id ? " active" : ""}`}
              role="radio"
              aria-checked={pick === x.id}
              tabIndex={0}
              onClick={() => setPick(x.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setPick(x.id);
                }
              }}
            >
              <div className="pref-item-icon">{x.title.charAt(0).toUpperCase()}</div>
              <div className="pref-item-info">
                <div className="pref-item-name">{x.title}</div>
                <div className="pref-item-desc">
                  {[x.paid != null ? `You paid ${money(x.paid)}` : "", x.category, x.flaw ? `Known flaw: ${x.flaw}` : ""]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              </div>
              <span className="pref-content-badge">{money(x.value ?? x.list_price)}</span>
            </div>
          ))}
          {list.length === 0 && <p className="pref-setting-hint neg-browser-empty">Nothing to trade. Buy something first.</p>}
        </div>
        <div className="neg-trade-cash">
          <label className="neg-offer">
            <span>Plus cash</span>
            <span className="neg-offer-field">
              <span className="neg-offer-sign" aria-hidden="true">$</span>
              <input
                value={cash ? Number(cash).toLocaleString("en-US") : ""}
                onChange={(e) => setCash(e.target.value.replace(/[^\d]/g, "").slice(0, 10))}
                inputMode="numeric"
                placeholder="0"
                aria-label="Cash on top, in dollars"
              />
            </span>
          </label>
          <button type="button" className="start-button" disabled={!chosen || short} onClick={() => chosen && onOffer(chosen, amount)}>
            Offer it
          </button>
        </div>
        {short && <p className="neg-error">You only have {money(balance ?? 0)} in your account.</p>}
      </div>
    </div>,
    document.body,
  );
}

/** After a scam: report the account, as a card in the chat's own style. A payment made in the app
 *  gets some of it back from Purchase Protection; one made the scammer's way does not */
function ScamReport({
  result,
  merchant,
  face,
  busy,
  onReport,
}: {
  result: HaggleResult;
  merchant: string;
  face: string;
  busy: boolean;
  onReport: () => void;
}) {
  const pickup = result.pickup?.kind === "scam" ? result.pickup : null;
  const refunded = pickup?.refunded ?? 0;
  const desc = !result.reported
    ? pickup
      ? `Purchase Protection refunds ${PROTECTION_PERCENT}% of a payment made in the app.`
      : "Get the account removed before someone else falls for it."
    : !pickup
      ? "Thanks for reporting it before anyone else got caught."
      : pickup.off_app
        ? `You agreed to pay by ${pickup.off_app}, which Purchase Protection does not cover.`
        : pickup.due_day != null
          ? `Purchase Protection is refunding ${money(refunded)}. It arrives on day ${pickup.due_day}.`
          : `Purchase Protection refunded ${money(refunded)} of the ${money(pickup.loss ?? 0)}.`;
  return (
    <div className="pref-account-card neg-card neg-report-card">
      <div className="pref-list-item neg-row--static">
        <div className="pref-item-icon neg-face">
          <Avatar seed={face} />
        </div>
        <div className="pref-item-info">
          <div className="pref-item-name">{result.reported ? "Account removed" : `Report ${merchant}`}</div>
          <div className="pref-item-desc">{desc}</div>
        </div>
        {!result.reported ? (
          <button type="button" className="start-button" onClick={onReport} disabled={busy}>
            Report
          </button>
        ) : (
          pickup && (
            <span className={`pref-content-badge neg-report-badge${refunded ? " is-up" : " is-down"}`}>
              {refunded ? `+${money(refunded)}` : "Not covered"}
            </span>
          )
        )}
      </div>
    </div>
  );
}

/** The review the other side left you, as a card: their stars and what they said, if anything */
function ReviewCard({ review, face, say }: { review: Review; face: string; say: (text: string) => string }) {
  return (
    <div className="pref-account-card neg-card neg-review-card">
      <div className="pref-list-item neg-row--static">
        <div className="pref-item-icon neg-face">
          <Avatar seed={face} />
        </div>
        <div className="pref-item-info">
          <div className="pref-item-name neg-review-head">
            {review.by} rated you <Stars value={review.stars} />
          </div>
          <div className={`pref-item-desc${review.text && !review.pending ? "" : " neg-review-quiet"}`}>
            {review.pending
              ? `${review.by} is writing a review`
              : review.text
                ? say(review.text)
                : "Stars only, no comment."}
          </div>
        </div>
        {review.kind === "auto" && <span className="pref-content-badge neg-review-badge">Automatic</span>}
      </div>
    </div>
  );
}

/** Rate the person you just dealt with: tap the stars, add a line if you like. Once per deal. */
function RateBack({
  merchant,
  face,
  selling,
  given,
  busy,
  onRate,
}: {
  merchant: string;
  face: string;
  selling: boolean;
  given: { stars: number; text: string } | null;
  busy: boolean;
  onRate: (stars: number, text: string) => void;
}) {
  const [stars, setStars] = useState(0);
  const [hover, setHover] = useState(0);
  const [text, setText] = useState("");
  const shown = hover || stars;
  return (
    <div className="pref-account-card neg-card neg-review-card">
      <div className="pref-list-item neg-row--static neg-rate">
        <div className="pref-item-icon neg-face">
          <Avatar seed={face} />
        </div>
        <div className="pref-item-info">
          {given ? (
            <>
              <div className="pref-item-name neg-review-head">
                You rated {merchant} <Stars value={given.stars} />
              </div>
              <div className={`pref-item-desc${given.text ? "" : " neg-review-quiet"}`}>
                {given.text || "Stars only, no comment."}
              </div>
            </>
          ) : (
            <>
              <div className="pref-item-name">
                Rate {merchant} as a {selling ? "buyer" : "seller"}
              </div>
              <div className="neg-rate-stars" role="radiogroup" aria-label="Stars" onMouseLeave={() => setHover(0)}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    role="radio"
                    aria-checked={stars === n}
                    aria-label={`${n} ${n === 1 ? "star" : "stars"}`}
                    className={`neg-rate-star${n <= shown ? " is-on" : ""}`}
                    onMouseEnter={() => setHover(n)}
                    onClick={() => setStars(n)}
                    disabled={busy}
                  >
                    ★
                  </button>
                ))}
              </div>
              {stars > 0 && (
                <form
                  className="neg-rate-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    onRate(stars, text.trim());
                  }}
                >
                  <input
                    className="chat-textarea neg-rate-input"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    maxLength={200}
                    placeholder="Add a comment (optional)"
                    aria-label="Your review"
                    disabled={busy}
                  />
                  <button type="submit" className="start-button" disabled={busy}>
                    {busy ? "Posting" : "Post"}
                  </button>
                </form>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** The seller's stars beside their name in the chat. Few ratings and a low score is a warning sign */
function SellerStars({ seller }: { seller: SellerProfile }) {
  const low = seller.rating < 3.5;
  return (
    <span
      className={`neg-seller-stars${low ? " is-low" : ""}`}
      title={`${seller.rating.toFixed(1)} from ${seller.ratings} ${seller.ratings === 1 ? "rating" : "ratings"} · Joined in ${seller.joined} · Usually replies ${seller.replies}`}
    >
      <span aria-hidden="true">
        {"★".repeat(Math.round(seller.rating))}
        {"☆".repeat(5 - Math.round(seller.rating))}
      </span>
      <span className="neg-seller-score">
        {seller.rating.toFixed(1)} ({seller.ratings})
      </span>
    </span>
  );
}

/** One line of the haggle as a chat bubble, with an optional note where the timestamp would go */
function Line({ who, text, note, face }: { who: "you" | "them"; text: string; note?: string; face?: string }) {
  const role = who === "you" ? "user" : "assistant";
  const bubble = (
    <div className={`msg-bubble-group${who === "you" ? " user-group" : ""}`}>
      <div className={`message ${role}`}>{text}</div>
      {note && (
        <div className={`msg-meta${who === "you" ? " user-meta" : ""}`}>
          <span className="msg-timestamp">{note}</span>
        </div>
      )}
    </div>
  );
  return (
    <div className={`message-row ${role}`}>
      {face ? (
        <div className="neg-said">
          <Avatar seed={face} size={30} className="neg-said-face" />
          {bubble}
        </div>
      ) : (
        bubble
      )}
    </div>
  );
}
