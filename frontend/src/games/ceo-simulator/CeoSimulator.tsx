import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import {
  apiCreateGame,
  apiDeleteGame,
  apiEditGame,
  apiGameScores,
  apiGetGame,
  apiListGames,
  apiPlayTurn,
  type GameSave,
  type GameScoreRow,
  type GameSaveSummary,
} from "../api";
import { useOpenSave } from "../useOpenSave";
import { BackButton } from "../BackButton";
import type { GameProps } from "../types";
import { DIFFICULTIES, LEVELS, ROLE_TITLE, STYLES, type Difficulty, type FounderStyle, type Role } from "./setup";
import { TrendChart } from "./TrendChart";
import type { CeoPerson, CeoProduct, CeoState } from "./types";
import "./ceo.css";

const GAME_TYPE = "ceo-simulator";
const MAX_START_PRODUCTS = 4;
const MAX_PRODUCTS = 8;
const LAUNCH_COST = 3000;
const RESCUE_GRANT = 50000;
// Team rules, as in the engine
const DESK_COST = 150;
const REVENUE_PER_PERSON = 5000;
const POOL_REFRESH = 4;
// Loan terms, as in the engine
const LOAN_WEEKS = 26;
const LOAN_INTEREST = 0.15;
const MIN_LOAN = 5000;
// The most one cash infusion can be, as in the engine
const MAX_INFUSION = 1_000_000_000_000;
const EARLY_REPAY_INTEREST = 0.5;

/** What it costs to clear a loan today. Mirrors payoff_amount in the engine. */
function payoff(loan: { principal: number; weeks_left: number }): number {
  return Math.ceil(((loan.principal * loan.weeks_left) / LOAN_WEEKS) * (1 + LOAN_INTEREST * EARLY_REPAY_INTEREST));
}

type SideTab = "team" | "products" | "money" | "buzz";
const TABS: { id: SideTab; label: string }[] = [
  { id: "team", label: "Team" },
  { id: "products", label: "Products" },
  { id: "money", label: "Money" },
  { id: "buzz", label: "Buzz" },
];
const TAB_KEY = "ceo_side_tab";

function savedTab(): SideTab {
  try {
    const saved = localStorage.getItem(TAB_KEY);
    if (TABS.some((t) => t.id === saved)) return saved as SideTab;
  } catch {
    // storage unavailable: use the default
  }
  return "team";
}

const YES_NO = [
  { id: "accept", label: "Accept", hint: undefined },
  { id: "reject", label: "Reject", hint: undefined },
];

const OUTCOME_LABEL: Record<string, string> = {
  bankrupt: "Bankrupt",
  sold: "Sold",
  finished: "Year complete",
};

// A decision made with a form in the dashboard instead of typed out
type TurnAction =
  | { type: "launch"; name: string; price: number }
  | { type: "discontinue"; product_id: string }
  | { type: "hire"; role: Role; count: number };

type CeoSave = GameSave<CeoState>;
type ProductDraft = { name: string; price: string };

function money(amount: number): string {
  const rounded = Math.abs(amount) < 100 && !Number.isInteger(amount) ? amount.toFixed(2) : Math.round(amount).toLocaleString();
  return `${amount < 0 ? "-" : ""}$${rounded.replace("-", "")}`;
}

function signedMoney(amount: number): string {
  return `${amount >= 0 ? "+" : "-"}$${Math.abs(Math.round(amount)).toLocaleString()}`;
}

export function CeoSimulator({ model, onExit }: GameProps) {
  // The open company is kept in the address bar, so a refresh reopens it
  const [save, setSave, restoring] = useOpenSave<CeoState>("ceo-simulator");

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

  if (save) {
    return (
      <Play
        save={save}
        model={model}
        onSave={(next) => setSave((prev) => (typeof next === "function" ? prev && next(prev) : next))}
        onLeave={() => setSave(null)}
      />
    );
  }
  return <Menu onOpen={setSave} onExit={onExit} />;
}

// ---- Menu: saved companies and the new company form ----

function Menu({ onOpen, onExit }: { onOpen: (save: CeoSave) => void; onExit: () => void }) {
  const [saves, setSaves] = useState<GameSaveSummary[] | null>(null);
  const [scores, setScores] = useState<GameScoreRow[]>([]);
  const [company, setCompany] = useState("");
  const [pitch, setPitch] = useState("");
  const [products, setProducts] = useState<ProductDraft[]>([{ name: "", price: "" }]);
  const [difficulty, setDifficulty] = useState<Difficulty>("normal");
  const [style, setStyle] = useState<FounderStyle>("bootstrapper");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    apiListGames(GAME_TYPE)
      .then(setSaves)
      .catch(() => setSaves([]));
    apiGameScores(GAME_TYPE)
      .then(setScores)
      .catch(() => setScores([]));
  }, []);

  const setProduct = (index: number, patch: Partial<ProductDraft>) =>
    setProducts((list) => list.map((p, i) => (i === index ? { ...p, ...patch } : p)));

  const filled = products.filter((p) => p.name.trim() && Number(p.price) > 0);
  const ready = company.trim().length > 0 && filled.length > 0 && filled.length === products.length;

  const start = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError("");
    try {
      onOpen(
        await apiCreateGame<CeoState>(GAME_TYPE, {
          company: company.trim(),
          pitch: pitch.trim(),
          products: filled.map((p) => ({ name: p.name.trim(), price: Number(p.price) })),
          difficulty,
          style,
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setBusy(false);
    }
  };

  const open = async (id: string) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      onOpen(await apiGetGame<CeoState>(id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await apiDeleteGame(id);
      setSaves((list) => list?.filter((s) => s.id !== id) ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  };

  return (
    <div className="ceo ceo--menu">
      <div className="ceo-menu">
        <div className="game-menu-head">
          <BackButton label="Back to all games" onClick={onExit} />
          <h2 className="ceo-title">Founder Mode</h2>
        </div>
        <p className="ceo-sub">
          Each turn is one week. Your score is what your share of the company is worth after one year, and the
          company keeps going for as long as you want after that. Reach $2,500,000 to win.
        </p>

        {saves && saves.length > 0 && (
          <>
            <h3 className="pref-field-label ceo-section">Your companies</h3>
            <div className="pref-account-card ceo-list">
              {saves.map((s) => (
                <div
                  key={s.id}
                  className="pref-list-item"
                  role="button"
                  tabIndex={0}
                  aria-disabled={busy}
                  onClick={() => open(s.id)}
                  onKeyDown={(e) => {
                    // Only the row itself: Enter on the Delete button inside must not open the company
                    if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
                      e.preventDefault();
                      open(s.id);
                    }
                  }}
                >
                  <div className="pref-item-icon">{s.title.charAt(0).toUpperCase()}</div>
                  <div className="pref-item-info">
                    <div className="pref-item-name">{s.title}</div>
                    <div className="pref-item-desc">
                      {s.summary.status === "active" || !s.summary.result
                        ? `Week ${s.summary.turn + 1} · ${money(s.summary.cash)} cash` +
                          (s.summary.official_result
                            ? ` · free play, scored ${money(s.summary.official_result.score)}`
                            : "")
                        : `${OUTCOME_LABEL[s.summary.status] ?? "Ended"} · ${s.summary.result.rating} · ${money(s.summary.result.score)}`}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="ceo-link ceo-link--quiet"
                    onClick={(e) => {
                      e.stopPropagation();
                      remove(s.id);
                    }}
                    aria-label={`Delete ${s.title}`}
                  >
                    Delete
                  </button>
                </div>
              ))}
            </div>
          </>
        )}

        {scores.length > 0 && (
          <>
            <h3 className="pref-field-label ceo-section">Best runs</h3>
            <div className="pref-account-card ceo-list">
              {scores.map((row, i) => (
                <div key={row.id} className="pref-list-item ceo-row--static">
                  <div className="pref-item-icon">{i + 1}</div>
                  <div className="pref-item-info">
                    <div className="pref-item-name">{row.title}</div>
                    <div className="pref-item-desc">
                      {[
                        row.rating,
                        row.difficulty && row.difficulty !== "normal" ? row.difficulty : undefined,
                        row.outcome ? OUTCOME_LABEL[row.outcome]?.toLowerCase() : undefined,
                        row.weeks ? `${row.weeks} weeks` : undefined,
                        row.typed_cash ? `${money(row.typed_cash)} typed in` : undefined,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </div>
                  <span className="pref-content-badge">{money(row.score)}</span>
                </div>
              ))}
            </div>
          </>
        )}

        <form className="ceo-form" onSubmit={start}>
          <h3 className="pref-field-label ceo-section">Start a new company</h3>
          <div className="pref-account-card ceo-list ceo-fields">
            <div className="login-field">
              <label htmlFor="ceo-company">Company name</label>
              <input
                id="ceo-company"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                maxLength={60}
                placeholder="Brew Co"
              />
            </div>

            <div className="login-field">
              <label htmlFor="ceo-pitch">What does it do? (optional)</label>
              <input
                id="ceo-pitch"
                value={pitch}
                onChange={(e) => setPitch(e.target.value)}
                maxLength={200}
                placeholder="Specialty coffee delivered every month"
              />
            </div>

            <div className="login-field">
              <label htmlFor="ceo-product-0">Products you sell</label>
              {products.map((p, i) => (
                <div key={i} className="ceo-product-row">
                  <input
                    id={`ceo-product-${i}`}
                    value={p.name}
                    onChange={(e) => setProduct(i, { name: e.target.value })}
                    maxLength={40}
                    placeholder="Product name"
                    aria-label={`Product ${i + 1} name`}
                  />
                  <div className="ceo-price">
                    <span>$</span>
                    <input
                      value={p.price}
                      onChange={(e) => setProduct(i, { price: e.target.value.replace(/[^\d.]/g, "") })}
                      inputMode="decimal"
                      placeholder="Price"
                      aria-label={`Product ${i + 1} price`}
                    />
                  </div>
                  {products.length > 1 && (
                    <button
                      type="button"
                      className="ceo-link ceo-link--quiet"
                      onClick={() => setProducts((list) => list.filter((_, j) => j !== i))}
                    >
                      Remove
                    </button>
                  )}
                </div>
              ))}
              {products.length < MAX_START_PRODUCTS && (
                <button
                  type="button"
                  className="ceo-link"
                  onClick={() => setProducts((list) => [...list, { name: "", price: "" }])}
                >
                  Add another product
                </button>
              )}
            </div>
          </div>

          <Picker label="Founder style" options={STYLES} value={style} onChange={setStyle} />
          <Picker label="Difficulty" options={DIFFICULTIES} value={difficulty} onChange={setDifficulty} />

          {error && <p className="ceo-error">{error}</p>}

          <div className="ceo-start">
            <button type="submit" className="start-button" disabled={!ready || busy}>
              {busy ? "Starting" : "Start company"}
            </button>
            <span className="pref-setting-hint">
              You begin with {money(DIFFICULTIES.find((d) => d.id === difficulty)!.cash)} and no staff. Your first job
              is to hire a team with it.
            </span>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---- Play: the story on the left, the company's numbers on the right ----

function Play({
  save,
  model,
  onSave,
  onLeave,
}: {
  save: CeoSave;
  model?: string;
  /** A new save, or a function of the current one for changes shown before the server confirms them */
  onSave: (next: CeoSave | ((current: CeoSave) => CeoSave)) => void;
  onLeave: () => void;
}) {
  const state = save.state;
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState("");
  const feedEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    feedEnd.current?.scrollIntoView({ block: "end" });
  }, [state.log.length, pending, error, state.offer]);

  const decide = useCallback(
    async (decision: string, action?: TurnAction) => {
      const text = decision.trim();
      if (!text || pending) return;
      setPending(text);
      setError("");
      if (!action) setDraft("");
      try {
        onSave(await apiPlayTurn<CeoState>(save.id, text, model, action));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong.");
        if (!action) setDraft(text);
      } finally {
        setPending(null);
      }
    },
    [pending, save.id, model, onSave],
  );

  const editProduct = async (product: CeoProduct, changes: { name?: string; price?: number }) => {
    if (changes.price !== undefined && !(changes.price > 0)) return;
    setError("");
    try {
      onSave(await apiEditGame<CeoState>(save.id, `products/${product.id}`, changes));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  };

  // The product whose Discontinue button has been clicked once and awaits a second click
  const [dropId, setDropId] = useState<string | null>(null);
  const answerOffer = async (choice: string) => {
    setError("");
    try {
      onSave(await apiEditGame<CeoState>(save.id, "offer", { choice }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  };

  const borrow = async (amount: number) => {
    setError("");
    try {
      onSave(await apiEditGame<CeoState>(save.id, "loan", { amount }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  };

  const infuse = async (amount: number) => {
    setError("");
    try {
      onSave(await apiEditGame<CeoState>(save.id, "infuse", { amount }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  };

  const repay = async (index: number) => {
    setError("");
    try {
      onSave(await apiEditGame<CeoState>(save.id, "loan/repay", { index }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  };

  const undo = async () => {
    setError("");
    try {
      onSave(await apiEditGame<CeoState>(save.id, "undo", {}));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  };

  // Hires and draft undos show at once and are sent in the background, one at a
  // time and in order: each request reads the save the previous one wrote, so two
  // sent together would overwrite each other.
  const sendQueue = useRef<Promise<void>>(Promise.resolve());
  const unsent = useRef(0);
  const [syncing, setSyncing] = useState(false);

  const staffChange = (path: string, body: unknown, showNow?: (state: CeoState) => CeoState) => {
    setError("");
    if (showNow) onSave((current) => ({ ...current, state: showNow(current.state) }));
    unsent.current += 1;
    setSyncing(true);
    sendQueue.current = sendQueue.current.then(async () => {
      try {
        const confirmed = await apiEditGame<CeoState>(save.id, path, body);
        unsent.current -= 1;
        // Mid-burst, the screen is ahead of this reply: only the last one is the whole truth.
        if (unsent.current === 0) onSave(confirmed);
      } catch (err) {
        unsent.current -= 1;
        setError(err instanceof Error ? err.message : "Something went wrong.");
        try {
          onSave(await apiGetGame<CeoState>(save.id)); // what was shown did not happen: reload what did
        } catch {
          // offline: the error above stands
        }
      } finally {
        if (unsent.current === 0) setSyncing(false);
      }
    });
  };

  const hire = (person: CeoPerson) =>
    staffChange("staff/hire", { candidate_id: person.id }, (current) => ({
      ...current,
      cash: current.cash - person.fee,
      employees: current.employees + 1,
      candidates: (current.candidates ?? []).filter((c) => c.id !== person.id),
      staff: [...(current.staff ?? []), person],
    }));

  const release = (person: CeoPerson) =>
    staffChange(
      `staff/${person.id}/release`,
      {},
      // Before week one this is a plain refund. Later it costs severance and morale, which the server works out.
      state.turn === 0
        ? (current) => ({
            ...current,
            cash: current.cash + person.fee,
            employees: Math.max(0, current.employees - 1),
            staff: (current.staff ?? []).filter((p) => p.id !== person.id),
            candidates: [...(current.candidates ?? []), person],
          })
        : undefined,
    );

  const keepGoing = async () => {
    setError("");
    try {
      onSave(await apiEditGame<CeoState>(save.id, "continue", {}));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  };

  const [tab, setTab] = useState<SideTab>(savedTab);
  const pickTab = (next: SideTab) => {
    setTab(next);
    try {
      localStorage.setItem(TAB_KEY, next);
    } catch {
      // not remembered this time
    }
  };

  // On a phone the side panel is a short strip, and the rest of it opens as a sheet
  const [details, setDetails] = useState(false);
  useEffect(() => {
    if (!details) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDetails(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [details]);

  const staff = state.staff ?? [];
  const payroll = staff.reduce((sum, p) => sum + p.salary + DESK_COST, 0);
  // What the team can sell in a week at ordinary morale, and what the products are likely to sell
  const capacity = Math.round(staff.reduce((sum, p) => sum + p.power, 0) * REVENUE_PER_PERSON);
  const expected = state.start_revenue ?? 14000;
  // A dot on a tab when something behind it wants attention
  const needsYou: Record<SideTab, boolean> = {
    team:
      state.status === "active" &&
      ((state.workload ?? 0) >= 100 || (state.turn > 0 && state.candidates_turn === state.turn)),
    products: false,
    money: state.status === "active" && state.cash < 0,
    buzz: false,
  };
  const stake = Math.round(state.valuation * state.equity);
  const over = state.status !== "active";
  const previous = state.history[state.history.length - 2];
  const revenueDelta = previous ? state.last.revenue - previous.revenue : null;
  const active = state.products.filter((p) => p.active);

  return (
    <div className="ceo ceo--play">
      <div className="ceo-bar">
        <BackButton label="Back to all companies" onClick={onLeave} />
        <span className="ceo-bar-name">{state.company.name}</span>
        <span className="pref-content-badge">
          {over
            ? (OUTCOME_LABEL[state.status] ?? "Closed")
            : state.free_play
              ? `Week ${state.turn + 1} · Free play`
              : `Week ${state.turn + 1} of ${state.length}`}
        </span>
      </div>

      <div className="ceo-body">
        <div className="ceo-main">
          <div className="ceo-feed">
            <p className="msg-timestamp ceo-opening">
              {state.company.name} opens with {money(state.start_cash)} in the bank.
              {state.turn === 0 &&
                (staff.length === 0
                  ? " Before week one, hire your team from the people below."
                  : " Hire anyone else you want, then make your first decision.")}
            </p>

            {state.turn === 0 && !over && (
              <div className="ceo-entry">
                <div className="ceo-entry-head">
                  <span className="ceo-entry-week">Build your team</span>
                  <span className="ceo-entry-week">
                    {staff.length} hired · {money(payroll)} a week
                  </span>
                </div>
                <p className="ceo-hint">
                  Everyone adds capacity. Sales, product and support people also do one extra thing every week. Higher
                  levels do more per person and cost more per result. You expect about {money(expected)} of sales a
                  week, and this team can handle {money(capacity)}.
                </p>
                <People
                  people={state.candidates ?? []}
                  action="Hire"
                  cash={state.cash}
                  onPick={hire}
                />
              </div>
            )}

            {state.log.map((entry) => (
              <Fragment key={entry.turn}>
              <Decision text={entry.decision} />
              <div className="ceo-entry">
                <div className="ceo-entry-head">
                  <span className="ceo-entry-week">Week {entry.turn}</span>
                  <span className={`ceo-entry-profit${entry.financials.profit < 0 ? " is-down" : " is-up"}`}>
                    {signedMoney(entry.financials.profit)}
                  </span>
                </div>
                <p className="ceo-entry-text">{entry.narrative}</p>
                {entry.summary && <p className="ceo-entry-summary">{entry.summary}</p>}
                {entry.milestones && entry.milestones.length > 0 && (
                  <ul className="ceo-changes ceo-milestones">
                    {entry.milestones.map((label) => (
                      <li key={label}>Milestone: {label}</li>
                    ))}
                  </ul>
                )}
                {entry.changes.length > 0 && (
                  <ul className="ceo-changes">
                    {entry.changes.map((change, i) => (
                      <li key={i}>{change}</li>
                    ))}
                  </ul>
                )}
              </div>
              </Fragment>
            ))}

            {pending && (
              <>
                <Decision text={pending} />
                <div className="message-row assistant ceo-waiting">
                  <span className="waiting" role="status">
                    <span className="waiting-leaves" aria-hidden="true">
                      <i />
                      <i />
                      <i />
                    </span>
                    <span className="thinking-phrase">The week is playing out</span>
                  </span>
                </div>
              </>
            )}
            {state.offer && !over && !pending && (
              <div className={`ceo-entry ceo-offer${state.offer.kind === "crisis" ? " is-crisis" : ""}`}>
                <div className="ceo-entry-head">
                  <span className="ceo-entry-week">
                    {state.offer.title ?? (state.offer.type === "buyout" ? "Buyout offer" : "Investment offer")}
                  </span>
                  {state.offer.kind && (
                    <span className="ceo-entry-week">{state.offer.kind === "crisis" ? "Crisis" : "Opportunity"}</span>
                  )}
                </div>
                <p className="ceo-entry-text">{state.offer.text}</p>
                <div className="ceo-choices">
                  {(state.offer.choices ?? YES_NO).map((choice, i) => (
                    <div key={choice.id} className="ceo-choice">
                      <button
                        type="button"
                        className={i === 0 ? "start-button" : "pref-confirm-no"}
                        onClick={() => answerOffer(choice.id)}
                      >
                        {choice.label}
                      </button>
                      {choice.hint && <span className="ceo-hint">{choice.hint}</span>}
                    </div>
                  ))}
                </div>
                <p className="ceo-hint">
                  Answering does not use your week.{" "}
                  {state.offer.default
                    ? `If you play on without answering: ${
                        state.offer.choices?.find((c) => c.id === state.offer?.default)?.label.toLowerCase() ?? "it gets worse"
                      }.`
                    : "It lapses if you play on."}
                </p>
              </div>
            )}
            {error && <p className="ceo-error">{error}</p>}
            <div ref={feedEnd} />
          </div>

          {over ? (
            <div className="ceo-composer ceo-result">
              <p className="ceo-over">
                {state.status === "sold"
                  ? `You sold ${state.company.name} for ${money(state.result?.company_value ?? 0)}.`
                  : state.status === "finished"
                    ? `One year in, ${state.company.name} is worth ${money(state.result?.company_value ?? 0)}.`
                    : `${state.company.name} ran out of money after ${state.turn} ${state.turn === 1 ? "week" : "weeks"}.`}
              </p>
              {state.result && (
                <p className="ceo-result-score">
                  <span className="ceo-result-rating">{state.result.rating}</span>
                  Your share: {money(state.result.score)}
                  {state.result.goal_met
                    ? `. You beat the ${money(state.goal)} goal.`
                    : ` of a ${money(state.goal)} goal.`}
                </p>
              )}
              <div className="ceo-offer-actions">
                {state.status !== "sold" && (
                  <button type="button" className="start-button" onClick={keepGoing}>
                    {state.status === "bankrupt"
                      ? `Take a ${money(RESCUE_GRANT)} grant and keep going`
                      : "Keep playing"}
                  </button>
                )}
                <button
                  type="button"
                  className={state.status === "sold" ? "start-button" : "pref-confirm-no"}
                  onClick={onLeave}
                >
                  Start another company
                </button>
              </div>
              {state.status !== "sold" && (
                <p className="ceo-hint">
                  {state.free_play
                    ? "This is free play. Your recorded score does not change."
                    : "Your score is locked in. Anything after this is free play and does not change it."}
                </p>
              )}
            </div>
          ) : (
            <div className="ceo-composer">
              {staff.length === 0 && <p className="ceo-hint">Hire at least one person to begin.</p>}
              {syncing && staff.length > 0 && <p className="ceo-hint">Saving your team</p>}
              <div className="suggestion-chips ceo-options">
                {state.options.map((option) => (
                  <button
                    key={option}
                    type="button"
                    className="suggestion-chip"
                    onClick={() => decide(option)}
                    disabled={!!pending || staff.length === 0 || syncing}
                  >
                    {option}
                  </button>
                ))}
              </div>
              {/* The chat's message box */}
              <form
                className="input-wrapper"
                onSubmit={(e) => {
                  e.preventDefault();
                  decide(draft);
                }}
              >
                <input
                  className="chat-textarea"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  maxLength={400}
                  placeholder="Or type your own decision"
                  disabled={!!pending}
                  aria-label="Your decision"
                />
                <div className="input-toolbar">
                  <div className="toolbar-left">
                    {state.can_undo && !pending && (
                      <button type="button" className="toolbar-chip-btn" onClick={undo}>
                        Undo last week
                      </button>
                    )}
                  </div>
                  <div className="toolbar-right">
                    <button
                      type="submit"
                      className="ask-button"
                      disabled={!draft.trim() || !!pending || staff.length === 0 || syncing}
                      title="Decide (Enter)"
                    >
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" stroke="none">
                        <path d="M22 2L11 13M22 2L15 22l-4-9-9-4 20-7z" />
                      </svg>
                    </button>
                  </div>
                </div>
              </form>
            </div>
          )}
        </div>

        {details && <div className="chat-preferences-modal-overlay ceo-side-backdrop" onClick={() => setDetails(false)} />}
        <aside className={`ceo-side${details ? " is-open" : ""}`}>
          <div className="ceo-side-head">
            <span className="ceo-side-title">{state.company.name}</span>
            <button type="button" className="ceo-link" onClick={() => setDetails(false)}>
              Close
            </button>
          </div>
          {/* Always in view: the numbers checked every week */}
          <div className="ceo-side-top">
              <div className="ceo-value">
                <span className="ceo-stat-label">Company value</span>
                <span className="ceo-value-amount">{money(state.valuation)}</span>
                {state.equity < 1 && (
                  <span className="ceo-stat-note">
                    You own {Math.round(state.equity * 100)}%, worth {money(stake)}
                  </span>
                )}
                <div className="ceo-meter-track" title={`Goal: ${money(state.goal)}`}>
                  <div
                    className="ceo-meter-fill"
                    style={{ width: `${Math.max(0, Math.min(100, (stake / state.goal) * 100))}%` }}
                  />
                </div>
                <span className="ceo-stat-note">
                  {state.free_play && state.official_result
                    ? `Year one scored ${money(state.official_result.score)}. Playing on.`
                    : stake >= state.goal
                      ? "Goal reached"
                      : `${money(state.goal - stake)} to the ${money(state.goal)} goal`}
                </span>
              </div>

              <div className="ceo-stats">
                <Stat
                  label="Cash"
                  value={money(state.cash)}
                  tone={state.cash < 20000 ? "down" : undefined}
                  note={state.cash < 0 && !over ? "Overdrawn: fix it this week" : undefined}
                />
                <Stat
                  label="Revenue"
                  value={money(state.last.revenue)}
                  note={
                    revenueDelta === null
                      ? "last week"
                      : `${signedMoney(revenueDelta)} vs prior`
                  }
                  tone={revenueDelta === null ? undefined : revenueDelta < 0 ? "down" : "up"}
                />
                <Stat
                  label="Profit"
                  value={money(state.last.profit)}
                  note="last week"
                  tone={state.turn === 0 ? undefined : state.last.profit < 0 ? "down" : "up"}
                />
                <Stat label="Employees" value={String(state.employees)} />
              </div>

              <button type="button" className="ceo-details-toggle" onClick={() => setDetails(true)}>
                Team, products, money and buzz
                {Object.values(needsYou).some(Boolean) && (
                  <span className="ceo-tab-dot" role="img" aria-label="needs attention" />
                )}
              </button>

              <Meter label="Reputation" value={state.reputation} />
              <Meter label="Team morale" value={state.morale} />
              {state.workload !== undefined && state.turn > 0 && (
                <Meter
                  label="Team workload"
                  value={state.workload}
                  shown={`${state.workload}%`}
                  warn={state.workload >= 100}
                  note={
                    state.workload >= 100
                      ? "Orders are being turned away. Hire to sell more."
                      : state.workload >= 85
                        ? "Nearly full. More demand will need more people."
                        : undefined
                  }
                />
              )}
          </div>

          <div className="ceo-tabs" role="tablist" aria-label="Company details">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={t.id === tab}
                className={`ceo-tab${t.id === tab ? " is-on" : ""}`}
                onClick={() => pickTab(t.id)}
              >
                {t.label}
                {needsYou[t.id] && <span className="ceo-tab-dot" role="img" aria-label="needs attention" />}
              </button>
            ))}
          </div>

          <div className="ceo-tab-body" role="tabpanel">
            {tab === "team" && (
              <>
                  {staff.length === 0 ? (
                    <p className="ceo-hint">Nobody yet.</p>
                  ) : (
                    <>
                      <p className="ceo-hint">
                        {staff.length} {staff.length === 1 ? "person" : "people"}, {money(payroll)} a week.
                      </p>
                      <People
                        people={staff}
                        action={state.turn === 0 ? "Undo" : "Let go"}
                        confirm={state.turn > 0}
                        disabled={over || !!pending}
                        onPick={release}
                      />
                    </>
                  )}

                  {state.turn > 0 && !over && (
                    <>
                      <h3 className="ceo-label">Hiring</h3>
                      {(state.candidates ?? []).length === 0 ? (
                        <p className="ceo-hint">Nobody is looking right now.</p>
                      ) : (
                        <People
                          people={state.candidates ?? []}
                          action="Hire"
                          cash={state.cash}
                          disabled={!!pending}
                          onPick={hire}
                        />
                      )}
                      <p className="ceo-hint">
                        New candidates in {Math.max(1, POOL_REFRESH - (state.turn - (state.candidates_turn ?? 0)))}{" "}
                        {POOL_REFRESH - (state.turn - (state.candidates_turn ?? 0)) === 1 ? "week" : "weeks"}. Hiring is instant.
                      </p>
                    </>
                  )}
              </>
            )}

            {tab === "products" && (
              <>
                  {active.length === 0 ? (
                    <p className="ceo-hint">Nothing on sale.</p>
                  ) : (
                    <ul className="ceo-products">
                      {active.map((p) => (
                        <li key={p.id} className="ceo-product">
                          <EditableValue
                            className="ceo-product-name"
                            label={`Rename ${p.name}`}
                            shown={p.name}
                            initial={p.name}
                            maxLength={40}
                            disabled={over || !!pending}
                            onCommit={(name) => editProduct(p, { name })}
                          />
                          <EditableValue
                            className="ceo-product-price"
                            label={`Change the price of ${p.name}`}
                            shown={money(p.price)}
                            initial={String(p.price)}
                            numeric
                            disabled={over || !!pending}
                            onCommit={(price) => editProduct(p, { price: Number(price) })}
                          />
                          <span className="ceo-product-meta">
                            {state.turn === 0
                              ? "No sales yet"
                              : `${p.units_sold.toLocaleString()} sold · ${money(p.revenue)}`}
                          </span>
                          {!over && active.length > 1 && (
                            <button
                              type="button"
                              className={`ceo-link ceo-link--quiet ceo-product-drop${dropId === p.id ? " is-armed" : ""}`}
                              disabled={!!pending}
                              onBlur={() => setDropId(null)}
                              onClick={() => {
                                if (dropId !== p.id) return setDropId(p.id);
                                setDropId(null);
                                decide(`Discontinue ${p.name}`, { type: "discontinue", product_id: p.id });
                              }}
                            >
                              {dropId === p.id ? "Confirm: uses this week" : "Discontinue"}
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                  {!over && active.length < MAX_PRODUCTS && (
                    <AddProduct
                      cost={state.launch_cost ?? LAUNCH_COST}
                      disabled={!!pending}
                      onLaunch={(name, price) =>
                        decide(`Launch a new product: ${name} at ${money(price)}`, { type: "launch", name, price })
                      }
                    />
                  )}
                  {active.length > 0 && !over && (
                    <p className="ceo-hint">
                      Click a name or price to change it. A new price shifts demand right away.
                    </p>
                  )}
              </>
            )}

            {tab === "money" && (
              <>
                  <TrendChart history={state.history} />

                  <Bank
                    loans={state.loans ?? []}
                    credit={state.credit ?? 0}
                    cash={state.cash}
                    disabled={over || !!pending}
                    onBorrow={borrow}
                    onRepay={repay}
                    onInfuse={infuse}
                  />
              </>
            )}

            {tab === "buzz" && (
              <>
                  {state.reactions.length === 0 ? (
                    <p className="ceo-hint">Nobody is talking about you yet.</p>
                  ) : (
                    <ul className="ceo-reactions">
                      {state.reactions.map((r, i) => (
                        <li key={i} className={`ceo-reaction is-${r.sentiment}`}>
                          <span className="ceo-reaction-source">{r.source}</span>
                          <span>{r.text}</span>
                        </li>
                      ))}
                    </ul>
                  )}
              </>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

/** What the player decided that week, as their side of the chat */
function Decision({ text }: { text: string }) {
  return (
    <div className="message-row user">
      <div className="msg-bubble-group user-group">
        <div className="message user">{text}</div>
      </div>
    </div>
  );
}

/** A labelled list of choices, each laid out like a row of the Presets list. */
function Picker<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { id: T; label: string; blurb: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <>
      <h3 className="pref-field-label ceo-section">{label}</h3>
      <div className="pref-account-card ceo-list" role="radiogroup" aria-label={label}>
        {options.map((option) => {
          const on = option.id === value;
          return (
            <div
              key={option.id}
              className={`pref-list-item${on ? " active" : ""}`}
              role="radio"
              aria-checked={on}
              tabIndex={0}
              onClick={() => onChange(option.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onChange(option.id);
                }
              }}
            >
              <div className="pref-item-info">
                <div className="pref-item-name">{option.label}</div>
                <div className="pref-item-desc">{option.blurb}</div>
              </div>
              <div className={`pref-item-check${on ? " checked" : ""}`}>
                {on && <span className="pref-check-mark">✓</span>}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

/** A list of people, each with one action: hire a candidate, or let a team member go. */
function People({
  people,
  action,
  cash,
  confirm,
  disabled,
  onPick,
}: {
  people: CeoPerson[];
  action: string;
  /** Given for candidates: anyone whose fee is more than this cannot be hired */
  cash?: number;
  /** Ask for a second click before acting */
  confirm?: boolean;
  disabled?: boolean;
  onPick: (person: CeoPerson) => void;
}) {
  const [armed, setArmed] = useState<string | null>(null);
  return (
    <ul className="ceo-people">
      {people.map((person) => {
        const tooDear = cash !== undefined && person.fee > cash;
        return (
          <li key={person.id} className="ceo-person">
            <span className="ceo-person-name">{person.name}</span>
            <span className={`ceo-person-level is-${person.level}`}>
              {LEVELS[person.level] ?? person.level} {ROLE_TITLE[person.role] ?? person.role}
            </span>
            <span className="ceo-person-cost">
              {money(person.salary)} a week{cash !== undefined && `, ${money(person.fee)} to hire`}
            </span>
            <button
              type="button"
              className={`ceo-link${armed === person.id ? " is-armed" : ""}`}
              disabled={disabled || tooDear}
              title={tooDear ? "Not enough cash" : undefined}
              onBlur={() => setArmed(null)}
              onClick={() => {
                if (confirm && armed !== person.id) return setArmed(person.id);
                setArmed(null);
                onPick(person);
              }}
            >
              {armed === person.id ? "Confirm" : action}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** What is owed to the bank, and a form to borrow more. Borrowing is instant and uses no turn. */
function Bank({
  loans,
  credit,
  cash,
  disabled,
  onBorrow,
  onRepay,
  onInfuse,
}: {
  loans: { principal: number; weekly: number; weeks_left: number }[];
  credit: number;
  cash: number;
  disabled: boolean;
  onBorrow: (amount: number) => void;
  onRepay: (index: number) => void;
  /** Founder money: as much as you like, as often as you like, no turn used */
  onInfuse: (amount: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [infusing, setInfusing] = useState(false);
  const [infusion, setInfusion] = useState("");
  const putIn = Number(infusion);
  const canPutIn = putIn > 0 && putIn <= MAX_INFUSION;
  const owed = loans.reduce((sum, loan) => sum + loan.weekly * loan.weeks_left, 0);
  const weekly = loans.reduce((sum, loan) => sum + loan.weekly, 0);
  const wanted = Number(amount);
  const valid = wanted >= MIN_LOAN && wanted <= credit;
  const repay = Math.ceil((wanted * (1 + LOAN_INTEREST)) / LOAN_WEEKS);

  return (
    <>
      <h3 className="ceo-label">Bank</h3>
      {owed > 0 && (
        <p className="ceo-hint">
          You owe {money(owed)}, repaid at {money(weekly)} a week.
        </p>
      )}
      {loans.length > 0 && (
        <ul className="ceo-loans">
          {loans.map((loan, i) => {
            const cost = payoff(loan);
            const saved = loan.weekly * loan.weeks_left - cost;
            return (
              <li key={i} className="ceo-loan">
                <span>
                  {money(loan.principal)} loan, {loan.weeks_left} {loan.weeks_left === 1 ? "week" : "weeks"} left
                </span>
                <button
                  type="button"
                  className="ceo-link"
                  disabled={disabled || cost > cash}
                  onClick={() => onRepay(i)}
                  title={cost > cash ? "Not enough cash" : `Saves ${money(saved)} in interest`}
                >
                  Pay off for {money(cost)}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {!infusing && (
        <button type="button" className="ceo-link" disabled={disabled} onClick={() => setInfusing(true)}>
          Put in cash
        </button>
      )}
      {infusing && (
        <form
          className="ceo-add"
          onSubmit={(e) => {
            e.preventDefault();
            if (!canPutIn || disabled) return;
            onInfuse(putIn);
            setInfusion("");
            setInfusing(false);
          }}
        >
          <div className="ceo-price ceo-price--wide">
            <span>$</span>
            <input
              className="ceo-input"
              value={infusion}
              autoFocus
              onChange={(e) => setInfusion(e.target.value.replace(/\D/g, "").slice(0, 13))}
              onKeyDown={(e) => e.key === "Escape" && setInfusing(false)}
              inputMode="numeric"
              aria-label="Amount to put in"
            />
          </div>
          <p className="ceo-hint">
            Your own money, straight into the company. No limit, no repayment, no shares given up, and it does not use
            a week. Leaderboard scores show how much cash was put in.
          </p>
          <div className="ceo-add-actions">
            <button type="submit" className="start-button" disabled={!canPutIn || disabled}>
              Put in {putIn > 0 ? money(putIn) : "cash"}
            </button>
            <button type="button" className="ceo-link ceo-link--quiet" onClick={() => setInfusing(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
      {!open && credit >= MIN_LOAN && (
        <button
          type="button"
          className="ceo-link"
          disabled={disabled}
          onClick={() => {
            setAmount(String(Math.min(credit, 25000)));
            setOpen(true);
          }}
        >
          Borrow money
        </button>
      )}
      {open && (
        <form
          className="ceo-add"
          onSubmit={(e) => {
            e.preventDefault();
            if (!valid || disabled) return;
            onBorrow(wanted);
            setOpen(false);
          }}
        >
          <div className="ceo-price ceo-price--wide">
            <span>$</span>
            <input
              className="ceo-input"
              value={amount}
              autoFocus
              onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))}
              onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
              inputMode="numeric"
              aria-label="Amount to borrow"
            />
          </div>
          <p className="ceo-hint">
            {valid
              ? `Repaid at ${money(repay)} a week for ${LOAN_WEEKS} weeks, ${money(repay * LOAN_WEEKS)} in all.`
              : `The bank will lend between ${money(MIN_LOAN)} and ${money(credit)}.`}
          </p>
          <div className="ceo-add-actions">
            <button type="submit" className="start-button" disabled={!valid || disabled}>
              Borrow
            </button>
            <button type="button" className="ceo-link ceo-link--quiet" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </>
  );
}

/** "Add product" link that opens a name and price form. Launching is the week's decision. */
function AddProduct({
  cost,
  disabled,
  onLaunch,
}: {
  cost: number;
  disabled: boolean;
  onLaunch: (name: string, price: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");

  if (!open) {
    return (
      <button type="button" className="ceo-link" onClick={() => setOpen(true)} disabled={disabled}>
        Add product
      </button>
    );
  }

  const ready = name.trim().length > 0 && Number(price) > 0;
  const close = () => {
    setOpen(false);
    setName("");
    setPrice("");
  };

  return (
    <form
      className="ceo-add"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ready || disabled) return;
        onLaunch(name.trim(), Number(price));
        close();
      }}
    >
      <div className="ceo-product-row">
        <input
          className="ceo-input"
          value={name}
          autoFocus
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && close()}
          maxLength={40}
          placeholder="Product name"
          aria-label="New product name"
        />
        <div className="ceo-price">
          <span>$</span>
          <input
            className="ceo-input"
            value={price}
            onChange={(e) => setPrice(e.target.value.replace(/[^\d.]/g, ""))}
            onKeyDown={(e) => e.key === "Escape" && close()}
            inputMode="decimal"
            placeholder="Price"
            aria-label="New product price"
          />
        </div>
      </div>
      <p className="ceo-hint">
        Costs {money(cost)} to launch and is your decision for this week.
      </p>
      <div className="ceo-add-actions">
        <button type="submit" className="start-button" disabled={!ready || disabled}>
          Launch
        </button>
        <button type="button" className="ceo-link ceo-link--quiet" onClick={close}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** Text that turns into an input when clicked. Enter or clicking away saves, Escape cancels. */
function EditableValue({
  className,
  label,
  shown,
  initial,
  numeric,
  maxLength,
  disabled,
  onCommit,
}: {
  className: string;
  label: string;
  shown: string;
  initial: string;
  numeric?: boolean;
  maxLength?: number;
  disabled?: boolean;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  if (draft === null) {
    return (
      <button
        type="button"
        className={`ceo-edit ${className}`}
        onClick={() => setDraft(initial)}
        disabled={disabled}
        title={label}
        aria-label={label}
      >
        {shown}
      </button>
    );
  }

  const finish = (save: boolean) => {
    const value = draft.trim();
    setDraft(null);
    if (save && value && value !== initial) onCommit(value);
  };

  return (
    <input
      className={`ceo-input ceo-edit-input ${className}`}
      value={draft}
      autoFocus
      onFocus={(e) => e.target.select()}
      onChange={(e) => setDraft(numeric ? e.target.value.replace(/[^\d.]/g, "") : e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        if (e.key === "Enter") finish(true);
        if (e.key === "Escape") finish(false);
      }}
      inputMode={numeric ? "decimal" : undefined}
      maxLength={maxLength}
      aria-label={label}
    />
  );
}

function Stat({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: "up" | "down" }) {
  return (
    <div className="ceo-stat">
      <span className="ceo-stat-label">{label}</span>
      <span className={`ceo-stat-value${tone === "down" ? " is-down" : ""}`}>{value}</span>
      {note && <span className={`ceo-stat-note${tone ? ` is-${tone}` : ""}`}>{note}</span>}
    </div>
  );
}

function Meter({
  label,
  value,
  shown,
  note,
  warn,
}: {
  label: string;
  value: number;
  /** Text for the figure, when it is not just the number */
  shown?: string;
  note?: string;
  warn?: boolean;
}) {
  return (
    <div className="ceo-meter">
      <div className="ceo-meter-head">
        <span>{label}</span>
        <span>{shown ?? value}</span>
      </div>
      <div className="ceo-meter-track">
        <div
          className={`ceo-meter-fill${warn ? " is-warn" : ""}`}
          style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
        />
      </div>
      {note && <span className={`ceo-stat-note${warn ? " is-down" : ""}`}>{note}</span>}
    </div>
  );
}
