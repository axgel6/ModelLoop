/** The round arrow button used across the app, sized for a game's header. `label` says where it leads. */
export function BackButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="back-to-landing game-back" onClick={onClick} aria-label={label} title={label}>
      ←
    </button>
  );
}
