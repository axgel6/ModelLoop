import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useEscapeKey } from "../../components/useEscapeKey";
import { readableTextOn } from "../../components/utils/chatUtils";
import { Avatar } from "./Avatar";
import { BadgeToast } from "./BadgeToast";
import { avatarSeed } from "./avatarSeed";
import { Tile } from "./Bank";
import { apiDeleteReview, apiProfile, money, signedMoney } from "./hustleData";
import type { Badge, GivenReview, MarketProfile, Review } from "./types";

type Tab = "all" | "buy" | "sell" | "given";

// Reviews drawn at first; the rest wait for "Show all" so a long history stays light
const FIRST_REVIEWS = 15;

const TABS: { id: Tab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "buy", label: "As buyer" },
  { id: "sell", label: "As seller" },
  { id: "given", label: "By you" },
];

/** Your marketplace profile: your stars, how they split, what you have traded, and the reviews both ways */
export function Profile({
  initial,
  onGiven,
  onClose,
}: {
  initial?: MarketProfile | null;
  /** The reviews you have left, oldest first, after one is deleted: sellers' stars follow them */
  onGiven?: (given: GivenReview[]) => void;
  onClose: () => void;
}) {
  useEscapeKey(onClose);
  // Shown at once from what the menu loaded, and brought up to date behind it
  const [profile, setProfile] = useState<MarketProfile | null>(initial ?? null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("all");
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    apiProfile()
      .then(setProfile)
      .catch((err) => {
        if (!initial) setError(err instanceof Error ? err.message : "Something went wrong.");
      });
  }, []);

  const remove = async (key: string) => {
    const given = await apiDeleteReview(key);
    setProfile((p) => (p ? { ...p, given } : p));
    onGiven?.([...given].reverse());
  };

  // "As buyer" is the reviews sellers left you, for what you bought from them
  const shown = (profile?.reviews ?? []).filter((r) => tab === "all" || r.role === tab);
  const list = tab === "given" ? (profile?.given ?? []) : shown;
  const hidden = showAll ? 0 : Math.max(0, list.length - FIRST_REVIEWS);
  const cut = <T,>(rows: T[]) => (showAll ? rows : rows.slice(0, FIRST_REVIEWS));

  return createPortal(
    <div className="chat-preferences-modal-overlay" onClick={onClose}>
      <div
        className="landing-theme-modal neg-browser neg-bank neg-profile"
        role="dialog"
        aria-label="Your profile"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="landing-theme-modal-header">
          <span>Your profile</span>
          <button type="button" className="landing-theme-modal-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        {error && <p className="neg-error">{error}</p>}
        {!profile && !error && <p className="pref-setting-hint neg-bank-empty">Loading your profile</p>}

        {profile && (
          <>
            <div className="neg-profile-head">
              <UserIcon name={profile.name} />
              <div className="neg-profile-who">
                <span className="neg-profile-name">{profile.name}</span>
                {(profile.top ?? []).length > 0 && (
                  <span className="neg-profile-top">
                    {profile.top.map((id) => {
                      const b = profile.badges.find((x) => x.id === id);
                      return b ? (
                        <span key={id} className="neg-badge is-earned is-small" title={`${b.name}: ${b.how}`}>
                          <BadgeMark id={id} />
                          {b.name}
                        </span>
                      ) : null;
                    })}
                  </span>
                )}
                <span className="pref-setting-hint">
                  {profile.joined ? `Member since ${monthYear(profile.joined)}` : "Marketplace member"}
                </span>
              </div>
              <div className="neg-profile-score">
                <span className="neg-bank-amount">{profile.rating != null ? profile.rating.toFixed(1) : "New"}</span>
                <Stars value={profile.rating ?? 0} />
                <span className="pref-setting-hint">
                  {profile.review_count} {profile.review_count === 1 ? "review" : "reviews"}
                </span>
              </div>
            </div>

            <div className="neg-profile-split">
              {[5, 4, 3, 2, 1].map((n) => {
                const count = profile.split[String(n)] ?? 0;
                return (
                  <div key={n} className="neg-profile-bar">
                    <span className="pref-setting-hint">{n} ★</span>
                    <span className="neg-profile-track" aria-hidden="true">
                      <span style={{ width: `${profile.review_count ? (100 * count) / profile.review_count : 0}%` }} />
                    </span>
                    <span className="pref-setting-hint">{count}</span>
                  </div>
                );
              })}
              <p className="pref-setting-hint neg-profile-trust">{trustLine(profile)}</p>
            </div>

            <div className="neg-inventory-totals">
              <Tile label="Bought" value={String(profile.bought)} />
              <Tile label="Sold" value={String(profile.sold)} />
              <Tile label="Spent" value={money(profile.spent)} />
              <Tile label="Earned" value={money(profile.earned)} />
            </div>
            {profile.best_flip && (
              <div className="neg-bank-facts">
                <span>
                  Best flip {signedMoney(profile.best_flip.profit)} on {profile.best_flip.item}
                </span>
                <span>Free play and Hustle</span>
              </div>
            )}

            {(profile.badges ?? []).length > 0 && <BadgeGrid badges={profile.badges} />}

            <div className="neg-modes" role="tablist" aria-label="Reviews">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.id}
                  className={`neg-chip${tab === t.id ? " is-on" : ""}`}
                  onClick={() => {
                    setTab(t.id);
                    setShowAll(false);
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="neg-bank-statement">
              {tab === "given" ? (
                profile.given.length ? (
                  cut(profile.given).map((g) => <GivenRow key={g.id ?? g.at} given={g} onDelete={() => remove(g.id ?? g.at)} />)
                ) : (
                  <p className="pref-setting-hint neg-profile-empty">
                    After a deal, you can rate the person you dealt with. Your reviews show up here.
                  </p>
                )
              ) : shown.length ? (
                cut(shown).map((r, i) => <ReviewRow key={r.id ?? `${r.at}-${i}`} review={r} />)
              ) : (
                <p className="pref-setting-hint neg-profile-empty">
                  {tab === "all"
                    ? "No reviews yet. People rate you when a chat ends."
                    : `No reviews ${tab === "buy" ? "from sellers" : "from buyers"} yet.`}
                </p>
              )}
            </div>
            {hidden > 0 && (
              <button type="button" className="pref-confirm-no neg-profile-more" onClick={() => setShowAll(true)}>
                Show all {list.length} reviews
              </button>
            )}
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** Your ModelLoop icon, as the sidebar shows it: your initial, in the color picked in Preferences */
function UserIcon({ name }: { name: string }) {
  let color: string | null = null;
  try {
    color = localStorage.getItem("avatar_color");
  } catch {
    color = null;
  }
  return (
    <div
      className="sidebar-user-avatar neg-profile-photo"
      style={color ? { background: color, color: readableTextOn(color) } : undefined}
      aria-hidden="true"
    >
      {(name || "?")[0].toUpperCase()}
    </div>
  );
}

/** Every badge: earned ones lit, the rest greyed. Tap one to see it in the badge popup. */
function BadgeGrid({ badges }: { badges: Badge[] }) {
  const earned = badges.filter((b) => b.at).length;
  // The badge shown, and a count so tapping one again plays the popup afresh
  const [open, setOpen] = useState<{ badge: Badge; n: number } | null>(null);
  return (
    <section className="neg-badges">
      <span className="neg-field-label">
        Badges · {earned} of {badges.length}
      </span>
      <div className="neg-badge-grid" role="listbox" aria-label="Badges">
        {badges.map((b) => (
          <button
            key={b.id}
            type="button"
            role="option"
            aria-selected={open?.badge.id === b.id}
            className={`neg-badge-tile${b.at ? " is-earned" : ""}${open?.badge.id === b.id ? " is-open" : ""}`}
            onClick={() => setOpen((o) => ({ badge: b, n: (o?.n ?? 0) + 1 }))}
          >
            <span className="neg-badge-icon" aria-hidden="true">
              <BadgeMark id={b.id} />
            </span>
            <span className="neg-badge-tile-name">{b.name}</span>
          </button>
        ))}
      </div>
      <span className="pref-setting-hint">Tap a badge to see what it is for.</span>
      {open && <BadgeToast key={open.n} badges={[open.badge]} preview onDone={() => setOpen(null)} />}
    </section>
  );
}

/** Where a badge stands: when it was earned, or that it is still to earn */
export function badgeStatus(badge: Badge): string {
  return badge.at ? `Earned ${longDate(badge.at)}` : "Not earned yet";
}

/** How close an unearned badge is, such as "3 of 10", or null when it is all or nothing */
export function badgeProgress(badge: Badge): string | null {
  const p = badge.progress;
  if (badge.at || !p || p.need <= 1) return null;
  const show = (n: number) => (p.unit === "money" ? money(n) : p.unit === "percent" ? `${n}%` : n.toLocaleString("en-US"));
  return `${show(p.have)} of ${show(p.need)}`;
}

// A mark for each badge, drawn on a 24 by 24 grid like the chat's other icons
const BADGE_MARKS: Record<string, React.ReactNode> = {
  first_deal: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  first_flip: (
    <>
      <path d="M4 16l5-5 4 4 7-7" />
      <path d="M15 8h5v5" />
    </>
  ),
  sharp_eye: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  trader: (
    <>
      <path d="M4 8h13l-3.5-3.5" />
      <path d="M20 16H7l3.5 3.5" />
    </>
  ),
  verified: (
    <>
      <path d="M12 3l7.5 3v5.5c0 4.5-3.2 8.2-7.5 9.5-4.3-1.3-7.5-5-7.5-9.5V6z" />
      <path d="M8.8 12.2l2.2 2.2 4.4-4.6" />
    </>
  ),
  boosted: <path d="M13 2.5L5 13.5h6l-1 8 8-11h-6z" />,
  scam_spotter: (
    <>
      <path d="M12 3l9.5 17h-19z" />
      <path d="M12 10v4.5M12 17.5v.01" />
    </>
  ),
  lowballer: (
    <>
      <path d="M12 4v13" />
      <path d="M6.5 11.5L12 17l5.5-5.5" />
      <path d="M5 20.5h14" />
    </>
  ),
  haggle_hero: (
    <>
      <path d="M19 5L5 19" />
      <circle cx="7" cy="7" r="2.5" />
      <circle cx="17" cy="17" r="2.5" />
    </>
  ),
  collector: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
    </>
  ),
  flipper: (
    <>
      <path d="M20 12a8 8 0 1 1-2.3-5.6" />
      <path d="M20 4v5h-5" />
    </>
  ),
  smooth_talker: (
    <path d="M4.5 5.5h15a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5H10l-4.5 3.5v-3.5h-1A1.5 1.5 0 0 1 3 15V7a1.5 1.5 0 0 1 1.5-1.5z" />
  ),
  big_spender: (
    <>
      <rect x="2.5" y="6" width="19" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.5" />
    </>
  ),
  mogul: <path d="M3.5 8l4 4 4.5-6.5 4.5 6.5 4-4-1.5 10.5h-14z" />,
  hustle_mogul: (
    <>
      <path d="M7 4h10v5a5 5 0 0 1-10 0z" />
      <path d="M7 6H4.5a2.5 2.5 0 0 0 2.5 4M17 6h2.5a2.5 2.5 0 0 1-2.5 4M12 14v3.5M8.5 20.5h7" />
    </>
  ),
};

export function BadgeMark({ id }: { id: string }) {
  return (
    <svg
      className="neg-badge-mark"
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {BADGE_MARKS[id]}
    </svg>
  );
}

/** One review someone left you: their face, their stars, what it was about, and what they said */
function ReviewRow({ review }: { review: Review }) {
  return (
    <div className="neg-bank-line neg-profile-review">
      <Avatar seed={avatarSeed(review.by, review.listing, review.role === "sell")} size={34} />
      <div className="neg-bank-what">
        <span className="neg-profile-review-head">
          <span className="neg-bank-item">{review.by}</span>
          <Stars value={review.stars} />
          {review.kind === "auto" && <span className="neg-profile-tag">Automatic</span>}
        </span>
        {review.item && (
          <span className="pref-setting-hint">
            {review.role === "sell" ? "Sold to them" : "Bought from them"}: {review.item}
          </span>
        )}
        <span className={`neg-profile-text${review.text ? "" : " is-quiet"}`}>
          {review.pending ? "Writing a review" : review.text || "Left stars, no comment."}
        </span>
      </div>
      {review.at && <span className="pref-setting-hint neg-profile-date">{shortDate(review.at)}</span>}
    </div>
  );
}

/** One review you left someone else */
function GivenRow({ given, onDelete }: { given: GivenReview; onDelete: () => Promise<void> }) {
  // Two taps: the first asks, the second deletes
  const [armed, setArmed] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [failed, setFailed] = useState("");
  useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(false), 3000);
    return () => window.clearTimeout(t);
  }, [armed]);
  const tap = async () => {
    if (!armed) {
      setArmed(true);
      setFailed("");
      return;
    }
    setDeleting(true);
    try {
      await onDelete();
    } catch (err) {
      setFailed(err instanceof Error ? err.message : "Something went wrong.");
      setDeleting(false);
      setArmed(false);
    }
  };
  return (
    <div className="neg-bank-line neg-profile-review">
      <Avatar seed={avatarSeed(given.to, given.listing, given.role === "sell")} size={34} />
      <div className="neg-bank-what">
        <span className="neg-profile-review-head">
          <span className="neg-bank-item">To {given.to}</span>
          <Stars value={given.stars} />
        </span>
        {given.item && (
          <span className="pref-setting-hint">
            {given.role === "sell" ? "Sold to them" : "Bought from them"}: {given.item}
          </span>
        )}
        <span className={`neg-profile-text${given.text ? "" : " is-quiet"}`}>{given.text || "Stars only."}</span>
        {failed && <span className="neg-error">{failed}</span>}
      </div>
      <div className="neg-profile-side">
        <span className="pref-setting-hint neg-profile-date">{shortDate(given.at)}</span>
        {/* The sidebar's quiet cross; tapped once, it asks */}
        <button
          type="button"
          className={`neg-profile-delete${armed || deleting ? " is-armed" : ""}`}
          onClick={tap}
          disabled={deleting}
          title={armed ? "Tap again to delete" : "Delete review"}
          aria-label={armed ? `Tap again to delete your review of ${given.to}` : `Delete your review of ${given.to}`}
        >
          {deleting ? (
            "Deleting"
          ) : armed ? (
            "Delete?"
          ) : (
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}

/** Five stars, filled to the nearest whole one */
export function Stars({ value }: { value: number }) {
  const full = Math.round(value);
  return (
    <span className="neg-profile-stars" role="img" aria-label={`${value} out of 5 stars`}>
      {"★".repeat(full)}
      <span className="neg-profile-stars-off">{"★".repeat(5 - full)}</span>
    </span>
  );
}

/** What your rating does to people's patience with you. Mirrors trust_bonus in extras.py */
function trustLine(profile: MarketProfile): string {
  if (profile.review_count < 3) return "After 3 reviews, your rating starts to change how patient people are with you.";
  if (profile.trust > 0) return "Your rating makes people more patient with you.";
  if (profile.trust < 0) return "Your rating makes people less patient with you. Smooth deals bring it back up.";
  return "A rating of 4.7 or better makes people more patient with you.";
}

function monthYear(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function longDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
