import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { sounds } from "../../sounds";
import { BadgeMark, badgeProgress, badgeStatus } from "./Profile";
import type { Badge } from "./types";

// How long each badge stays up before the next one drops in, and how long it takes to leave
const SHOW_MS = 4600;
const LEAVE_MS = 380;

/**
 * A badge just earned, dropped in from the top like the chat search: the same dark glass pill,
 * the badge where the search icon sits, and what it was for below it like a result.
 * The whole thing is laid out, fonts and all, before it shows, so it lands in one piece.
 * Several badges show one after another. Click to dismiss early.
 * With preview, it shows a badge from the profile instead: earned or not, and how close.
 */
export function BadgeToast({
  badges,
  preview = false,
  onDone,
}: {
  badges: Badge[];
  preview?: boolean;
  onDone: () => void;
}) {
  const [index, setIndex] = useState(0);
  // "wait": rendered but hidden while fonts load and it lays out; "in": showing; "out": leaving
  const [phase, setPhase] = useState<"wait" | "in" | "out">("wait");
  const timers = useRef<number[]>([]);
  const badge = badges[index];

  const next = () => {
    timers.current.forEach(window.clearTimeout);
    setPhase("out");
    timers.current = [
      window.setTimeout(() => {
        if (index + 1 < badges.length) {
          setPhase("wait");
          setIndex(index + 1);
        } else onDone();
      }, LEAVE_MS),
    ];
  };

  useEffect(() => {
    if (!badge) return;
    let cancelled = false;
    let frame = 0;
    const fonts = document.fonts?.ready ?? Promise.resolve();
    void fonts.then(() => {
      // Two frames: one to lay out the hidden box, one to start the animation from that layout
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => {
          if (cancelled) return;
          setPhase("in");
          sounds.play(preview ? "pop" : "done");
          timers.current = [window.setTimeout(next, SHOW_MS)];
        });
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      timers.current.forEach(window.clearTimeout);
    };
  }, [index, badge?.id]);

  if (!badge) return null;

  return createPortal(
    <div className="spotlight-overlay neg-achievement-overlay" role="status" aria-live="polite">
      <div
        key={`${badge.id}-${index}`}
        className={`spotlight-box has-results neg-achievement is-${phase}${preview && !badge.at ? " is-locked" : ""}`}
        onClick={phase === "in" ? next : undefined}
        title="Dismiss"
      >
        <div className="spotlight-input-row neg-achievement-row">
          <span className="neg-achievement-mark" aria-hidden="true">
            <BadgeMark id={badge.id} />
          </span>
          <span className="neg-achievement-text">
            <span className="neg-achievement-kicker">{preview ? badgeStatus(badge) : "Badge earned"}</span>
            <span className="neg-achievement-name">{badge.name}</span>
          </span>
          {badges.length > 1 && (
            <span className="spotlight-result-date">
              {index + 1} of {badges.length}
            </span>
          )}
        </div>
        <div className="spotlight-results neg-achievement-results">
          <div className="spotlight-result-item active">
            <span className="spotlight-result-title neg-achievement-how">{badge.how}</span>
            {preview && badgeProgress(badge) && <span className="spotlight-result-date">{badgeProgress(badge)}</span>}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Shows each badge once as it arrives, ignoring the ones already there when this mounted, such as on reopening a chat */
export function useNewBadgeToast(badges: Badge[] | undefined) {
  const seen = useRef(new Set((badges ?? []).map((b) => b.id)));
  const [queue, setQueue] = useState<Badge[]>([]);
  useEffect(() => {
    const fresh = (badges ?? []).filter((b) => !seen.current.has(b.id));
    if (!fresh.length) return;
    fresh.forEach((b) => seen.current.add(b.id));
    setQueue((q) => [...q, ...fresh]);
  }, [badges]);
  return queue.length ? <BadgeToast badges={queue} onDone={() => setQueue([])} /> : null;
}
