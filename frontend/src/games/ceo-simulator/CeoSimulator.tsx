import { useCallback, useEffect, useRef, useState } from "react";
import {
  apiCreateGame,
  apiDeleteGame,
  apiEditGame,
  apiGetGame,
  apiListGames,
  apiPlayTurn,
  type GameSave,
  type GameSaveSummary,
} from "../api";
import type { GameProps } from "../types";
import type { CeoProduct, CeoState } from "./types";
import "./ceo.css";

const GAME_TYPE = "ceo-simulator";
const MAX_START_PRODUCTS = 4;
const MAX_PRODUCTS = 8;
const LAUNCH_COST = 3000;
const RESCUE_GRANT = 50000;

const OUTCOME_LABEL: Record<string, string> = {
  bankrupt: "Bankrupt",
  sold: "Sold",
  finished: "Year complete",
};

// A decision made with a form in the dashboard instead of typed out
type TurnAction =
  | { type: "launch"; name: string; price: number }
  | { type: "discontinue"; product_id: string };

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
  const [save, setSave] = useState<CeoSave | null>(null);

  if (save) {
    return <Play save={save} model={model} onSave={setSave} onLeave={() => setSave(null)} />;
  }
  return <Menu onOpen={setSave} onExit={onExit} />;
}

// ---- Menu: saved companies and the new company form ----

function Menu({ onOpen, onExit }: { onOpen: (save: CeoSave) => void; onExit: () => void }) {
  const [saves, setSaves] = useState<GameSaveSummary[] | null>(null);
  const [company, setCompany] = useState("");
  const [pitch, setPitch] = useState("");
  const [products, setProducts] = useState<ProductDraft[]>([{ name: "", price: "" }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    apiListGames(GAME_TYPE)
      .then(setSaves)
      .catch(() => setSaves([]));
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
        <button type="button" className="ceo-link" onClick={onExit}>
          Back to games
        </button>
        <h2 className="ceo-title">CEO Simulator</h2>
        <p className="ceo-sub">
          Each turn is one week, and you have one year. Your score is what your share of the company is worth at
          the end. Reach $1,000,000 to win.
        </p>

        {saves && saves.length > 0 && (
          <section className="ceo-card">
            <h3 className="ceo-label">Your companies</h3>
            <ul className="ceo-saves">
              {saves.map((s) => (
                <li key={s.id} className="ceo-save">
                  <button type="button" className="ceo-save-open" onClick={() => open(s.id)} disabled={busy}>
                    <span className="ceo-save-name">{s.title}</span>
                    <span className="ceo-save-meta">
                      {s.summary.status === "active" || !s.summary.result
                        ? `Week ${s.summary.turn + 1} · ${money(s.summary.cash)} cash` +
                          (s.summary.official_result
                            ? ` · free play, scored ${money(s.summary.official_result.score)}`
                            : "")
                        : `${OUTCOME_LABEL[s.summary.status] ?? "Ended"} · ${s.summary.result.rating} · ${money(s.summary.result.score)}`}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="ceo-link ceo-link--quiet"
                    onClick={() => remove(s.id)}
                    aria-label={`Delete ${s.title}`}
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <form className="ceo-card" onSubmit={start}>
          <h3 className="ceo-label">Start a new company</h3>

          <label className="ceo-field">
            <span>Company name</span>
            <input
              className="ceo-input"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              maxLength={60}
              placeholder="Brew Co"
            />
          </label>

          <label className="ceo-field">
            <span>What does it do? (optional)</span>
            <input
              className="ceo-input"
              value={pitch}
              onChange={(e) => setPitch(e.target.value)}
              maxLength={200}
              placeholder="Specialty coffee delivered every month"
            />
          </label>

          <div className="ceo-field">
            <span>Products you sell</span>
            {products.map((p, i) => (
              <div key={i} className="ceo-product-row">
                <input
                  className="ceo-input"
                  value={p.name}
                  onChange={(e) => setProduct(i, { name: e.target.value })}
                  maxLength={40}
                  placeholder="Product name"
                  aria-label={`Product ${i + 1} name`}
                />
                <div className="ceo-price">
                  <span>$</span>
                  <input
                    className="ceo-input"
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

          {error && <p className="ceo-error">{error}</p>}

          <button type="submit" className="ceo-btn" disabled={!ready || busy}>
            {busy ? "Starting" : "Start company"}
          </button>
          <p className="ceo-hint">You begin with $100,000 in cash and a team of 5.</p>
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
  onSave: (save: CeoSave) => void;
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
  const answerOffer = async (accept: boolean) => {
    setError("");
    try {
      onSave(await apiEditGame<CeoState>(save.id, "offer", { accept }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  };

  const keepGoing = async () => {
    setError("");
    try {
      onSave(await apiEditGame<CeoState>(save.id, "continue", {}));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  };

  const stake = Math.round(state.valuation * state.equity);
  const over = state.status !== "active";
  const previous = state.history[state.history.length - 2];
  const revenueDelta = previous ? state.last.revenue - previous.revenue : null;
  const active = state.products.filter((p) => p.active);

  return (
    <div className="ceo ceo--play">
      <div className="ceo-bar">
        <button type="button" className="ceo-link" onClick={onLeave}>
          All companies
        </button>
        <span className="ceo-bar-name">{state.company.name}</span>
        <span className="ceo-bar-week">
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
            <div className="ceo-entry">
              <p className="ceo-entry-text">
                {state.company.name} opens for business with {money(state.start_cash)} in the bank and a team of 5.
                {state.turn === 0 && " What is your first move?"}
              </p>
            </div>

            {state.log.map((entry) => (
              <div key={entry.turn} className="ceo-entry">
                <div className="ceo-entry-head">
                  <span className="ceo-entry-week">Week {entry.turn}</span>
                  <span className={`ceo-entry-profit${entry.financials.profit < 0 ? " is-down" : " is-up"}`}>
                    {signedMoney(entry.financials.profit)}
                  </span>
                </div>
                <p className="ceo-entry-decision">{entry.decision}</p>
                <p className="ceo-entry-text">{entry.narrative}</p>
                {entry.changes.length > 0 && (
                  <ul className="ceo-changes">
                    {entry.changes.map((change, i) => (
                      <li key={i}>{change}</li>
                    ))}
                  </ul>
                )}
              </div>
            ))}

            {pending && (
              <div className="ceo-entry ceo-entry--pending">
                <p className="ceo-entry-decision">{pending}</p>
                <p className="ceo-entry-text">The week is playing out</p>
              </div>
            )}
            {state.offer && !over && !pending && (
              <div className="ceo-entry ceo-offer">
                <div className="ceo-entry-head">
                  <span className="ceo-entry-week">
                    {state.offer.type === "buyout" ? "Buyout offer" : "Investment offer"}
                  </span>
                </div>
                <p className="ceo-entry-text">{state.offer.text}</p>
                <div className="ceo-offer-actions">
                  <button type="button" className="ceo-btn" onClick={() => answerOffer(true)}>
                    Accept
                  </button>
                  <button type="button" className="ceo-option" onClick={() => answerOffer(false)}>
                    Reject
                  </button>
                  <span className="ceo-hint">Answering does not use your week. It lapses if you play on.</span>
                </div>
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
                  <button type="button" className="ceo-btn" onClick={keepGoing}>
                    {state.status === "bankrupt"
                      ? `Take a ${money(RESCUE_GRANT)} grant and keep going`
                      : "Keep playing"}
                  </button>
                )}
                <button
                  type="button"
                  className={state.status === "sold" ? "ceo-btn" : "ceo-option"}
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
            <form
              className="ceo-composer"
              onSubmit={(e) => {
                e.preventDefault();
                decide(draft);
              }}
            >
              <div className="ceo-options">
                {state.options.map((option) => (
                  <button
                    key={option}
                    type="button"
                    className="ceo-option"
                    onClick={() => decide(option)}
                    disabled={!!pending}
                  >
                    {option}
                  </button>
                ))}
              </div>
              <div className="ceo-decide">
                <input
                  className="ceo-input"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  maxLength={400}
                  placeholder="Or type your own decision"
                  disabled={!!pending}
                  aria-label="Your decision"
                />
                <button type="submit" className="ceo-btn" disabled={!draft.trim() || !!pending}>
                  Decide
                </button>
              </div>
            </form>
          )}
        </div>

        <aside className="ceo-side">
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
                ? `Free play. Final score: ${money(state.official_result.score)}`
                : stake >= state.goal
                  ? "Goal reached"
                  : `${money(state.goal - stake)} to the ${money(state.goal)} goal`}
            </span>
          </div>

          <div className="ceo-stats">
            <Stat label="Cash" value={money(state.cash)} tone={state.cash < 50000 ? "down" : undefined} />
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

          <Meter label="Reputation" value={state.reputation} />
          <Meter label="Team morale" value={state.morale} />

          <h3 className="ceo-label">Products</h3>
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

          <h3 className="ceo-label">What people are saying</h3>
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
        </aside>
      </div>
    </div>
  );
}

/** "Add product" link that opens a name and price form. Launching is the week's decision. */
function AddProduct({ disabled, onLaunch }: { disabled: boolean; onLaunch: (name: string, price: number) => void }) {
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
        Costs {money(LAUNCH_COST)} to launch and is your decision for this week.
      </p>
      <div className="ceo-add-actions">
        <button type="submit" className="ceo-btn" disabled={!ready || disabled}>
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

function Meter({ label, value }: { label: string; value: number }) {
  return (
    <div className="ceo-meter">
      <div className="ceo-meter-head">
        <span>{label}</span>
        <span>{value}</span>
      </div>
      <div className="ceo-meter-track">
        <div className="ceo-meter-fill" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </div>
    </div>
  );
}
