/** The heart that saves a listing, as on Marketplace */
export function SaveHeart({ saved, onSave }: { saved: boolean; onSave: () => void }) {
  return (
    <button
      type="button"
      className={`neg-heart${saved ? " is-on" : ""}`}
      onClick={(e) => {
        e.stopPropagation();
        onSave();
      }}
      onKeyDown={(e) => e.stopPropagation()}
      aria-pressed={saved}
      aria-label={saved ? "Unsave" : "Save"}
      title={saved ? "Saved. You will hear if the price drops." : "Save it, and hear if the price drops"}
    >
      <svg viewBox="0 0 24 24" width="16" height="16" fill={saved ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z" />
      </svg>
    </button>
  );
}
