import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useEscapeKey } from "../../components/useEscapeKey";
import { readableTextOn } from "../../components/utils/chatUtils";
import { Avatar } from "./Avatar";
import { avatarSeed } from "./avatarSeed";
import { Tile } from "./Bank";
import { apiDeleteReview, apiProfile, money, signedMoney } from "./hustleData";
import type { GivenReview, MarketProfile, Review } from "./types";

type Tab = "all" | "buy" | "sell" | "given";

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

            <div className="neg-modes" role="tablist" aria-label="Reviews">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.id}
                  className={`neg-chip${tab === t.id ? " is-on" : ""}`}
                  onClick={() => setTab(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="neg-bank-statement">
              {tab === "given" ? (
                profile.given.length ? (
                  profile.given.map((g) => <GivenRow key={g.id ?? g.at} given={g} onDelete={() => remove(g.id ?? g.at)} />)
                ) : (
                  <p className="pref-setting-hint neg-profile-empty">
                    After a deal, you can rate the person you dealt with. Your reviews show up here.
                  </p>
                )
              ) : shown.length ? (
                shown.map((r, i) => <ReviewRow key={r.id ?? `${r.at}-${i}`} review={r} />)
              ) : (
                <p className="pref-setting-hint neg-profile-empty">
                  {tab === "all"
                    ? "No reviews yet. People rate you when a chat ends."
                    : `No reviews ${tab === "buy" ? "from sellers" : "from buyers"} yet.`}
                </p>
              )}
            </div>
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

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
