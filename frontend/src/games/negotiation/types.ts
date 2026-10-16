// Mirrors the state built by backend/games/negotiation/engine.py (buying) and selling.py (selling)

/** Buying ends in a deal or walking away; selling in a sale or keeping the item */
export type HaggleStatus = "choosing" | "active" | "deal" | "walked" | "sold" | "kept" | "lost";

/** Selling: a buyer who messaged about the listing, waiting in the inbox to be answered */
export interface Prospect {
  merchant: string;
  kind: string;
  persona: string;
  /** Their first message, with their offer in it */
  opening: string;
  opening_bid: number;
  patience: number;
  /** They offered the asking price or more */
  opening_agreed: boolean;
}
export type HaggleMode = "buy" | "sell";

export interface HaggleEntry {
  turn: number;
  you: string;
  offer: number | null;
  reply: string;
  /** How the merchant took the message, from -2 to 2 */
  persuasion: number;
  /** The offer was low enough to cost extra patience */
  insulted: boolean;
  /** A question about the item, not haggling: it cost no patience and moved nothing */
  question?: boolean;
  /** The player had already sent this exact message */
  repeated?: boolean;
  /** The player said they were leaving, to see if the price would move */
  bluff?: boolean;
  /** How the merchant replied, which hints at how much room is left in the price */
  tell?: "quick" | "slow" | "hesitant" | null;
  /** The seller said yes to a price this round. Nothing is bought until the player pays it. */
  agreed?: boolean;
  /** The merchant's price after this round */
  ask: number;
  final: boolean;
  /** A term other than money offered with this message, by id */
  sweetener?: string | null;
  /** Patience a better mood won back this round */
  calmed?: number;
  /** Selling: another buyer's real offer was held up against this one */
  leverage?: boolean;
  /** Buying: the seller owned up to a flaw the listing left out */
  flaw?: string;
  /** Buying: someone else bought it first */
  lost?: boolean;
  /** Buying: not a message but a payment that bounced, which the seller reacted to */
  bounced?: boolean;
  /** Selling: one of the other buyers messaged with a better offer after this round */
  ping?: { merchant: string; offer: number };
  /** Buying: a trade offered with this message, and what the seller made of it */
  trade?: TradeOffer;
  /** When the round was played */
  at?: string;
}

/** What happened when the item changed hands */
export interface Pickup {
  /** trade_flaw: something a buyer traded you had a flaw they kept quiet about */
  kind: "fine" | "flaw" | "counterfeit" | "fake_payment" | "scam" | "trade_flaw";
  issue: string;
  loss?: number;
  /** A flaw: what the seller might give back, if asked */
  refund?: number;
  asked?: boolean;
  refunded?: number | null;
  /** A scam, once reported: how the buyer agreed to pay outside the app, which Purchase Protection does not cover */
  off_app?: string | null;
  /** Hustle: the day a covered refund arrives */
  due_day?: number;
}

export interface HaggleResult {
  outcome: "deal" | "walked" | "sold" | "kept" | "lost";
  /** 0 to 100: the share of the possible discount the player won */
  score: number;
  rating: string;
  paid: number | null;
  saved: number | null;
  /** The lowest the merchant would have gone, revealed once it is over */
  floor: number;
  rounds: number;
  /** Selling: the most the buyer would have paid */
  ceiling?: number;
  /** Selling something from the inventory: the sale price less what was paid for it */
  profit?: number | null;
  pickup?: Pickup;
  /** The scammer was reported, after paying them or after walking away */
  reported?: boolean;
  /** Selling in Hustle: the payment bounced */
  scammed?: boolean;
  /** A trade: only this much was cash; `paid` counts the item too */
  paid_cash?: number;
  /** Buying: what you gave. Selling: what you got */
  trade?: { gave?: string; got?: string; value: number; cash: number; flaw?: string | null };
}

/** A trade the player offered a seller. Mirrors trades.judge in backend/games/negotiation/trades.py */
export interface TradeOffer {
  item_id: string;
  item: string;
  value: number;
  cash: number;
  category?: string | null;
  verdict: "accept" | "counter" | "decline" | "cash_only";
  /** The cash they want added, on a counter */
  counter?: number;
}

/** What an authenticator said */
export interface AuthCheck {
  verdict: "passed" | "failed" | "fake" | "refused";
  fee: number;
  note: string;
  /** Buying: the turn it was checked after, to show it in the chat there */
  turn?: number;
}

/** A listing the player saved. Mirrors market.toggle_saved in backend/games/negotiation/market.py */
export interface SavedListing {
  listing: string;
  /** The share of its usual price it is down to */
  cut: number;
  /** What changed since it was last opened: a drop, or it sold to someone else */
  news?: "drop" | "sold" | null;
  /** Before the latest drops */
  was?: number | null;
  gone?: boolean;
}

/** A listing's buzz today, as [views, saves, just listed (1 or 0), busy (1 or 0)] */
export type Buzz = [number, number, number, number];

/** A badge on the profile. Mirrors badges.py */
export interface Badge {
  id: string;
  name: string;
  how: string;
  rarity?: number;
  /** When it was earned; null while still to earn */
  at?: string | null;
  /** How far along it is: what you have, what it takes, and whether that is a count, dollars or a percent */
  progress?: { have: number; need: number; unit: "count" | "money" | "percent" };
}

/** A marketplace listing, as the start screen shows it */
export interface HaggleListing {
  id: string;
  item: string;
  merchant: string;
  /** Where it is listed and how it changes hands, such as "Marketplace · Local pickup" */
  setting: string;
  /** "Used - Good" and the like; null where it does not apply, as with tickets */
  condition: string | null;
  description: string;
  list_price: number;
  /** What it resells for. Sellers misprice things, so this can sit well above or below the price */
  value: number;
  /** The shelf it sits on, such as "Consoles" or "Fragrance" */
  category: string;
  /** The seller's public profile. Flavour only: it says nothing of how low they will go */
  seller?: SellerProfile;
}

export interface SellerProfile {
  /** The year they joined the Marketplace */
  joined: number;
  /** Out of 5, from `ratings` buyers */
  rating: number;
  ratings: number;
  /** "within minutes", "within an hour" or "within a few hours" */
  replies: string;
}

export interface HaggleState {
  status: HaggleStatus;
  /** Missing on haggles from before selling existed; those are buying */
  mode?: HaggleMode;
  /** Selling: what it resells for, which the buyers' limits come from */
  worth?: number;
  /** Selling: what the player paid for it, if it came from the inventory */
  cost?: number | null;
  /** Selling: the buyer's first offer */
  opening_bid?: number;
  /** Selling: the buyer opened at the asking price, so they will pay it as soon as the player accepts */
  opening_agreed?: boolean;
  /** The Hustle run this chat belongs to, if any */
  run_id?: string;
  turn: number;
  difficulty: string;
  /** Haggles saved before listings had them carry no condition or description */
  scenario: {
    id: string;
    item: string;
    merchant: string;
    setting: string;
    persona: string;
    condition?: string | null;
    description?: string;
    category?: string | null;
    /** Selling: what sort of buyer this is, such as "Collector" */
    kind?: string;
    /** Selling in a Hustle run: the player's own claims, shown under the item's real description */
    notes?: string | null;
  };
  opening: string;
  list_price: number;
  ask: number;
  patience: number;
  patience_max: number;
  /** The merchant has named a last price: no more talking, only take it or walk */
  final: boolean;
  /** The one bluff has been used */
  bluffed?: boolean;
  /** Buying: the seller has already seen a payment of the player's bounce */
  bounced?: boolean;
  log: HaggleEntry[];
  result: HaggleResult | null;
  /** Selling, before a buyer is picked: everyone who messaged */
  prospects?: Prospect[];
  /** Talk after the haggle is over, oldest first */
  after?: { you: string; reply: string; at?: string }[];
  /** When the chat opened */
  started_at?: string;
  /** Terms other than money already offered, by id */
  sweeteners?: string[];
  /** Buying: a flaw the seller has owned up to (one not yet found stays hidden) */
  flaw?: { text: string; revealed: boolean } | null;
  /** Buying: what checking sold listings turned up */
  research?: string | null;
  /** The turn sold listings were checked after, to show it in the chat there */
  research_turn?: number;
  /** Buying: the seller's account as the chat shows it. A scammer's is new, with a few bad ratings */
  seller?: SellerProfile | null;
  /** Buying: the listing was bait. Only sent once the chat is over */
  scam?: { payment: string; cover: string } | null;
  /** Selling: a better offer from another buyer, standing until used */
  ping?: { merchant: string; offer: number } | null;
  /** Selling: the buyer switched to after a better offer */
  switched_to?: string;
  /** Hustle: a seller who messaged again, and their price before */
  callback?: { was: number } | null;
  /** The stars the other side left once it was over */
  review?: Review | null;
  /** Your stars for the other side, once you have rated them */
  your_review?: { stars: number; text: string; at: string } | null;
  /** Buying: how many looked at and saved the listing today */
  buzz?: { views: number; saves: number } | null;
  /** Buying: the authenticator's verdict. Selling: the one from before listing */
  auth?: AuthCheck | null;
  /** Buying: a trade the seller agreed to, or countered, standing until the next message */
  trade_offer?: TradeOffer | null;
  /** Selling: a trade the buyer offered alongside their cash offer */
  trade_in?: { listing: string; item: string; value: number; cash: number; category?: string | null } | null;
  /** Selling: how far the listing was boosted, 0 for not at all */
  boost?: number;
  /** Badges this chat earned, shown with the result */
  badges_new?: Badge[];
}

/** A review someone left you. Mirrors extras.review in backend/games/negotiation/extras.py */
export interface Review {
  id?: string;
  stars: number;
  /** Empty when they left stars alone */
  text: string;
  by: string;
  /** What you were doing: buying from them, or selling to them. Missing on older reviews */
  role?: HaggleMode;
  item?: string | null;
  listing?: string | null;
  /** written: in their own words; stars: no comment; auto: the marketplace's, after a smooth deal */
  kind?: "written" | "stars" | "auto";
  /** Still being written by the model */
  pending?: boolean;
  at?: string;
}

/** A review you left someone else */
export interface GivenReview {
  /** Missing on reviews left before they had ids; those are picked out by `at` */
  id?: string;
  stars: number;
  text: string;
  to: string;
  item?: string | null;
  listing?: string | null;
  role: HaggleMode;
  at: string;
}

/** Your marketplace profile. Mirrors profile in backend/games/negotiation/reviews.py */
export interface MarketProfile {
  name: string;
  joined: string | null;
  rating: number | null;
  review_count: number;
  /** How many reviews gave each number of stars, 5 down to 1 */
  split: Record<string, number>;
  /** What your rating does to people's patience: one more, none, or one less */
  trust: number;
  bought: number;
  sold: number;
  spent: number;
  earned: number;
  best_flip: { profit: number; item: string } | null;
  /** Newest first */
  reviews: Review[];
  given: GivenReview[];
  /** Every badge, earned or not */
  badges: Badge[];
  /** The rarest earned, by id, to show beside your name */
  top: string[];
}

export interface HaggleSummary {
  turn: number;
  status: HaggleStatus;
  mode?: HaggleMode;
  item: string;
  merchant: string | null;
  ask: number | null;
  /** Buyers still waiting in the inbox */
  prospects?: number;
  /** Buying: the listing, whose seller's face it shows */
  listing?: string | null;
}

/** Something bought in Negotiation. Purchases from before the inventory may lack the listing's details. */
export interface InventoryItem {
  id: string;
  title: string;
  /** 0 to 100: the share of the possible discount won */
  score: number;
  rating: string;
  bought_at: string;
  paid: number | null;
  list_price: number;
  /** What buyers will pay for it, about; purchases from before it was tracked go by the listed price */
  value?: number | null;
  saved?: number | null;
  rounds?: number | null;
  merchant: string;
  difficulty?: string;
  condition?: string | null;
  category?: string | null;
  description?: string | null;
  setting?: string | null;
  /** Hustle: the seller's notes the player added the last time it went up for sale */
  notes?: string | null;
  /** Hustle: it turned out to be a fake at pickup */
  fake?: boolean;
  /** A flaw found while buying it, or at pickup */
  flaw?: string | null;
  /** Sold on again, and how that went */
  sold?: { price: number; profit: number | null; buyer: string; rating: string; at: string; traded?: boolean } | null;
}

/** A listing the player writes themselves */
export interface CustomListing {
  item: string;
  price: number;
  condition: string | null;
  category: string | null;
  description: string;
}

/** One line of a bank statement, in a Hustle run or free play */
export interface LedgerEntry {
  /** Hustle only: free play has no days */
  day?: number;
  /** Free play also has deposits and withdrawals: money from and to nowhere */
  kind: "buy" | "sell" | "deposit" | "withdraw" | "fee" | "refund";
  item: string;
  /** Who it was bought from or sold to */
  other: string;
  /** Negative for money out */
  amount: number;
  /** The balance after it */
  balance: number;
  holding?: string;
  /** Something worth knowing about it, such as a payment that bounced */
  note?: string;
  /** Sales: the price less what was paid */
  profit?: number;
  at: string;
}

/** The free play bank account. Mirrors backend/games/negotiation/bank.py */
export interface FreeBank {
  start_cash: number;
  cash: number;
  ledger: LedgerEntry[];
  /** Cash plus what was paid for everything still held */
  net_worth: number;
  /** Deposits less withdrawals, left out of trading profit */
  deposited: number;
  /** Your marketplace rating out of 5, once someone has reviewed you */
  rating: number | null;
  /** The latest reviews, newest first */
  reviews: Review[];
  /** The reviews you left others, oldest first */
  given?: GivenReview[];
  /** Free play's saved listings */
  saved?: SavedListing[];
  review_count: number;
  /** How many purchases are still held */
  held: number;
}

/** A Hustle run: Marketplace with a real balance and a set number of days. Mirrors backend/games/negotiation/hustle.py */
export interface HustleRun {
  id: string;
  status: "active" | "finished" | "broke";
  start_cash: number;
  cash: number;
  /** Chats started so far; each uses a day */
  day: number;
  days: number;
  net_worth: number;
  /** What was bought in the run, sold or not */
  holdings: InventoryItem[];
  ledger: LedgerEntry[];
  milestones: number[];
  /** Listings saved in this run */
  saved?: SavedListing[];
  /** Sellers who messaged again after you walked away */
  callbacks?: { id: string; scenario: string; merchant: string; item: string; price: number; was: number }[];
  result: {
    net_worth: number;
    cash: number;
    profit: number;
    rating: string;
    days_used: number;
    bought: number;
    sold: number;
    best_flip: number | null;
    worst_flip: number | null;
  } | null;
}
