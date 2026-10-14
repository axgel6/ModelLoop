import { createPortal } from "react-dom";
import { useEscapeKey } from "../../components/useEscapeKey";
import { money, signedMoney } from "./hustleData";
import type { HustleRun } from "./types";

/** The Hustle run's bank account: balance, how it got there, and every purchase and sale */
export function Bank({ run, onClose }: { run: HustleRun; onClose: () => void }) {
  useEscapeKey(onClose);
  const spent = run.ledger.filter((l) => l.kind === "buy").reduce((sum, l) => sum - l.amount, 0);
  const earned = run.ledger.filter((l) => l.kind === "sell").reduce((sum, l) => sum + l.amount, 0);
  const flips = run.ledger.filter((l) => l.kind === "sell" && l.profit != null).map((l) => l.profit as number);
  const profit = run.net_worth - run.start_cash;
  const statement = [...run.ledger].reverse();

  return createPortal(
    <div className="chat-preferences-modal-overlay" onClick={onClose}>
      <div
        className="landing-theme-modal neg-browser neg-bank"
        role="dialog"
        aria-label="Bank account"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="landing-theme-modal-header">
          <span>Bank account</span>
          <button type="button" className="landing-theme-modal-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="neg-bank-balance">
          <span className="pref-setting-hint">Available balance</span>
          <span className="neg-bank-amount">{money(run.cash)}</span>
          <span className="pref-setting-hint">
            {run.status === "active"
              ? `Day ${run.day} of ${run.days} · ${run.days - run.day} ${run.days - run.day === 1 ? "day" : "days"} left`
              : run.status === "broke"
                ? "Run over: out of money"
                : "Run over"}
          </span>
        </div>

        <div className="neg-inventory-totals">
          <Tile label="Net worth" value={money(run.net_worth)} />
          <Tile label="Since day one" value={signedMoney(profit)} tone={profit < 0 ? "down" : profit > 0 ? "up" : undefined} />
          <Tile label="Spent" value={money(spent)} />
          <Tile label="Earned" value={money(earned)} />
        </div>

        <BalanceChart run={run} />

        <div className="neg-bank-facts">
          <span>
            {run.holdings.filter((h) => !h.sold).length} held · {flips.length} sold
          </span>
          {flips.length > 0 && <span>Best flip {signedMoney(Math.max(...flips))}</span>}
          {flips.length > 0 && <span>Worst flip {signedMoney(Math.min(...flips))}</span>}
          {run.milestones.map((m) => (
            <span key={m} className="neg-bank-milestone">
              Passed {money(m)}
            </span>
          ))}
        </div>

        <div className="neg-bank-statement">
          {statement.map((l, i) => (
            <div key={`${l.at}-${i}`} className="neg-bank-line">
              <span className={`neg-bank-kind is-${l.kind}`} aria-hidden="true">
                {l.kind === "buy" ? "−" : "+"}
              </span>
              <div className="neg-bank-what">
                <span className="neg-bank-item">{l.item}</span>
                <span className="pref-setting-hint">
                  Day {l.day} · {l.kind === "buy" ? `Bought from ${l.other}` : `Sold to ${l.other}`}
                  {l.profit != null && ` · ${l.profit >= 0 ? "profit" : "loss"} ${money(Math.abs(l.profit))}`}
                </span>
              </div>
              <div className="neg-bank-sums">
                <span className={`neg-bank-sum ${l.amount < 0 ? "is-down" : "is-up"}`}>{signedMoney(l.amount)}</span>
                <span className="pref-setting-hint">{money(l.balance)}</span>
              </div>
            </div>
          ))}
          <div className="neg-bank-line">
            <span className="neg-bank-kind" aria-hidden="true">
              ·
            </span>
            <div className="neg-bank-what">
              <span className="neg-bank-item">Opening balance</span>
              <span className="pref-setting-hint">Day 0</span>
            </div>
            <div className="neg-bank-sums">
              <span className="neg-bank-sum">{money(run.start_cash)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Tile({ label, value, tone }: { label: string; value: string; tone?: "up" | "down" }) {
  return (
    <div className="neg-inventory-total">
      <span className={`neg-inventory-total-value${tone ? ` is-${tone}` : ""}`}>{value}</span>
      <span className="pref-setting-hint">{label}</span>
    </div>
  );
}

/** The balance after every purchase and sale, across the days of the run */
function BalanceChart({ run }: { run: HustleRun }) {
  const points = [{ day: 0, balance: run.start_cash }, ...run.ledger.map((l) => ({ day: l.day, balance: l.balance }))];
  if (points.length < 2) {
    return <p className="pref-setting-hint neg-bank-empty">Your balance chart starts with your first purchase.</p>;
  }
  const w = 320;
  const h = 90;
  const pad = 6;
  // Framed around where the balance has been, with the starting line always in view
  const high = Math.max(...points.map((p) => p.balance), run.start_cash);
  const low = Math.min(...points.map((p) => p.balance), run.start_cash);
  const margin = Math.max(1, (high - low) * 0.15);
  const top = high + margin;
  const bottom = Math.max(0, low - margin);
  const x = (i: number) => pad + (i / (points.length - 1)) * (w - pad * 2);
  const y = (v: number) => pad + (1 - (v - bottom) / Math.max(1, top - bottom)) * (h - pad * 2);
  const line = points.map((p, i) => `${x(i).toFixed(1)},${y(p.balance).toFixed(1)}`).join(" ");
  return (
    <div className="neg-bank-chart">
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label="Balance over the run">
        <line className="neg-bank-start" x1={pad} x2={w - pad} y1={y(run.start_cash)} y2={y(run.start_cash)} />
        <polyline className="neg-bank-area" points={`${x(0)},${h - pad} ${line} ${x(points.length - 1)},${h - pad}`} />
        <polyline className="neg-bank-line-path" points={line} />
      </svg>
      <div className="neg-bank-chart-scale">
        <span>Day 0</span>
        <span>
          Low {money(low)} · High {money(high)} · Dashed line: where you started
        </span>
        <span>Day {run.day}</span>
      </div>
    </div>
  );
}
