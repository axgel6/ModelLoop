import { useState } from "react";
import type { CeoState } from "./types";

type Week = CeoState["history"][number];
type Metric = "valuation" | "revenue" | "profit" | "cash";

const METRICS: { id: Metric; label: string }[] = [
  { id: "valuation", label: "Value" },
  { id: "revenue", label: "Revenue" },
  { id: "profit", label: "Profit" },
  { id: "cash", label: "Cash" },
];

// Drawing area, in SVG units. The chart scales to its container's width.
const W = 268;
const H = 112;
const PAD = { top: 8, right: 6, bottom: 16, left: 6 };

function short(amount: number): string {
  const abs = Math.abs(amount);
  const sign = amount < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 10_000) return `${sign}$${Math.round(abs / 1000)}k`;
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(1)}k`;
  return `${sign}$${Math.round(abs)}`;
}

function full(amount: number): string {
  return `${amount < 0 ? "-" : ""}$${Math.abs(Math.round(amount)).toLocaleString()}`;
}

/** One measure over the weeks played, with tabs to switch which. One series, one axis. */
export function TrendChart({ history }: { history: Week[] }) {
  const [metric, setMetric] = useState<Metric>("valuation");
  const [hover, setHover] = useState<number | null>(null);

  // Company value was not recorded on weeks played before it existed.
  const points = history
    .map((week) => ({ turn: week.turn, value: week[metric] }))
    .filter((p): p is { turn: number; value: number } => typeof p.value === "number");
  const label = METRICS.find((m) => m.id === metric)!.label;

  const tabs = (
    <div className="ceo-chart-tabs" role="tablist" aria-label="Chart measure">
      {METRICS.map((m) => (
        <button
          key={m.id}
          type="button"
          role="tab"
          aria-selected={m.id === metric}
          className={`ceo-chart-tab${m.id === metric ? " is-on" : ""}`}
          onClick={() => {
            setMetric(m.id);
            setHover(null);
          }}
        >
          {m.label}
        </button>
      ))}
    </div>
  );

  if (points.length < 2) {
    return (
      <div className="ceo-chart">
        {tabs}
        <p className="ceo-hint">Play a couple of weeks to see a trend.</p>
      </div>
    );
  }

  const values = points.map((p) => p.value);
  // Include zero when the series crosses it, so losses read as below the line.
  let low = Math.min(...values);
  let high = Math.max(...values);
  if (low < 0 && high < 0) high = 0;
  if (low === high) {
    low -= 1;
    high += 1;
  }
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (i / (points.length - 1)) * innerW;
  const y = (value: number) => PAD.top + (1 - (value - low) / (high - low)) * innerH;
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join("");
  const floor = y(Math.max(low, Math.min(high, 0)));
  const area = `${line}L${x(points.length - 1).toFixed(1)},${floor.toFixed(1)}L${x(0).toFixed(1)},${floor.toFixed(1)}Z`;
  const shown = hover === null ? null : points[hover];
  const first = points[0];
  const last = points[points.length - 1];

  const track = (e: React.PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const ratio = (((e.clientX - box.left) / box.width) * W - PAD.left) / innerW;
    setHover(Math.max(0, Math.min(points.length - 1, Math.round(ratio * (points.length - 1)))));
  };

  return (
    <div className="ceo-chart">
      {tabs}
      {/* Above the plot, not on it, so the figures never sit on top of the line */}
      <p className="ceo-chart-range">
        <span>Low {short(Math.min(...values))}</span>
        <span>High {short(Math.max(...values))}</span>
      </p>
      <div className="ceo-chart-plot">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={`${label} by week: ${full(first.value)} in week ${first.turn}, ${full(last.value)} in week ${last.turn}. Highest ${full(Math.max(...values))}, lowest ${full(Math.min(...values))}.`}
          onPointerMove={track}
          onPointerDown={track}
          onPointerLeave={() => setHover(null)}
        >
          {low < 0 && high > 0 && <line className="ceo-chart-zero" x1={PAD.left} x2={W - PAD.right} y1={y(0)} y2={y(0)} />}
          <path className="ceo-chart-area" d={area} />
          <path className="ceo-chart-line" d={line} />
          {shown && hover !== null && (
            <>
              <line className="ceo-chart-cross" x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={H - PAD.bottom} />
              <circle className="ceo-chart-dot" cx={x(hover)} cy={y(shown.value)} r="4" />
            </>
          )}
          <text className="ceo-chart-axis" x={PAD.left} y={H - 3}>
            Week {first.turn}
          </text>
          <text className="ceo-chart-axis" x={W - PAD.right} y={H - 3} textAnchor="end">
            Week {last.turn}
          </text>
        </svg>
        {shown && hover !== null && (
          <span
            className="ceo-chart-tip"
            style={{
              left: `${(x(hover) / W) * 100}%`,
              // Keep the label inside the plot at either end
              transform: `translateX(${hover < points.length / 2 ? "6px" : "calc(-100% - 6px)"})`,
            }}
          >
            <span className="ceo-chart-tip-week">Week {shown.turn}</span>
            {full(shown.value)}
          </span>
        )}
      </div>
    </div>
  );
}
