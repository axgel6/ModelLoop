import { money } from "./hustleData";
import { BOOSTS, authFee, boostFee } from "./setup";

/** Selling: pay to reach more buyers, and to have it authenticated before it goes up. Fees come out at once. */
export function Promote({
  asking,
  boost,
  onBoost,
  authenticable,
  authenticate,
  onAuthenticate,
}: {
  asking: number;
  boost: number;
  onBoost: (level: number) => void;
  /** Only things that get faked or tampered with */
  authenticable: boolean;
  authenticate: boolean;
  onAuthenticate: (on: boolean) => void;
}) {
  const price = asking > 0 ? asking : 0;
  return (
    <div className="neg-promote">
      <span className="neg-field-label">Promote it</span>
      <div className="neg-modes neg-promote-boosts" role="radiogroup" aria-label="Boost">
        {BOOSTS.map((b) => (
          <button
            key={b.level}
            type="button"
            role="radio"
            aria-checked={boost === b.level}
            className={`neg-chip${boost === b.level ? " is-on" : ""}`}
            onClick={() => onBoost(b.level)}
            title={b.blurb}
          >
            {b.label}
            {b.level > 0 && <span className="neg-chip-cost">{money(boostFee(b.level, price))}</span>}
          </button>
        ))}
      </div>
      <span className="pref-setting-hint">{BOOSTS[boost].blurb}</span>
      {authenticable && (
        <div className="neg-setting neg-promote-auth">
          <div className="neg-setting-text">
            <span className="neg-promote-auth-name">
              Authenticate it first <span className="neg-chip-cost">{money(authFee(price))}</span>
            </span>
            <span className="pref-setting-hint">
              Buyers pay more for a verified item. If it does not pass, it is listed without the badge.
            </span>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={authenticate}
            aria-label="Authenticate it first"
            className={`neg-switch${authenticate ? " is-on" : ""}`}
            onClick={() => onAuthenticate(!authenticate)}
          >
            <span className="neg-switch-knob" aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}
