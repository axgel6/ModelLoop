// The ModelLoop wordmark, stacked "Model" over "Loop" unless `stacked` is off.
// It can be grabbed and stretched: see stretchy.ts, which picks it up by its
// class name.

export function StretchyLogo({ stacked = true }: { stacked?: boolean }) {
  if (!stacked) return <span className="stretchy-logo">ModelLoop</span>;
  return (
    <span className="stretchy-logo">
      <span className="stretchy-logo-line">Model</span>
      <span className="stretchy-logo-line">Loop</span>
    </span>
  );
}
