import { useEffect, useRef, useState } from "react";
import {
  FONTS,
  READER_SIZES,
  THEMES,
  WIDTHS,
  type ReaderPrefs,
} from "./readerPrefs";

export function FocusedReaderMenu({
  prefs,
  onChange,
}: {
  prefs: ReaderPrefs;
  onChange: (patch: Partial<ReaderPrefs>) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Clicking elsewhere or pressing Escape closes the menu
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="reader-menu-wrap" ref={wrapRef}>
      <button
        type="button"
        className={`voice-close-btn reader-menu-btn${open ? " is-open" : ""}`}
        onClick={() => setOpen((o) => !o)}
        aria-label="Reading settings"
        aria-expanded={open}
        title="Reading settings"
      >
        {/* A small A and a large A, drawn rather than typeset so the pair sits truly centred:
            text would ride on its baseline and leave room for descenders below */}
        <svg
          viewBox="0 0 24 24"
          width="20"
          height="20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M2.25 19 5.5 10l3.25 9M3.4 15.8h4.2" />
          <path d="M10.75 19 16.25 5l5.5 14M12.7 14h7.1" />
        </svg>
      </button>

      {open && (
        <div className="reader-menu" role="dialog" aria-label="Reading settings">
          <div className="reader-menu-size">
            <button
              type="button"
              className="reader-menu-step"
              onClick={() => onChange({ size: Math.max(0, prefs.size - 1) })}
              disabled={prefs.size === 0}
              aria-label="Smaller text"
            >
              <span className="reader-menu-step-small">A</span>
            </button>
            <div className="reader-menu-size-dots" aria-hidden="true">
              {READER_SIZES.map((_, i) => (
                <span key={i} className={i <= prefs.size ? "is-on" : ""} />
              ))}
            </div>
            <button
              type="button"
              className="reader-menu-step"
              onClick={() => onChange({ size: Math.min(READER_SIZES.length - 1, prefs.size + 1) })}
              disabled={prefs.size === READER_SIZES.length - 1}
              aria-label="Larger text"
            >
              <span className="reader-menu-step-large">A</span>
            </button>
          </div>

          <div className="reader-menu-label">Theme</div>
          <div className="reader-menu-themes">
            {THEMES.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`reader-theme-swatch${prefs.theme === t.id ? " is-selected" : ""}`}
                data-swatch={t.id}
                onClick={() => onChange({ theme: t.id })}
                aria-pressed={prefs.theme === t.id}
              >
                <span className="reader-theme-swatch-chip">Aa</span>
                <span className="reader-theme-swatch-name">{t.label}</span>
              </button>
            ))}
          </div>

          <div className="reader-menu-label">Font</div>
          <div className="reader-menu-segmented">
            {FONTS.map((f) => (
              <button
                key={f.id}
                type="button"
                className={prefs.font === f.id ? "is-selected" : ""}
                data-font-sample={f.id}
                onClick={() => onChange({ font: f.id })}
                aria-pressed={prefs.font === f.id}
              >
                {f.label}
              </button>
            ))}
          </div>

          <div className="reader-menu-label">Width</div>
          <div className="reader-menu-segmented">
            {WIDTHS.map((w) => (
              <button
                key={w.id}
                type="button"
                className={prefs.width === w.id ? "is-selected" : ""}
                onClick={() => onChange({ width: w.id })}
                aria-pressed={prefs.width === w.id}
              >
                {w.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
