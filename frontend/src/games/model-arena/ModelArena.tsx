import { useEffect, useRef, useState } from "react";
import { apiGetModels } from "../../components/api";
import { MODEL_PRESETS } from "../../components/models";
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
import { BackButton } from "../BackButton";
import type { GameProps } from "../types";
import { CHARACTERS, DEFAULT_CHARACTERS, NO_CHARACTER, TOPICS } from "./setup";
import type { ArenaState, ArenaSummary, SideIndex } from "./types";
import { useDebateVoice } from "./useDebateVoice";
import "./arena.css";

const GAME_TYPE = "model-arena";
const STANCE_LABEL = { for: "For", against: "Against" } as const;

type ArenaSave = GameSave<ArenaState>;
type SideDraft = { model: string; character: string };

/** What a debater is called on screen: its character, or its model when it plays itself */
function nameOf(side: { model: string; character: string }): string {
  return side.character || side.model;
}

export function ModelArena({ model, onExit }: GameProps) {
  const [save, setSave] = useState<ArenaSave | null>(null);

  if (save) return <Stage save={save} onSave={setSave} onLeave={() => setSave(null)} />;
  return <Menu model={model} onOpen={setSave} onExit={onExit} />;
}

// ---- Menu: set up a debate, or reopen an old one ----

function Menu({
  model,
  onOpen,
  onExit,
}: {
  model?: string;
  onOpen: (save: ArenaSave) => void;
  onExit: () => void;
}) {
  const [debates, setDebates] = useState<GameSaveSummary<ArenaSummary>[]>([]);
  const [models, setModels] = useState<string[]>(() => [
    ...new Set([...(model ? [model] : []), ...MODEL_PRESETS.map((p) => p.model)]),
  ]);
  const [topic, setTopic] = useState("");
  const [sides, setSides] = useState<[SideDraft, SideDraft]>(() => [
    { model: model || MODEL_PRESETS[0].model, character: DEFAULT_CHARACTERS[0] },
    { model: MODEL_PRESETS[1].model, character: DEFAULT_CHARACTERS[1] },
  ]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    apiListGames<ArenaSummary>(GAME_TYPE)
      .then(setDebates)
      .catch(() => setDebates([]));
    // Offer what the server actually has; the presets stand in until it answers.
    apiGetModels()
      .then(({ models: installed }) => {
        if (installed.length === 0) return;
        setModels(installed);
        setSides((current) => {
          const pick = (wanted: string, fallback: string) => (installed.includes(wanted) ? wanted : fallback);
          const first = pick(current[0].model, installed[0]);
          const second = pick(current[1].model, installed.find((m) => m !== first) ?? first);
          return [
            { ...current[0], model: first },
            { ...current[1], model: second },
          ];
        });
      })
      .catch(() => {});
  }, []);

  const setSide = (index: SideIndex, patch: Partial<SideDraft>) =>
    setSides((current) => current.map((s, i) => (i === index ? { ...s, ...patch } : s)) as [SideDraft, SideDraft]);

  const randomTopic = () => {
    const others = TOPICS.filter((t) => t !== topic);
    setTopic(others[Math.floor(Math.random() * others.length)]);
  };

  const run = async (load: () => Promise<ArenaSave>) => {
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

  const start = (e: React.FormEvent) => {
    e.preventDefault();
    if (topic.trim().length < 3) return;
    run(() =>
      apiCreateGame<ArenaState>(GAME_TYPE, {
        topic: topic.trim(),
        sides: sides.map((s) => {
          const character = CHARACTERS.find((c) => c.label === s.character) ?? NO_CHARACTER;
          return {
            model: s.model,
            character: character === NO_CHARACTER ? "" : character.label,
            prompt: character.prompt,
          };
        }),
      }),
    );
  };

  const remove = async (id: string) => {
    try {
      await apiDeleteGame(id);
      setDebates((list) => list.filter((d) => d.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  };

  return (
    <div className="arena arena--menu">
      <div className="arena-menu">
        <div className="game-menu-head">
          <BackButton label="Back to all games" onClick={onExit} />
          <h2 className="arena-title">Model Arena</h2>
        </div>
        <p className="arena-sub">
          Two models, one topic. They trade five arguments each, make their closing remarks, and then you, the
          moderator, decide who won.
        </p>

        <form className="pref-account-card arena-card" onSubmit={start}>
          <label className="arena-field">
            <span className="pref-field-label">Topic</span>
            <input
              className="pref-name-input"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              maxLength={200}
              placeholder="A statement to argue over, such as: Cats are better than dogs"
            />
          </label>
          <button type="button" className="arena-link" onClick={randomTopic}>
            Give me a random topic
          </button>

          <div className="arena-corners">
            {sides.map((side, i) => {
              const character = CHARACTERS.find((c) => c.label === side.character) ?? NO_CHARACTER;
              return (
                <div key={i} className="arena-corner">
                  <Debater
                    side={{ model: side.model, character: character === NO_CHARACTER ? "" : character.label }}
                    index={i as SideIndex}
                    note={i === 0 ? "Argues for the topic" : "Argues against the topic"}
                  />
                  <label className="arena-field">
                    <span className="pref-field-label">Model</span>
                    <span className="arena-select">
                      <select
                        className="pref-name-input"
                        value={side.model}
                        onChange={(e) => setSide(i as SideIndex, { model: e.target.value })}
                      >
                        {models.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                    </span>
                  </label>
                  <label className="arena-field">
                    <span className="pref-field-label">Character</span>
                    <span className="arena-select">
                      <select
                        className="pref-name-input"
                        value={character.label}
                        onChange={(e) => setSide(i as SideIndex, { character: e.target.value })}
                      >
                        {CHARACTERS.map((c) => (
                          <option key={c.label} value={c.label}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                    </span>
                    <span className="pref-setting-hint">{character.description}</span>
                  </label>
                </div>
              );
            })}
          </div>

          {error && <p className="arena-error">{error}</p>}

          <button type="submit" className="start-button" disabled={busy || topic.trim().length < 3}>
            {busy ? "Setting the stage" : "Start the debate"}
          </button>
        </form>

        {debates.length > 0 && (
          <>
            <h3 className="pref-field-label arena-section">Past debates</h3>
            <div className="pref-account-card arena-card arena-card--list">
              {debates.map((d) => {
                const { sides: pair, status, winner, turn } = d.summary;
                return (
                  <div
                    key={d.id}
                    className="pref-list-item"
                    role="button"
                    tabIndex={0}
                    onClick={() => run(() => apiGetGame<ArenaState>(d.id))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") run(() => apiGetGame<ArenaState>(d.id));
                    }}
                  >
                    <div className="pref-item-info">
                      <div className="pref-item-name">{d.title}</div>
                      <div className="pref-item-desc">
                        {pair.map(nameOf).join(" vs ")}
                        {" · "}
                        {status === "done" && winner !== null
                          ? `${nameOf(pair[winner])} won`
                          : status === "judging"
                            ? "Waiting for your verdict"
                            : `In progress, ${turn} ${turn === 1 ? "speech" : "speeches"} in`}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="arena-link arena-link--quiet"
                      onClick={(e) => {
                        e.stopPropagation();
                        remove(d.id);
                      }}
                    >
                      Delete
                    </button>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ---- Stage: the debate as it happens, then the verdict ----

function Stage({
  save,
  onSave,
  onLeave,
}: {
  save: ArenaSave;
  onSave: (next: ArenaSave) => void;
  onLeave: () => void;
}) {
  const state = save.state;
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState("");
  const [rejudging, setRejudging] = useState(false);
  const [deciding, setDeciding] = useState(false);
  // One speech is requested at a time, and a reply that lands after the player has left is dropped.
  const requesting = useRef(false);
  const onStage = useRef(true);
  const feedEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    onStage.current = true;
    return () => {
      onStage.current = false;
    };
  }, []);

  // The debate runs itself: each speech that arrives asks for the next one.
  useEffect(() => {
    if (state.status !== "active" || paused || error || requesting.current) return;
    requesting.current = true;
    apiPlayTurn<ArenaState>(save.id, "")
      .then((next) => {
        requesting.current = false;
        if (onStage.current) onSave(next);
      })
      .catch((err) => {
        requesting.current = false;
        if (onStage.current) setError(err instanceof Error ? err.message : "Something went wrong.");
      });
  }, [state.status, state.turn, paused, error, save.id, onSave]);

  useEffect(() => {
    feedEnd.current?.scrollIntoView({ block: "end" });
  }, [state.speeches.length, state.status, error]);

  // After a failed speech, pick up from wherever the server has got to.
  const retry = async () => {
    try {
      onSave(await apiGetGame<ArenaState>(save.id));
    } catch {
      // still unreachable: the next attempt will say so
    }
    setError("");
  };

  const decide = async (winner: SideIndex) => {
    if (deciding) return;
    setDeciding(true);
    setError("");
    try {
      onSave(await apiEditGame<ArenaState>(save.id, "verdict", { winner }));
      setRejudging(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setDeciding(false);
    }
  };

  const total = state.rounds * 2 + 2;
  const live = state.status === "active";
  const voice = useDebateVoice(state.speeches, live);
  const readAloudButton = voice.supported && state.speeches.length > 0 && (
    <button
      type="button"
      className={`pref-confirm-no arena-voice${voice.readAloud ? " is-on" : ""}`}
      onClick={voice.toggleReadAloud}
      aria-pressed={voice.readAloud}
    >
      <SpeakerIcon />
      {voice.readAloud ? "Stop reading" : live ? "Read aloud" : "Listen to the debate"}
    </button>
  );
  const nextSide = (state.turn < state.rounds * 2 ? state.turn % 2 : state.turn - state.rounds * 2) as SideIndex;
  const nextIsClosing = state.turn >= state.rounds * 2;
  const judging = state.status === "judging" || rejudging;
  const stageLabel = !live
    ? state.status === "done"
      ? "Decided"
      : "Your verdict"
    : nextIsClosing
      ? "Closing remarks"
      : `Round ${Math.floor(state.turn / 2) + 1} of ${state.rounds}`;

  const speaking = (i: number) => live && !paused && !error && nextSide === i;
  const won = (i: number) => state.status === "done" && state.winner === i;
  // Under each name: what they are doing, then the model behind the character
  const noteFor = (i: SideIndex) => {
    const side = state.sides[i];
    const doing = won(i) ? "Winner" : speaking(i) ? "Speaking" : STANCE_LABEL[side.stance];
    return side.character ? `${doing} · ${side.model}` : doing;
  };

  return (
    <div className="arena arena--stage">
      <div className="arena-head">
        <BackButton label="Back to all debates" onClick={onLeave} />
        <h2 className="arena-title">{state.topic}</h2>
        <span className="pref-content-badge">{stageLabel}</span>
      </div>

      <div className="arena-versus">
        <Debater side={state.sides[0]} index={0} note={noteFor(0)} speaking={speaking(0)} won={won(0)} />
        <span className="arena-vs">vs</span>
        <Debater side={state.sides[1]} index={1} note={noteFor(1)} speaking={speaking(1)} won={won(1)} mirrored />
      </div>

      {/* The chat's own bubbles: the side arguing for speaks from the left, the side against from the right */}
      <div className="arena-feed">
        {state.speeches.map((speech, i) => {
          const role = speech.side === 0 ? "assistant" : "user";
          return (
            <div key={i} className={`message-row ${role}`}>
              <div className={`msg-bubble-group${speech.side === 1 ? " user-group" : ""}`}>
                <div className={`message ${role}${voice.speaking === i ? " is-speaking" : ""}`}>{speech.text}</div>
                <div className={`msg-meta${speech.side === 1 ? " user-meta" : ""}`}>
                  <span className="msg-timestamp">
                    {nameOf(state.sides[speech.side])} ·{" "}
                    {speech.kind === "closing" ? "Closing remarks" : `Round ${speech.round}`}
                  </span>
                  {voice.supported && (
                    <div className="msg-actions">
                      <button
                        type="button"
                        className={`listen-btn${voice.speaking === i ? " speaking" : ""}`}
                        onClick={() => voice.listen(i)}
                        title={voice.speaking === i ? "Stop" : "Listen"}
                      >
                        {voice.speaking === i ? (
                          <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" stroke="none">
                            <rect x="4" y="4" width="16" height="16" rx="2" />
                          </svg>
                        ) : (
                          <SpeakerIcon />
                        )}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {live && !paused && !error && (
          <div className={`message-row ${nextSide === 0 ? "assistant" : "user"} arena-waiting`}>
            <span className="waiting" role="status">
              <span className="waiting-leaves" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              <span className="thinking-phrase">
                {nameOf(state.sides[nextSide])} is{" "}
                {nextIsClosing ? "writing closing remarks" : "preparing an argument"}
              </span>
            </span>
          </div>
        )}

        {state.status === "done" && state.winner !== null && !rejudging && (
          <div className="arena-verdict">
            <span className="arena-title">{nameOf(state.sides[state.winner])} wins</span>
            <span className="pref-setting-hint">
              You gave the debate to the side arguing {state.sides[state.winner].stance} the topic, played by{" "}
              {state.sides[state.winner].model}.
            </span>
          </div>
        )}

        {error && <p className="arena-error">{error}</p>}
        <div ref={feedEnd} />
      </div>

      <div className="arena-controls">
        {live ? (
          <>
            <span className="msg-timestamp">
              Speech {Math.min(state.turn + 1, total)} of {total}
            </span>
            {error ? (
              <button type="button" className="start-button" onClick={retry}>
                Try again
              </button>
            ) : (
              <button type="button" className="pref-confirm-no" onClick={() => setPaused((p) => !p)}>
                {paused ? "Resume" : "Pause after this speech"}
              </button>
            )}
            {readAloudButton}
          </>
        ) : judging ? (
          <>
            <span className="pref-setting-label">Your call, moderator. Who won?</span>
            {state.sides.map((side, i) => (
              <button
                key={i}
                type="button"
                className="start-button"
                onClick={() => decide(i as SideIndex)}
                disabled={deciding}
              >
                {nameOf(side)} ({STANCE_LABEL[side.stance]})
              </button>
            ))}
            {readAloudButton}
          </>
        ) : (
          <>
            <button type="button" className="start-button" onClick={onLeave}>
              New debate
            </button>
            <button type="button" className="pref-confirm-no" onClick={() => setRejudging(true)}>
              Change the verdict
            </button>
            {readAloudButton}
          </>
        )}
      </div>
    </div>
  );
}

/** The chat's Listen icon */
function SpeakerIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="13"
      height="13"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
    </svg>
  );
}

/** A debater as the Presets list would show them: initial, name, and a line underneath */
function Debater({
  side,
  index,
  note,
  speaking = false,
  won = false,
  mirrored = false,
}: {
  side: { model: string; character: string };
  index: SideIndex;
  note: string;
  speaking?: boolean;
  won?: boolean;
  /** Laid out right to left, for the debater on the right of the stage */
  mirrored?: boolean;
}) {
  const name = nameOf(side);
  return (
    <div
      className={`arena-debater arena-debater--${index === 0 ? "for" : "against"}${mirrored ? " is-mirrored" : ""}${speaking ? " is-speaking" : ""}`}
    >
      <div className="pref-item-icon">{name.charAt(0).toUpperCase()}</div>
      <div className="pref-item-info">
        <div className="pref-item-name">{name}</div>
        <div className="pref-item-desc">{note}</div>
      </div>
      {won && (
        <div className="pref-item-check checked">
          <span className="pref-check-mark">✓</span>
        </div>
      )}
    </div>
  );
}
