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
import { BackButton } from "../BackButton";
import type { GameProps } from "../types";
import { DIFFICULTIES, SCENARIOS, type Difficulty } from "./setup";
import type { HaggleState, HaggleSummary } from "./types";
import "./negotiation.css";

const GAME_TYPE = "negotiation";

type HaggleSave = GameSave<HaggleState>;

function money(amount: number): string {
  return `$${Math.round(amount).toLocaleString("en-US")}`;
}

export function Negotiation({ model, onExit }: GameProps) {
  const [save, setSave] = useState<HaggleSave | null>(null);

  if (save) return <Play save={save} model={model} onSave={setSave} onLeave={() => setSave(null)} />;
  return <Menu onOpen={setSave} onExit={onExit} />;
}

// ---- Menu: pick what to buy ----

function Menu({ onOpen, onExit }: { onOpen: (save: HaggleSave) => void; onExit: () => void }) {
  const [unfinished, setUnfinished] = useState<GameSaveSummary<HaggleSummary> | null>(null);
  const [scores, setScores] = useState<GameScoreRow[]>([]);
  // null is "Surprise me": the server deals a scenario
  const [scenario, setScenario] = useState<string | null>(null);
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
  }, []);

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
          <h2 className="neg-title">Negotiation</h2>
        </div>
        <p className="neg-sub">
          Pick something to buy and talk the merchant down. Every message costs a little of their patience, and you
          only learn how low they would have gone once it is over.
        </p>

        {unfinished && (
          <>
            <h3 className="pref-field-label neg-section">Still on the table</h3>
            <div className="pref-account-card neg-card">
              <div className="pref-list-item neg-row--static">
                <div className="pref-item-icon">{unfinished.summary.merchant.charAt(0)}</div>
                <div className="pref-item-info">
                  <div className="pref-item-name">{unfinished.summary.item}</div>
                  <div className="pref-item-desc">
                    {unfinished.summary.merchant} is asking {money(unfinished.summary.ask)}
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

        <h3 className="pref-field-label neg-section">What are you buying?</h3>
        <div className="pref-account-card neg-card">
          <Option
            icon="?"
            name="Surprise me"
            desc="A merchant picked at random"
            on={scenario === null}
            onPick={() => setScenario(null)}
          />
          {SCENARIOS.map((s) => (
            <Option
              key={s.id}
              icon={s.merchant.charAt(0)}
              name={s.item}
              desc={`${s.merchant} · ${s.setting}`}
              badge={money(s.listPrice)}
              on={scenario === s.id}
              onPick={() => setScenario(s.id)}
            />
          ))}
        </div>

        <h3 className="pref-field-label neg-section">How tough is the merchant?</h3>
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
          <button
            type="button"
            className="start-button"
            onClick={() => run(() => apiCreateGame<HaggleState>(GAME_TYPE, { scenario, difficulty }))}
            disabled={busy}
          >
            {busy ? "Walking in" : "Start haggling"}
          </button>
          {unfinished && (
            <span className="pref-setting-hint">Starting a new haggle drops the one still on the table.</span>
          )}
        </div>

        {scores.length > 0 && (
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
  onLeave: () => void;
}) {
  const state = save.state;
  const { scenario, result } = state;
  const [draft, setDraft] = useState("");
  const [offerDraft, setOfferDraft] = useState("");
  const [pending, setPending] = useState<{ text: string; offer?: number } | null>(null);
  const [closing, setClosing] = useState(false);
  const [error, setError] = useState("");
  const feedEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    feedEnd.current?.scrollIntoView({ block: "end" });
  }, [state.log.length, pending, error, state.status]);

  const offerValue = Math.round(Number(offerDraft));
  const offer = offerValue > 0 ? offerValue : undefined;
  const busy = !!pending || closing;

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if ((!text && offer === undefined) || busy) return;
    setPending({ text: text || `How about ${money(offer ?? 0)}?`, offer });
    setError("");
    setDraft("");
    setOfferDraft("");
    try {
      onSave(await apiPlayTurn<HaggleState>(save.id, text, model, undefined, { offer }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setDraft(text);
      setOfferDraft(offer === undefined ? "" : String(offer));
    } finally {
      setPending(null);
    }
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
    }
  };

  return (
    <div className="neg neg--play">
      <div className="neg-head">
        <BackButton label="Back to the merchants" onClick={onLeave} />
        <h2 className="neg-title">{scenario.item}</h2>
        <span className="pref-content-badge">
          {result
            ? result.outcome === "deal"
              ? "Deal"
              : "Walked away"
            : state.final
              ? "Final price"
              : `Round ${state.turn + 1}`}
        </span>
      </div>

      <div className="neg-table">
        <div className="neg-merchant">
          <div className="pref-item-icon">{scenario.merchant.charAt(0)}</div>
          <div className="pref-item-info">
            <div className="pref-item-name">{scenario.merchant}</div>
            <div className="pref-item-desc">{scenario.setting}</div>
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
          <span className="pref-item-desc">
            {result?.paid != null ? "You paid" : "Asking"}
            {state.ask < state.list_price && (
              <>
                , down from <s>{money(state.list_price)}</s>
              </>
            )}
          </span>
        </div>
      </div>

      {/* The chat's own bubbles: the merchant on the left, you on the right */}
      <div className="neg-feed">
        <p className="msg-timestamp neg-persona">
          {scenario.merchant}: {scenario.persona}.
        </p>
        <Line who="them" text={state.opening} />

        {state.log.map((entry) => (
          <Fragment key={entry.turn}>
            <Line who="you" text={entry.you} note={entry.offer != null ? `Offered ${money(entry.offer)}` : undefined} />
            <Line
              who="them"
              text={entry.reply}
              note={
                entry.insulted
                  ? "That number offended them. It cost extra patience."
                  : entry.persuasion > 0
                    ? "That landed."
                    : entry.persuasion < 0
                      ? "That did not help."
                      : undefined
              }
            />
          </Fragment>
        ))}

        {pending && (
          <>
            <Line
              who="you"
              text={pending.text}
              note={pending.offer !== undefined ? `Offered ${money(pending.offer)}` : undefined}
            />
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

        {result && (
          <div className="neg-verdict">
            <span className="neg-title">{result.rating}</span>
            <span className="pref-setting-hint">
              {result.paid != null
                ? `You paid ${money(result.paid)} for something listed at ${money(state.list_price)}, saving ${money(result.saved ?? 0)} in ${result.rounds} ${result.rounds === 1 ? "round" : "rounds"}.`
                : "You left without buying. No deal, no score."}
            </span>
            <span className="pref-setting-hint">
              The lowest {scenario.merchant} would have gone was {money(result.floor)}.
              {result.paid != null && ` You won ${result.score}% of the discount that was there to be had.`}
            </span>
          </div>
        )}

        {error && <p className="neg-error">{error}</p>}
        <div ref={feedEnd} />
      </div>

      {result ? (
        <div className="neg-controls">
          <button type="button" className="start-button" onClick={onLeave}>
            Haggle again
          </button>
        </div>
      ) : state.final ? (
        <div className="neg-controls">
          <span className="pref-setting-label">That was their final price.</span>
          <button type="button" className="start-button" onClick={() => close("accept")} disabled={busy}>
            Take it at {money(state.ask)}
          </button>
          <button type="button" className="pref-confirm-no" onClick={() => close("walk")} disabled={busy}>
            Walk away
          </button>
        </div>
      ) : (
        <form className="input-wrapper neg-composer" onSubmit={send}>
          <input
            className="chat-textarea"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={400}
            placeholder={`Make your case to ${scenario.merchant}`}
            disabled={busy}
            aria-label="Your message"
          />
          <div className="input-toolbar">
            <div className="toolbar-left">
              <label className="neg-offer">
                <span>Offer $</span>
                <input
                  value={offerDraft}
                  onChange={(e) => setOfferDraft(e.target.value.replace(/[^\d]/g, "").slice(0, 8))}
                  inputMode="numeric"
                  placeholder="none"
                  disabled={busy}
                  aria-label="Your offer in dollars"
                />
              </label>
            </div>
            <div className="toolbar-right">
              <button type="button" className="toolbar-chip-btn" onClick={() => close("walk")} disabled={busy}>
                Walk away
              </button>
              <button type="button" className="toolbar-chip-btn" onClick={() => close("accept")} disabled={busy}>
                Take it at {money(state.ask)}
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
