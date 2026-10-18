import { useEffect, useState, type CSSProperties } from "react";
import { pathParts, replacePath } from "../subroute";
import { GAMES } from "./registry";
import "./games.css";

interface GamesHubProps {
  /** The model picked in Preferences, handed on to whichever game is opened */
  model?: string;
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

        <div className="games-list">
          {GAMES.map((game) => {
            const playable = game.status === "available" && !!game.component;
            const Icon = game.icon;
            return (
              <div
                key={game.id}
                className="game-card-wrap"
                style={{ "--game-color": `var(--snes-${game.button.toLowerCase()})` } as CSSProperties}
              >
              <button
                type="button"
                className="game-card"
                disabled={!playable}
                onClick={() => setOpenId(game.id)}
              >
                <span className="game-card-badge" aria-hidden="true">
                  {Icon ? <Icon /> : game.monogram}
                </span>
                <span className="game-card-text">
                  <span className="game-card-name">{game.name}</span>
                  <span className="game-card-tagline">{game.tagline}</span>
                  <span className="game-card-desc">{game.description}</span>
                </span>
                {playable ? (
                  <span className="game-card-play" aria-hidden="true">
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                      <path d="M8 5.5v13a1 1 0 0 0 1.52.85l10.4-6.5a1 1 0 0 0 0-1.7L9.52 4.65A1 1 0 0 0 8 5.5z" />
                    </svg>
                  </span>
                ) : (
                  <span className="game-card-soon">Coming soon</span>
                )}
              </button>
              {game.settings && playable && (
                <button
                  type="button"
                  className="game-card-settings"
                  onClick={() => setSettingsFor(game.id)}
                  title={`${game.name} settings`}
                  aria-label={`${game.name} settings`}
                >
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                  </svg>
                </button>
              )}
              </div>
            );
          })}
        </div>
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
