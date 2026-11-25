import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { sounds } from "../sounds";
import { useT } from "../i18n";

// How long a notice stays up, and how long it takes to leave (matches .notice.is-out)
const SHOW_MS = 4200;
const LEAVE_MS = 380;
// The first shake waits for the drop-in to land (.notice.is-in runs 0.6s)
const FIRST_NOD_DELAY_MS = 520;

// A quick shake of the head: wide at first, settling
const NOD: Keyframe[] = [
  { transform: "translateX(0)" },
  { transform: "translateX(-9px)" },
  { transform: "translateX(8px)" },
  { transform: "translateX(-6px)" },
  { transform: "translateX(4px)" },
  { transform: "translateX(-2px)" },
  { transform: "translateX(0)" },
];

interface NoticeProps {
  /** What went wrong. Empty or null shows nothing; a new message drops in. */
  message: string | null | undefined;
  /** A small label above it, naming where it came from ("Sign in", "Marketplace") */
  kicker?: string;
  /** Bump to shake it again for the same message, such as a second try that fails the same way */
  shake?: number;
  /** Called once it has gone, by itself or on a click, so the caller can clear its message */
  onDone?: () => void;
}

/**
 * Something that didn't work, told the way the Marketplace tells you about a badge: a dark
 * glass pill dropped in near the top of the window, with a mark where the badge sits and
 * the message beside it. Once it lands it shakes its head. It leaves by itself after a few
 * seconds, or on a click. A message that stays the same after it has gone stays hidden.
 */
export function Notice({ message, kicker, shake = 0, onDone }: NoticeProps) {
  const t = useT();
  // Each new message, or a bump of `shake`, is a new arrival
  const arrival = message ? `${shake}\u0000${message}` : "";
  const [lastArrival, setLastArrival] = useState("");
  // The text on screen, kept while it leaves even if the message has already been cleared
  const [shown, setShown] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  // Which shake this is, and whether it waits for the drop-in to land first
  const [nod, setNod] = useState({ count: 0, delay: 0 });
  const pill = useRef<HTMLDivElement>(null);
  const onDoneRef = useRef(onDone);

  useEffect(() => {
    onDoneRef.current = onDone;
  });

  // Settled while rendering, so the pill appears (or starts to leave) in the same frame
  if (arrival !== lastArrival) {
    setLastArrival(arrival);
    if (message) {
      const alreadyUp = shown !== null && !leaving;
      setShown(message);
      setLeaving(false);
      setNod((n) => ({ count: n.count + 1, delay: alreadyUp ? 0 : FIRST_NOD_DELAY_MS }));
    } else if (shown !== null) {
      setLeaving(true);
    }
  }

  // Each arrival says no out loud and starts the clock to leave
  useEffect(() => {
    if (!arrival) return;
    sounds.play("warn");
    const t = window.setTimeout(() => setLeaving(true), SHOW_MS);
    return () => window.clearTimeout(t);
  }, [arrival]);

  // Leaving: once the exit has played, it's gone
  useEffect(() => {
    if (!leaving) return;
    const t = window.setTimeout(() => {
      setShown(null);
      setLeaving(false);
      onDoneRef.current?.();
    }, LEAVE_MS);
    return () => window.clearTimeout(t);
  }, [leaving]);

  // The shake: run on the pill itself, so a second one doesn't replay the drop-in
  useEffect(() => {
    if (!nod.count || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const animation = pill.current?.animate?.(NOD, {
      duration: 480,
      delay: nod.delay,
      easing: "cubic-bezier(0.36, 0.07, 0.19, 0.97)",
    });
    return () => animation?.cancel();
  }, [nod]);

  if (shown === null) return null;

  return createPortal(
    <div className="notice-overlay" role="alert">
      <div
        ref={pill}
        className={`notice ${leaving ? "is-out" : "is-in"}`}
        onClick={() => setLeaving(true)}
        title={t("Dismiss")}
      >
        <span className="notice-mark" aria-hidden="true">
          <WarningIcon />
        </span>
        <span className="notice-text">
          {kicker && <span className="notice-kicker">{kicker}</span>}
          <span className="notice-message">{shown}</span>
        </span>
      </div>
    </div>,
    document.body,
  );
}

// The rounded triangle, and the exclamation pressed into it
const TRIANGLE =
  "M17.4 5.6Q20 1.2 22.6 5.6L36.3 29.6Q38.9 34 33.8 34L6.2 34Q1.1 34 3.7 29.6Z";
const BAR = "M17.9 13.6a2.1 2.1 0 0 1 4.2 0l-.7 9.4a1.4 1.4 0 0 1-2.8 0Z";

/**
 * A warning sign in the old Aqua manner, but matte: amber, a little lighter at the top and
 * deeper at the base, only a faint lift of light over the upper half and along its top edges,
 * and a soft shadow beneath. The mark is dark and pressed in, with a faint light along its
 * lower edge.
 */
function WarningIcon() {
  const id = useId().replace(/:/g, "");
  const body = `${id}-body`;
  const glow = `${id}-glow`;
  const gloss = `${id}-gloss`;
  const ink = `${id}-ink`;
  const shadow = `${id}-shadow`;
  return (
    <svg width="40" height="40" viewBox="0 0 40 40">
      <defs>
        <linearGradient id={body} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fbd264" />
          <stop offset="0.5" stopColor="#f2b638" />
          <stop offset="1" stopColor="#de9d26" />
        </linearGradient>
        <radialGradient id={glow} cx="0.5" cy="0.55" r="0.45">
          <stop offset="0" stopColor="#fff3b8" stopOpacity="0.16" />
          <stop offset="1" stopColor="#fff3b8" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={gloss} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.18" />
          <stop offset="0.38" stopColor="#fff" stopOpacity="0.05" />
          <stop offset="0.56" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={ink} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3b3733" />
          <stop offset="1" stopColor="#25221f" />
        </linearGradient>
        <filter id={shadow} x="-20%" y="-20%" width="140%" height="150%">
          <feDropShadow dx="0" dy="1.4" stdDeviation="1.3" floodColor="#000" floodOpacity="0.5" />
        </filter>
      </defs>
      <path d={TRIANGLE} fill={`url(#${body})`} filter={`url(#${shadow})`} />
      <path d={TRIANGLE} fill={`url(#${glow})`} />
      <path d={TRIANGLE} fill={`url(#${gloss})`} />
      {/* A darker rim all round, and a bright edge along the two upper sides */}
      <path d={TRIANGLE} fill="none" stroke="#a86a00" strokeOpacity="0.4" strokeWidth="0.8" />
      <path d="M5.2 28.4L18.2 6.1M21.8 6.1L34.8 28.4" stroke="#fff" strokeOpacity="0.2" strokeWidth="0.7" strokeLinecap="round" />
      {/* The mark, pressed in: a faint light catches its lower edge */}
      <g transform="translate(0 0.7)" fill="#fff" fillOpacity="0.22">
        <path d={BAR} />
        <circle cx="20" cy="28.4" r="2.1" />
      </g>
      <g fill={`url(#${ink})`}>
        <path d={BAR} />
        <circle cx="20" cy="28.4" r="2.1" />
      </g>
    </svg>
  );
}
