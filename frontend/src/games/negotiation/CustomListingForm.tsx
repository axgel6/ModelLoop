import { useState } from "react";
import { createPortal } from "react-dom";
import { useEscapeKey } from "../../components/useEscapeKey";
import { CONDITIONS } from "./inventoryData";
import { Promote } from "./Promote";
import { canAuthenticate } from "./setup";
import type { CustomListing } from "./types";

/** List something of your own to sell. A model buyer messages about it. */
export function CustomListingForm({
  categories,
  busy,
  error,
  onSubmit,
  onClose,
}: {
  categories: string[];
  busy: boolean;
  error: string;
  /** With how it is promoted: a boost level, and whether to authenticate it first */
  onSubmit: (listing: CustomListing, promote: { boost: number; authenticate: boolean }) => void;
  onClose: () => void;
}) {
  const [item, setItem] = useState("");
  const [price, setPrice] = useState("");
  const [condition, setCondition] = useState("Used - Good");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [boost, setBoost] = useState(0);
  const [authenticate, setAuthenticate] = useState(false);
  useEscapeKey(onClose);

  const amount = Math.round(Number(price));
  const ready = item.trim().length >= 3 && amount > 0;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready || busy) return;
    const authenticable = canAuthenticate({ category, condition, title: item });
    onSubmit(
      {
        item: item.trim(),
        price: amount,
        condition: condition || null,
        category: category || null,
        description: description.trim(),
      },
      { boost, authenticate: authenticate && authenticable },
    );
  };

  return createPortal(
    <div className="chat-preferences-modal-overlay" onClick={onClose}>
      <form
        className="landing-theme-modal neg-browser neg-custom"
        role="dialog"
        aria-label="Sell something of your own"
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
      >
        <div className="landing-theme-modal-header">
          <span>Sell something of your own</span>
          <button type="button" className="landing-theme-modal-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <p className="pref-setting-hint">List anything you like. A buyer will message you about it.</p>

        <div className="login-field">
          <label htmlFor="neg-custom-item">Title</label>
          <input
            id="neg-custom-item"
            value={item}
            onChange={(e) => setItem(e.target.value)}
            maxLength={80}
            placeholder="Nintendo DS Lite, pink, with charger"
            autoFocus
          />
        </div>

        <div className="neg-custom-row">
          <div className="login-field">
            <label htmlFor="neg-custom-price">Asking price ($)</label>
            <input
              id="neg-custom-price"
              value={price}
              onChange={(e) => setPrice(e.target.value.replace(/[^\d]/g, "").slice(0, 10))}
              inputMode="numeric"
              placeholder="85"
            />
          </div>
          <label className="neg-select">
            <span>Condition</span>
            <select value={condition} onChange={(e) => setCondition(e.target.value)}>
              <option value="">Not stated</option>
              {CONDITIONS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="neg-select">
            <span>Category</span>
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">Custom</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="login-field">
          <label htmlFor="neg-custom-description">Description</label>
          <textarea
            id="neg-custom-description"
            className="neg-custom-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={600}
            rows={4}
            placeholder="Condition, what is included, any flaws. The buyer only knows what is written here."
          />
        </div>

        <Promote
          asking={amount}
          boost={boost}
          onBoost={setBoost}
          authenticable={canAuthenticate({ category, condition, title: item })}
          authenticate={authenticate}
          onAuthenticate={setAuthenticate}
        />

        {error && <p className="neg-error">{error}</p>}

        <div className="neg-start">
          <button type="submit" className="start-button" disabled={!ready || busy}>
            {busy ? "Posting" : "List it"}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
