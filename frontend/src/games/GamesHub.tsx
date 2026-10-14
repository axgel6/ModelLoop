import { useState } from "react";
import { GAMES } from "./registry";
import "./games.css";

interface GamesHubProps {
  /** The model picked in Preferences, handed on to whichever game is opened */
  model?: string;
}

export function GamesHub({ model }: GamesHubProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const Game = GAMES.find((g) => g.id === openId)?.component;
  if (Game) return <Game model={model} onExit={() => setOpenId(null)} />;

  return (
    <div className="games-hub">
      <div className="games-hub-inner">
        <header className="games-hub-header">
          <h2 className="games-hub-title">Games</h2>
          <p className="games-hub-subline">
            The AI runs the world. You make the calls.
          </p>
        </header>

        <div className="games-grid">
          {GAMES.map((game) => {
            const playable = game.status === "available" && !!game.component;
            const Icon = game.icon;
            return (
              <button
                key={game.id}
                type="button"
                className="game-card"
                disabled={!playable}
                onClick={() => setOpenId(game.id)}
              >
                <span className="game-card-head">
                  <span className="game-card-badge" aria-hidden="true">
                    {Icon ? <Icon /> : game.monogram}
                  </span>
                  <span className="game-card-titles">
                    <span className="game-card-name">{game.name}</span>
                    <span className="game-card-tagline">{game.tagline}</span>
                  </span>
                </span>
                <span className="game-card-desc">{game.description}</span>
                <span className="game-card-foot">
                  <span className="game-card-tags">
                    {game.tags.map((tag) => (
                      <span key={tag} className="game-card-tag">
                        {tag}
                      </span>
                    ))}
                  </span>
                  <span className={`game-card-play${playable ? " is-live" : ""}`}>
                    {playable ? "Play" : "Coming soon"}
                  </span>
                </span>
              </button>
            );
          })}

          <div className="game-ghost">
            <span className="game-ghost-title">More on the way</span>
            <span>New games will show up here as they are built.</span>
          </div>
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
