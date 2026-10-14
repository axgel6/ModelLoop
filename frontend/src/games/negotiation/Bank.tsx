import { useState } from "react";
import { createPortal } from "react-dom";
import { useEscapeKey } from "../../components/useEscapeKey";
import { money, signedMoney } from "./hustleData";
import type { FreeBank, HustleRun, LedgerEntry } from "./types";

/** A bank account: a Hustle run's, or the free play one. Balance, how it got there, and every purchase and sale. */
export function Bank({
  run,
  free,
  onMove,
  onClose,
}: {
  run?: HustleRun;
  free?: FreeBank;
  /** Free play: deposit money from nowhere or withdraw it into nowhere */
  onMove?: (kind: "deposit" | "withdraw", amount: number) => Promise<void>;
  onClose: () => void;
}) {
  useEscapeKey(onClose);
  const [amount, setAmount] = useState("");
  const [moving, setMoving] = useState<"deposit" | "withdraw" | null>(null);
  const [moveError, setMoveError] = useState("");
  const account = (run ?? free)!;
  const spent = account.ledger.filter((l) => l.kind === "buy").reduce((sum, l) => sum - l.amount, 0);
  const earned = account.ledger.filter((l) => l.kind === "sell").reduce((sum, l) => sum + l.amount, 0);
  const flips = account.ledger.filter((l) => l.kind === "sell" && l.profit != null).map((l) => l.profit as number);
  // Money deposited from nowhere is not profit, and money withdrawn is not a loss
  const profit = account.net_worth - account.start_cash - (free?.deposited ?? 0);
  const statement = [...account.ledger].reverse();
  const held = run ? run.holdings.filter((h) => !h.sold).length : (free?.held ?? 0);
  // Hustle lines are dated by the run's day; free play by the calendar
  const when = (l: LedgerEntry) =>
    l.day != null ? `Day ${l.day}` : new Date(l.at).toLocaleDateString("en-US", { month: "short", day: "numeric" });

  const value = Math.round(Number(amount));
  const move = async (kind: "deposit" | "withdraw", sum = value) => {
    if (!onMove || moving || !(sum > 0)) return;
    setMoving(kind);
    setMoveError("");
    try {
      await onMove(kind, sum);
      setAmount("");
    } catch (err) {
      setMoveError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setMoving(null);
    }
  };

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
          <span className="neg-bank-amount">{money(account.cash)}</span>
          <span className="pref-setting-hint">
            {!run
              ? "Free play account"
              : run.status === "active"
                ? `Day ${run.day} of ${run.days} · ${run.days - run.day} ${run.days - run.day === 1 ? "day" : "days"} left`
                : run.status === "broke"
                  ? "Run over: out of money"
                  : "Run over"}
          </span>
        </div>

        {onMove && (
          <div className="neg-bank-move">
            <label className="neg-offer">
              <span>$</span>
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, "").slice(0, 10))}
                inputMode="numeric"
                placeholder="Amount"
                aria-label="Amount in dollars"
                disabled={!!moving}
              />
            </label>
            <button type="button" className="toolbar-chip-btn" onClick={() => move("deposit")} disabled={!!moving || !(value > 0)}>
              {moving === "deposit" ? "Depositing" : "Deposit"}
            </button>
            <button
              type="button"
              className="toolbar-chip-btn"
              onClick={() => move("withdraw")}
              disabled={!!moving || !(value > 0) || value > account.cash}
            >
              {moving === "withdraw" ? "Withdrawing" : "Withdraw"}
            </button>
            {[1000, 10000, 100000].map((sum) => (
              <button key={sum} type="button" className="toolbar-chip-btn" onClick={() => move("deposit", sum)} disabled={!!moving}>
                +{money(sum)}
              </button>
            ))}
            <span className="pref-setting-hint">
              Sandbox money: deposits come from nowhere and withdrawals vanish. Neither counts as profit.
            </span>
            {moveError && <p className="neg-error">{moveError}</p>}
          </div>
        )}

        <div className="neg-inventory-totals">
          <Tile label="Net worth" value={money(account.net_worth)} />
          <Tile label={run ? "Since day one" : "Since you opened it"} value={signedMoney(profit)} tone={profit < 0 ? "down" : profit > 0 ? "up" : undefined} />
          <Tile label="Spent" value={money(spent)} />
          <Tile label="Earned" value={money(earned)} />
        </div>

        <BalanceChart run={run} account={account} />

        <div className="neg-bank-facts">
          <span>
            {held} held · {flips.length} sold
          </span>
          {flips.length > 0 && <span>Best flip {signedMoney(Math.max(...flips))}</span>}
          {flips.length > 0 && <span>Worst flip {signedMoney(Math.min(...flips))}</span>}
          {(run?.milestones ?? []).map((m) => (
            <span key={m} className="neg-bank-milestone">
              Passed {money(m)}
            </span>
          ))}
        </div>

        <div className="neg-bank-statement">
          {statement.map((l, i) => (
            <div key={`${l.at}-${i}`} className="neg-bank-line">
              <span className={`neg-bank-kind is-${l.amount < 0 ? "buy" : "sell"}`} aria-hidden="true">
                {l.amount < 0 ? "−" : "+"}
              </span>
              <div className="neg-bank-what">
                <span className="neg-bank-item">{l.item}</span>
                <span className="pref-setting-hint">
                  {when(l)} ·{" "}
                  {l.kind === "buy"
                    ? `Bought from ${l.other}`
                    : l.kind === "sell"
                      ? `Sold to ${l.other}`
                      : l.kind === "refund"
                        ? `Refund from ${l.other}`
                        : l.kind === "fee"
                          ? l.other
                          : l.kind === "deposit"
                            ? "From nowhere"
                            : "Into nowhere"}
                  {l.note && ` · ${l.note}`}
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
              <span className="pref-setting-hint">{run ? "Day 0" : "When the account was opened"}</span>
            </div>
            <div className="neg-bank-sums">
              <span className="neg-bank-sum">{money(account.start_cash)}</span>
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

/** The balance after every purchase and sale, across the days of a run or the life of the free play account */
function BalanceChart({ run, account }: { run?: HustleRun; account: HustleRun | FreeBank }) {
  const points = [{ balance: account.start_cash }, ...account.ledger.map((l) => ({ balance: l.balance }))];
  if (points.length < 2) {
    return <p className="pref-setting-hint neg-bank-empty">Your balance chart starts with your first purchase.</p>;
  }
  const w = 320;
  const h = 90;
  const pad = 6;
  // Framed around where the balance has been, with the starting line always in view
  const high = Math.max(...points.map((p) => p.balance), account.start_cash);
  const low = Math.min(...points.map((p) => p.balance), account.start_cash);
  const margin = Math.max(1, (high - low) * 0.15);
  const top = high + margin;
  const bottom = Math.max(0, low - margin);
  const x = (i: number) => pad + (i / (points.length - 1)) * (w - pad * 2);
  const y = (v: number) => pad + (1 - (v - bottom) / Math.max(1, top - bottom)) * (h - pad * 2);
  const line = points.map((p, i) => `${x(i).toFixed(1)},${y(p.balance).toFixed(1)}`).join(" ");
  return (
    <div className="neg-bank-chart">
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label={run ? "Balance over the run" : "Balance over time"}>
        <line className="neg-bank-start" x1={pad} x2={w - pad} y1={y(account.start_cash)} y2={y(account.start_cash)} />
        <polyline className="neg-bank-area" points={`${x(0)},${h - pad} ${line} ${x(points.length - 1)},${h - pad}`} />
        <polyline className="neg-bank-line-path" points={line} />
      </svg>
      <div className="neg-bank-chart-scale">
        <span>{run ? "Day 0" : "Opened"}</span>
        <span>
          Low {money(low)} · High {money(high)} · Dashed line: where you started
        </span>
        <span>{run ? `Day ${run.day}` : "Now"}</span>
      </div>
    </div>
  );
}
