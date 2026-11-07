import { useEffect, useRef, useState, type CSSProperties } from "react";
import { sounds } from "../sounds";
import { pathParts, replacePath } from "../subroute";
import { GAMES } from "./registry";
import type { GameInfo } from "./types";
import "./games.css";

interface GamesHubProps {
  /** The model picked in Preferences, handed on to whichever game is opened */
  model?: string;
}

const SELECTED_KEY = "games_selected";

const playable = (game: GameInfo) => game.status === "available" && !!game.component;
const colorOf = (game: GameInfo) =>
  ({ "--game-color": `var(--snes-${game.button.toLowerCase()})` }) as CSSProperties;

function storedSelection(): number {
  try {
    const at = GAMES.findIndex((g) => g.id === localStorage.getItem(SELECTED_KEY));
    return at < 0 ? 0 : at;
  } catch {
    return 0;
  }
}

export function GamesHub({ model }: GamesHubProps) {
  // A refresh on /games/<game> reopens that game
  const [openId, setOpenId] = useState<string | null>(() => {
    const [first, id] = pathParts();
    return first === "games" && GAMES.some((g) => g.id === id && g.component) ? id : null;
  });
  useEffect(() => {
    // Only when the game changes: a game keeps its own save at the end of the path
    if (pathParts()[1] !== (openId ?? undefined)) replacePath(openId ? `/games/${openId}` : "/games");
  }, [openId]);
  const Game = GAMES.find((g) => g.id === openId)?.component;
  // The game whose settings are open, if any
  const [settingsFor, setSettingsFor] = useState<string | null>(null);
  const Settings = GAMES.find((g) => g.id === settingsFor)?.settings;
  // The tile with the ring: hovered, focused or moved to with the arrow keys. Remembered.
  const [selected, setSelected] = useState(storedSelection);
  const tiles = useRef<(HTMLButtonElement | null)[]>([]);
  const game = GAMES[selected] ?? GAMES[0];

  const select = (index: number) => {
    setSelected(index);
    try {
      localStorage.setItem(SELECTED_KEY, GAMES[index].id);
    } catch {
      // Not remembered, then
    }
  };

  // A console's controls: arrows to choose, Enter to play, S for the game's settings
  useEffect(() => {
    if (openId || settingsFor) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || target?.closest("input, textarea, select, [contenteditable='true']")) return;
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        const next = (selected + (e.key === "ArrowRight" ? 1 : -1) + GAMES.length) % GAMES.length;
        select(next);
        tiles.current[next]?.focus();
        sounds.play("tick");
      } else if (e.key === "Enter" && !target?.closest("button")) {
        if (playable(game)) setOpenId(game.id);
      } else if ((e.key === "s" || e.key === "S") && game.settings && playable(game)) {
        setSettingsFor(game.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (Game) return <Game model={model} onExit={() => setOpenId(null)} />;

  return (
    <div className="games-hub">
      {Settings && <Settings onClose={() => setSettingsFor(null)} />}
      <div className="games-hub-inner">
        <header className="games-hub-header">
          <h2 className="games-hub-title">Games</h2>
          <p className="games-hub-subline">
            The AI runs the world. You make the calls.
          </p>
        </header>

        {/* The shelf: one square cover per game, the chosen one ringed in its color */}
        <div className="games-shelf" role="listbox" aria-label="Games" aria-orientation="horizontal">
          {GAMES.map((g, i) => {
            const Icon = g.icon;
            return (
              <button
                key={g.id}
                ref={(el) => {
                  tiles.current[i] = el;
                }}
                type="button"
                role="option"
                aria-selected={i === selected}
                aria-label={g.name}
                className={`game-tile${i === selected ? " is-selected" : ""}${playable(g) ? "" : " is-soon"}${g.cover ? " has-cover" : ""}`}
                style={colorOf(g)}
                onMouseEnter={() => select(i)}
                onFocus={() => select(i)}
                onClick={() => playable(g) && setOpenId(g.id)}
              >
                {g.cover ? (
                  <img className="game-tile-cover" src={g.cover} alt="" draggable={false} />
                ) : (
                  <span className="game-tile-art" aria-hidden="true">
                    {Icon ? <Icon /> : <span className="game-tile-monogram">{g.monogram}</span>}
                  </span>
                )}
                {!playable(g) && <span className="game-tile-soon">Coming soon</span>}
              </button>
            );
          })}
          {/* An empty slot: there is room for more */}
          <div className="game-tile game-tile--empty" aria-hidden="true" />
        </div>

        {/* The chosen game: its name, what it is, and how to start it */}
        <section className="games-detail" style={colorOf(game)} aria-live="polite">
          <h3 className="games-detail-name">{game.name}</h3>
          <p className="games-detail-tagline">{game.tagline}</p>
          <p className="games-detail-desc">{game.description}</p>
          <div className="games-detail-actions">
            <button
              type="button"
              className="start-button games-play"
              onClick={() => setOpenId(game.id)}
              disabled={!playable(game)}
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
                <path d="M8 5.5v13a1 1 0 0 0 1.52.85l10.4-6.5a1 1 0 0 0 0-1.7L9.52 4.65A1 1 0 0 0 8 5.5z" />
              </svg>
              {playable(game) ? "Play" : "Coming soon"}
            </button>
            {game.settings && playable(game) && (
              <button
                type="button"
                className="game-card-settings"
                onClick={() => setSettingsFor(game.id)}
                title={`${game.name} settings`}
                aria-label={`${game.name} settings`}
              >
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              </button>
            )}
          </div>
        </section>

      </div>
    </div>
  );
}

/** Controller icon for the sidebar entry */
export function GamesIcon({ size = 15 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="2" y="6" width="20" height="12" rx="6" />
      <line x1="6.5" y1="12" x2="10.5" y2="12" />
      <line x1="8.5" y1="10" x2="8.5" y2="14" />
      <line x1="15" y1="13" x2="15.01" y2="13" />
      <line x1="18" y1="11" x2="18.01" y2="11" />
    </svg>
  );
}
