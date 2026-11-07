// The drawings on the game cards: small 3D objects in the game's own color (--game-color, which
// the card's badge sets as `color`). All lit the same way, from above: a lighter top, a darker
// base, a soft gloss over the upper half, a bright edge along the top and a soft shadow below.
// Gradients mix with currentColor, so each icon follows its game's color in every theme.
import { useId, type ReactNode } from "react";

const tint = (mix: string) => ({ stopColor: `color-mix(in srgb, currentColor, ${mix})` });

/** The shared lighting: `body` fills a shape, `gloss` lies over it, `shadow` sits it on the tile */
function Lit({ children }: { children: (ids: { body: string; deep: string; gloss: string; shadow: string }) => ReactNode }) {
  const id = useId().replace(/:/g, "");
  const ids = { body: `${id}-body`, deep: `${id}-deep`, gloss: `${id}-gloss`, shadow: `${id}-shadow` };
  return (
    <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden="true" className="game-icon-3d">
      <defs>
        <linearGradient id={ids.body} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={tint("white 22%")} />
          <stop offset="0.55" style={{ stopColor: "currentColor" }} />
          <stop offset="1" style={tint("black 22%")} />
        </linearGradient>
        {/* A second, darker body for whatever sits behind */}
        <linearGradient id={ids.deep} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={tint("black 8%")} />
          <stop offset="1" style={tint("black 38%")} />
        </linearGradient>
        <linearGradient id={ids.gloss} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.34" />
          <stop offset="0.4" stopColor="#fff" stopOpacity="0.1" />
          <stop offset="0.7" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <filter id={ids.shadow} x="-25%" y="-25%" width="150%" height="160%">
          <feDropShadow dx="0" dy="1.2" stdDeviation="1" floodColor="#000" floodOpacity="0.32" />
        </filter>
      </defs>
      {children(ids)}
    </svg>
  );
}

/** A briefcase */
export function CeoIcon() {
  const body = "M7.5 10H24.5A4.5 4.5 0 0 1 29 14.5V23.5A4.5 4.5 0 0 1 24.5 28H7.5A4.5 4.5 0 0 1 3 23.5V14.5A4.5 4.5 0 0 1 7.5 10Z";
  return (
    <Lit>
      {({ body: fill, gloss, shadow }) => (
        <>
          {/* The handle, in the color's darkest shade */}
          <path
            d="M12 10.5V7.5A2.5 2.5 0 0 1 14.5 5H17.5A2.5 2.5 0 0 1 20 7.5V10.5"
            fill="none"
            style={{ stroke: "color-mix(in srgb, currentColor, black 42%)" }}
            strokeWidth="2.3"
            strokeLinecap="round"
            filter={`url(#${shadow})`}
          />
          <path d={body} fill={`url(#${fill})`} filter={`url(#${shadow})`} />
          <path d={body} fill={`url(#${gloss})`} />
          <path d="M8 10.9H24" stroke="#fff" strokeOpacity="0.55" strokeWidth="0.8" strokeLinecap="round" />
          {/* The clasp */}
          <rect x="14" y="15.2" width="4" height="3" rx="1" style={{ fill: "color-mix(in srgb, currentColor, black 50%)" }} />
          <rect x="14.6" y="15.6" width="2.8" height="1.1" rx="0.55" fill="#fff" fillOpacity="0.35" />
        </>
      )}
    </Lit>
  );
}

/** A price tag with a dollar sign pressed into it */
export function NegotiationIcon() {
  const tag = "M5.5 7H20.2A2 2 0 0 1 21.7 7.7L28.2 14.7A2 2 0 0 1 28.2 17.3L21.7 24.3A2 2 0 0 1 20.2 25H5.5A2.5 2.5 0 0 1 3 22.5V9.5A2.5 2.5 0 0 1 5.5 7Z";
  const hole = `${useId().replace(/:/g, "")}-hole`;
  return (
    <Lit>
      {({ body, gloss, shadow }) => {
        return (
          <>
            <defs>
              {/* The string hole goes right through */}
              <mask id={hole}>
                <rect width="32" height="32" fill="#fff" />
                <circle cx="22.6" cy="16" r="1.7" fill="#000" />
              </mask>
            </defs>
            <g mask={`url(#${hole})`}>
              <path d={tag} fill={`url(#${body})`} filter={`url(#${shadow})`} />
              <path d={tag} fill={`url(#${gloss})`} />
            </g>
            <circle cx="22.6" cy="16" r="1.7" fill="none" style={{ stroke: "color-mix(in srgb, currentColor, black 45%)" }} strokeWidth="0.7" />
            <path d="M6 7.9H19.8" stroke="#fff" strokeOpacity="0.55" strokeWidth="0.8" strokeLinecap="round" />
            {/* Pressed in: a light edge below, the sign itself in a deep shade */}
            <text x="12.2" y="21.15" textAnchor="middle" fontFamily="Archivo, system-ui, sans-serif" fontWeight="800" fontSize="14" fill="#fff" fillOpacity="0.22">
              $
            </text>
            <text x="12.2" y="20.7" textAnchor="middle" fontFamily="Archivo, system-ui, sans-serif" fontWeight="800" fontSize="14" style={{ fill: "color-mix(in srgb, currentColor, black 58%)" }}>
              $
            </text>
          </>
        );
      }}
    </Lit>
  );
}

/** Two chat bubbles, one behind the other, in two shades of the same color */
export function ArenaIcon() {
  const back = "M14 12.5H25.5A3.5 3.5 0 0 1 29 16V20.5A3.5 3.5 0 0 1 25.5 24H25V27.8L21.2 24H14A3.5 3.5 0 0 1 10.5 20.5V16A3.5 3.5 0 0 1 14 12.5Z";
  const front = "M6.5 4.5H18.5A3.5 3.5 0 0 1 22 8V13A3.5 3.5 0 0 1 18.5 16.5H11.8L7.5 20.3V16.5H6.5A3.5 3.5 0 0 1 3 13V8A3.5 3.5 0 0 1 6.5 4.5Z";
  return (
    <Lit>
      {({ body, deep, gloss, shadow }) => (
        <>
          <path d={back} fill={`url(#${deep})`} filter={`url(#${shadow})`} />
          <path d={back} fill={`url(#${gloss})`} opacity="0.6" />
          <path d={front} fill={`url(#${body})`} filter={`url(#${shadow})`} />
          <path d={front} fill={`url(#${gloss})`} />
          <path d="M7 5.4H18" stroke="#fff" strokeOpacity="0.55" strokeWidth="0.8" strokeLinecap="round" />
        </>
      )}
    </Lit>
  );
}
