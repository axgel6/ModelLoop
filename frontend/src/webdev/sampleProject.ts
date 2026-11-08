// A finished demo project for the /testweb preview: a barber shop site with a small store.
// Self-contained (no images, fonts or libraries from the internet) so it previews offline.

import type { ProjectFile } from "./preview";

const INDEX_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Fade &amp; Co. Barbers</title>
  <link rel="stylesheet" href="style.css" />
</head>
<body>
  <header class="nav">
    <a class="brand" href="#top">
      <span class="brand-mark">F</span>
      <span>Fade &amp; Co.</span>
    </a>
    <nav class="links">
      <a href="#services">Services</a>
      <a href="#team">Barbers</a>
      <a href="#shop">Shop</a>
      <a href="#visit">Visit</a>
    </nav>
    <div class="nav-actions">
      <button class="cart-btn" id="cartBtn" aria-label="Open cart">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 7h12l-1 13H7L6 7z"/><path d="M9 7a3 3 0 0 1 6 0"/></svg>
        <span class="cart-count" id="cartCount">0</span>
      </button>
      <a class="btn btn-gold" href="#book">Book now</a>
    </div>
  </header>

  <main id="top">
    <section class="hero">
      <div class="hero-text">
        <p class="eyebrow">Est. 2014 &middot; Downtown</p>
        <h1>Sharp cuts.<br />Steady hands.</h1>
        <p class="lead">Classic barbering with a modern edge. Hot towel shaves, precision fades and beard work, done right every time.</p>
        <div class="hero-actions">
          <a class="btn btn-gold" href="#book">Book a chair</a>
          <a class="btn btn-ghost" href="#shop">Shop grooming</a>
        </div>
        <div class="stats">
          <div><strong>4.9</strong><span>Google rating</span></div>
          <div><strong>12k+</strong><span>Cuts a year</span></div>
          <div><strong>5</strong><span>Master barbers</span></div>
        </div>
      </div>
      <div class="hero-art" aria-hidden="true">
        <div class="pole"><span></span></div>
        <div class="badge">Walk-ins<br />welcome</div>
      </div>
    </section>

    <section id="services" class="section">
      <div class="section-head">
        <p class="eyebrow">Services</p>
        <h2>The menu</h2>
      </div>
      <div class="services">
        <article class="service"><div><h3>Signature Cut</h3><p>Consultation, cut, wash and style.</p></div><span class="price">$38</span></article>
        <article class="service"><div><h3>Skin Fade</h3><p>Seamless blend down to the skin.</p></div><span class="price">$42</span></article>
        <article class="service"><div><h3>Hot Towel Shave</h3><p>Straight razor, hot towels, balm finish.</p></div><span class="price">$35</span></article>
        <article class="service"><div><h3>Beard Sculpt</h3><p>Shape, line up and conditioning oil.</p></div><span class="price">$25</span></article>
        <article class="service"><div><h3>Cut &amp; Beard</h3><p>The full treatment, start to finish.</p></div><span class="price">$58</span></article>
        <article class="service"><div><h3>Kids Cut</h3><p>Ages 12 and under.</p></div><span class="price">$24</span></article>
      </div>
    </section>

    <section id="team" class="section">
      <div class="section-head">
        <p class="eyebrow">The chairs</p>
        <h2>Meet the barbers</h2>
      </div>
      <div class="team">
        <article class="barber"><div class="avatar" style="--hue: 32">MR</div><h3>Marcus Reed</h3><p>Owner &middot; Fades</p></article>
        <article class="barber"><div class="avatar" style="--hue: 200">DL</div><h3>Diego Luna</h3><p>Shaves &middot; Beards</p></article>
        <article class="barber"><div class="avatar" style="--hue: 140">JK</div><h3>Jay Kim</h3><p>Textured cuts</p></article>
        <article class="barber"><div class="avatar" style="--hue: 330">SO</div><h3>Sam Ortiz</h3><p>Classic cuts</p></article>
      </div>
    </section>

    <section id="shop" class="section">
      <div class="section-head row">
        <div>
          <p class="eyebrow">Shop</p>
          <h2>Take the shop home</h2>
        </div>
        <div class="filters" id="filters">
          <button class="filter is-on" data-filter="all">All</button>
          <button class="filter" data-filter="hair">Hair</button>
          <button class="filter" data-filter="beard">Beard</button>
          <button class="filter" data-filter="tools">Tools</button>
        </div>
      </div>
      <div class="products" id="products"></div>
    </section>

    <section id="book" class="section book">
      <div>
        <p class="eyebrow">Book</p>
        <h2>Grab a chair</h2>
        <p class="lead">Pick a service and a time. We'll text you to confirm.</p>
      </div>
      <form class="book-form" id="bookForm">
        <label>Name<input required placeholder="Your name" /></label>
        <label>Service
          <select>
            <option>Signature Cut</option>
            <option>Skin Fade</option>
            <option>Hot Towel Shave</option>
            <option>Beard Sculpt</option>
            <option>Cut &amp; Beard</option>
          </select>
        </label>
        <label>Day<input type="date" required /></label>
        <button class="btn btn-gold" type="submit">Request booking</button>
        <p class="form-note" id="bookNote"></p>
      </form>
    </section>
  </main>

  <footer id="visit" class="footer">
    <div><h3>Fade &amp; Co.</h3><p>118 Main Street<br />Downtown</p></div>
    <div><h3>Hours</h3><p>Tue to Fri 9 to 7<br />Sat 8 to 5 &middot; Sun, Mon closed</p></div>
    <div><h3>Contact</h3><p>(555) 014-2290<br />hello@fadeandco.shop</p></div>
  </footer>

  <aside class="cart" id="cart" aria-hidden="true">
    <div class="cart-head">
      <h3>Your cart</h3>
      <button class="icon-btn" id="cartClose" aria-label="Close cart">&times;</button>
    </div>
    <div class="cart-items" id="cartItems"></div>
    <div class="cart-foot">
      <div class="cart-total"><span>Total</span><strong id="cartTotal">$0.00</strong></div>
      <button class="btn btn-gold wide" id="checkout">Checkout</button>
    </div>
  </aside>
  <div class="scrim" id="scrim"></div>
  <div class="toast" id="toast"></div>

  <script src="app.js"></script>
</body>
</html>
`;

const STYLE_CSS = `:root {
  --bg: #121212;
  --panel: #1b1b1b;
  --line: #2a2a2a;
  --ink: #f2efe9;
  --muted: #a39e94;
  --gold: #c9a227;
  --gold-soft: #e3c766;
  --radius: 16px;
}

* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--ink);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  line-height: 1.5;
}
h1, h2, h3 { font-family: Georgia, "Times New Roman", serif; font-weight: 700; margin: 0; }
a { color: inherit; text-decoration: none; }
button { font: inherit; cursor: pointer; }

.nav {
  position: sticky; top: 0; z-index: 10;
  display: flex; align-items: center; justify-content: space-between; gap: 16px;
  padding: 14px 5vw;
  background: rgba(18, 18, 18, 0.85);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--line);
}
.brand { display: flex; align-items: center; gap: 10px; font-family: Georgia, serif; font-weight: 700; font-size: 1.1rem; }
.brand-mark {
  display: grid; place-items: center; width: 34px; height: 34px; border-radius: 50%;
  background: var(--gold); color: #121212; font-size: 1rem;
}
.links { display: flex; gap: 26px; font-size: 0.92rem; color: var(--muted); }
.links a:hover { color: var(--ink); }
.nav-actions { display: flex; align-items: center; gap: 10px; }
.cart-btn {
  position: relative; display: grid; place-items: center; width: 40px; height: 40px;
  border-radius: 50%; border: 1px solid var(--line); background: var(--panel); color: var(--ink);
}
.cart-count {
  position: absolute; top: -4px; right: -4px; min-width: 18px; height: 18px; padding: 0 5px;
  border-radius: 9px; background: var(--gold); color: #121212; font-size: 0.7rem; font-weight: 700;
  display: grid; place-items: center;
}

.btn {
  display: inline-flex; align-items: center; justify-content: center;
  padding: 11px 20px; border-radius: 999px; border: 1px solid transparent;
  font-weight: 600; font-size: 0.92rem; transition: transform 0.15s, background 0.15s;
}
.btn:active { transform: scale(0.97); }
.btn-gold { background: var(--gold); color: #121212; }
.btn-gold:hover { background: var(--gold-soft); }
.btn-ghost { border-color: var(--line); color: var(--ink); }
.btn-ghost:hover { border-color: var(--gold); }
.wide { width: 100%; }

.hero {
  display: grid; grid-template-columns: 1.2fr 1fr; gap: 40px; align-items: center;
  padding: 80px 5vw 60px;
}
.eyebrow { margin: 0 0 10px; color: var(--gold); font-size: 0.78rem; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; }
.hero h1 { font-size: clamp(2.6rem, 6vw, 4.6rem); line-height: 1.02; }
.lead { color: var(--muted); font-size: 1.05rem; max-width: 34rem; }
.hero-actions { display: flex; flex-wrap: wrap; gap: 12px; margin: 26px 0 34px; }
.stats { display: flex; gap: 34px; }
.stats strong { display: block; font-family: Georgia, serif; font-size: 1.6rem; }
.stats span { color: var(--muted); font-size: 0.8rem; }

.hero-art {
  position: relative; height: 420px; border-radius: 28px;
  background: radial-gradient(circle at 30% 20%, #2a2418, transparent 60%), var(--panel);
  border: 1px solid var(--line); display: grid; place-items: center; overflow: hidden;
}
.pole {
  width: 74px; height: 300px; border-radius: 40px; overflow: hidden;
  border: 6px solid #d9d4c9; box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5);
}
.pole span {
  display: block; width: 100%; height: 200%;
  background: repeating-linear-gradient(-45deg, #b3261e 0 18px, #f2efe9 18px 36px, #1f4fa8 36px 54px, #f2efe9 54px 72px);
  animation: spin 3s linear infinite;
}
@keyframes spin { to { transform: translateY(-50%); } }
.badge {
  position: absolute; right: 24px; bottom: 24px; padding: 14px 18px; border-radius: 16px;
  background: var(--gold); color: #121212; font-weight: 700; line-height: 1.2; transform: rotate(-4deg);
}

.section { padding: 60px 5vw; }
.section-head { margin-bottom: 28px; }
.section-head.row { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.section h2 { font-size: clamp(1.8rem, 3.6vw, 2.6rem); }

.services { display: grid; grid-template-columns: repeat(2, 1fr); gap: 0 40px; }
.service {
  display: flex; justify-content: space-between; align-items: center; gap: 16px;
  padding: 20px 0; border-bottom: 1px solid var(--line);
}
.service h3 { font-size: 1.15rem; }
.service p { margin: 4px 0 0; color: var(--muted); font-size: 0.9rem; }
.price { font-family: Georgia, serif; font-size: 1.3rem; color: var(--gold); }

.team { display: grid; grid-template-columns: repeat(4, 1fr); gap: 18px; }
.barber { padding: 22px; border-radius: var(--radius); background: var(--panel); border: 1px solid var(--line); text-align: center; }
.avatar {
  width: 84px; height: 84px; margin: 0 auto 14px; border-radius: 50%;
  display: grid; place-items: center; font-weight: 700; font-size: 1.3rem; color: #121212;
  background: linear-gradient(135deg, hsl(var(--hue) 60% 70%), hsl(var(--hue) 50% 45%));
}
.barber p { margin: 4px 0 0; color: var(--muted); font-size: 0.85rem; }

.filters { display: flex; gap: 8px; }
.filter {
  padding: 7px 16px; border-radius: 999px; border: 1px solid var(--line);
  background: transparent; color: var(--muted); font-size: 0.85rem;
}
.filter.is-on { background: var(--ink); color: #121212; border-color: var(--ink); }

.products { display: grid; grid-template-columns: repeat(4, 1fr); gap: 18px; }
.product { border-radius: var(--radius); background: var(--panel); border: 1px solid var(--line); overflow: hidden; display: flex; flex-direction: column; }
.product-art { height: 170px; display: grid; place-items: center; background: var(--tile); }
.product-art svg { width: 64px; height: 64px; color: rgba(255, 255, 255, 0.9); }
.product-body { padding: 16px; display: flex; flex-direction: column; gap: 6px; flex: 1; }
.product-body h3 { font-size: 1.05rem; }
.product-body p { margin: 0; color: var(--muted); font-size: 0.85rem; flex: 1; }
.product-foot { display: flex; align-items: center; justify-content: space-between; margin-top: 10px; }
.product-foot .price { font-size: 1.15rem; }
.add {
  padding: 8px 14px; border-radius: 999px; border: 1px solid var(--gold);
  background: transparent; color: var(--gold); font-weight: 600; font-size: 0.82rem;
}
.add:hover { background: var(--gold); color: #121212; }

.book { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; align-items: start; }
.book-form {
  display: grid; gap: 14px; padding: 26px; border-radius: 22px;
  background: var(--panel); border: 1px solid var(--line);
}
.book-form label { display: grid; gap: 6px; font-size: 0.85rem; color: var(--muted); }
.book-form input, .book-form select {
  padding: 12px 14px; border-radius: 12px; border: 1px solid var(--line);
  background: var(--bg); color: var(--ink); font: inherit; color-scheme: dark;
}
.form-note { margin: 0; min-height: 1.2em; color: var(--gold); font-size: 0.88rem; }

.footer {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px;
  padding: 40px 5vw 60px; border-top: 1px solid var(--line); color: var(--muted); font-size: 0.9rem;
}
.footer h3 { color: var(--ink); font-size: 1rem; margin-bottom: 8px; }
.footer p { margin: 0; }

.cart {
  position: fixed; top: 0; right: 0; bottom: 0; z-index: 30; width: min(380px, 100%);
  display: flex; flex-direction: column; background: var(--panel); border-left: 1px solid var(--line);
  transform: translateX(100%); transition: transform 0.3s ease;
}
.cart.open { transform: none; }
.cart-head { display: flex; align-items: center; justify-content: space-between; padding: 20px; border-bottom: 1px solid var(--line); }
.icon-btn { width: 34px; height: 34px; border-radius: 50%; border: 1px solid var(--line); background: transparent; color: var(--ink); font-size: 1.2rem; }
.cart-items { flex: 1; overflow: auto; padding: 8px 20px; }
.cart-empty { color: var(--muted); text-align: center; margin-top: 40px; }
.cart-line { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 14px 0; border-bottom: 1px solid var(--line); }
.cart-line small { display: block; color: var(--muted); }
.qty { display: flex; align-items: center; gap: 8px; }
.qty button { width: 26px; height: 26px; border-radius: 50%; border: 1px solid var(--line); background: transparent; color: var(--ink); }
.cart-foot { padding: 20px; border-top: 1px solid var(--line); display: grid; gap: 14px; }
.cart-total { display: flex; justify-content: space-between; font-size: 1.05rem; }
.scrim { position: fixed; inset: 0; z-index: 20; background: rgba(0, 0, 0, 0.5); opacity: 0; pointer-events: none; transition: opacity 0.3s; }
.scrim.open { opacity: 1; pointer-events: auto; }

.toast {
  position: fixed; left: 50%; bottom: 24px; z-index: 40; padding: 10px 18px; border-radius: 999px;
  background: var(--ink); color: #121212; font-weight: 600; font-size: 0.88rem;
  transform: translate(-50%, 80px); transition: transform 0.3s ease;
}
.toast.show { transform: translate(-50%, 0); }

@media (max-width: 860px) {
  .links { display: none; }
  .hero, .book { grid-template-columns: 1fr; }
  .hero { padding-top: 40px; }
  .hero-art { height: 260px; }
  .pole { height: 190px; width: 56px; }
  .services { grid-template-columns: 1fr; }
  .team, .products { grid-template-columns: repeat(2, 1fr); }
  .footer { grid-template-columns: 1fr; }
}
@media (max-width: 480px) {
  .nav-actions .btn { display: none; }
  .stats { gap: 22px; }
}
`;

const APP_JS = `const PRODUCTS = [
  { id: 1, name: "Matte Clay", note: "Strong hold, no shine", price: 22, type: "hair", tile: "#3b3326", icon: "jar" },
  { id: 2, name: "Sea Salt Spray", note: "Texture and volume", price: 18, type: "hair", tile: "#24333b", icon: "bottle" },
  { id: 3, name: "Beard Oil", note: "Cedar and bergamot", price: 24, type: "beard", tile: "#3b2a24", icon: "drop" },
  { id: 4, name: "Beard Balm", note: "Tames and conditions", price: 20, type: "beard", tile: "#2f3b24", icon: "jar" },
  { id: 5, name: "Boar Bristle Brush", note: "Hand-finished beech", price: 28, type: "tools", tile: "#33263b", icon: "brush" },
  { id: 6, name: "Pocket Comb", note: "Saw-cut acetate", price: 12, type: "tools", tile: "#3b3524", icon: "comb" },
  { id: 7, name: "Daily Shampoo", note: "Gentle, every day", price: 19, type: "hair", tile: "#24363b", icon: "bottle" },
  { id: 8, name: "Safety Razor", note: "Chrome, weighted", price: 45, type: "tools", tile: "#2b2b2b", icon: "razor" },
];

const ICONS = {
  jar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="5" y="9" width="14" height="11" rx="3"/><rect x="6" y="5" width="12" height="4" rx="1.5"/></svg>',
  bottle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M10 3h4v3l2 3v10a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2V9l2-3V3z"/><path d="M8 13h8"/></svg>',
  drop: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/></svg>',
  brush: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="4" y="9" width="16" height="6" rx="3"/><path d="M7 15v3M10 15v4M13 15v4M16 15v3"/></svg>',
  comb: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="7" width="18" height="4" rx="1.5"/><path d="M5 11v6M8 11v6M11 11v6M14 11v6M17 11v6M20 11v6"/></svg>',
  razor: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="5" y="4" width="14" height="5" rx="1.5"/><path d="M12 9v11"/><circle cx="12" cy="20" r="1"/></svg>',
};

const cart = new Map();
const $ = (id) => document.getElementById(id);

function renderProducts(filter = "all") {
  $("products").innerHTML = PRODUCTS.filter((p) => filter === "all" || p.type === filter)
    .map((p) => \`
      <article class="product">
        <div class="product-art" style="--tile: \${p.tile}">\${ICONS[p.icon]}</div>
        <div class="product-body">
          <h3>\${p.name}</h3>
          <p>\${p.note}</p>
          <div class="product-foot">
            <span class="price">$\${p.price}</span>
            <button class="add" data-id="\${p.id}">Add to cart</button>
          </div>
        </div>
      </article>\`)
    .join("");
}

function renderCart() {
  const lines = [...cart.entries()].map(([id, qty]) => ({ ...PRODUCTS.find((p) => p.id === id), qty }));
  $("cartCount").textContent = lines.reduce((n, l) => n + l.qty, 0);
  $("cartTotal").textContent = "$" + lines.reduce((n, l) => n + l.qty * l.price, 0).toFixed(2);
  $("cartItems").innerHTML = lines.length
    ? lines.map((l) => \`
        <div class="cart-line">
          <div>\${l.name}<small>$\${l.price} each</small></div>
          <div class="qty">
            <button data-step="-1" data-id="\${l.id}">-</button>
            <span>\${l.qty}</span>
            <button data-step="1" data-id="\${l.id}">+</button>
          </div>
        </div>\`).join("")
    : '<p class="cart-empty">Your cart is empty.</p>';
}

function toast(text) {
  const el = $("toast");
  el.textContent = text;
  el.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("show"), 1800);
}

function setCart(open) {
  $("cart").classList.toggle("open", open);
  $("scrim").classList.toggle("open", open);
}

$("products").addEventListener("click", (e) => {
  const btn = e.target.closest(".add");
  if (!btn) return;
  const id = Number(btn.dataset.id);
  cart.set(id, (cart.get(id) || 0) + 1);
  renderCart();
  toast("Added " + PRODUCTS.find((p) => p.id === id).name);
});

$("cartItems").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-step]");
  if (!btn) return;
  const id = Number(btn.dataset.id);
  const qty = (cart.get(id) || 0) + Number(btn.dataset.step);
  qty > 0 ? cart.set(id, qty) : cart.delete(id);
  renderCart();
});

$("filters").addEventListener("click", (e) => {
  const btn = e.target.closest(".filter");
  if (!btn) return;
  document.querySelectorAll(".filter").forEach((b) => b.classList.toggle("is-on", b === btn));
  renderProducts(btn.dataset.filter);
});

$("cartBtn").addEventListener("click", () => setCart(true));
$("cartClose").addEventListener("click", () => setCart(false));
$("scrim").addEventListener("click", () => setCart(false));
$("checkout").addEventListener("click", () => {
  if (!cart.size) return toast("Add something first");
  cart.clear();
  renderCart();
  setCart(false);
  toast("Order placed. See you soon!");
});

$("bookForm").addEventListener("submit", (e) => {
  e.preventDefault();
  $("bookNote").textContent = "Request sent. We'll text you to confirm.";
  e.target.reset();
});

renderProducts();
renderCart();
`;

export const SAMPLE_PROJECT = {
  name: "Fade & Co. Barbers",
  files: [
    { path: "index.html", content: INDEX_HTML },
    { path: "style.css", content: STYLE_CSS },
    { path: "app.js", content: APP_JS },
  ] as ProjectFile[],
};

// The conversation that built it and its versions: a script, since the studio is a design preview
export interface StudioMessage {
  role: "user" | "assistant";
  text: string;
  changes?: { verb: "Created" | "Edited"; path: string }[];
  version?: number;
}

export const SCRIPT: StudioMessage[] = [
  { role: "user", text: "Build a website for a barber shop called Fade & Co., with a small online store." },
  {
    role: "assistant",
    text: "Done. The home page has your services and prices, the team, and a shop with filters and a working cart.",
    changes: [
      { verb: "Created", path: "index.html" },
      { verb: "Created", path: "style.css" },
      { verb: "Created", path: "app.js" },
    ],
    version: 1,
  },
  { role: "user", text: "Make it darker and more premium, with gold accents." },
  {
    role: "assistant",
    text: "Switched to charcoal and gold, with a serif for the headings and a spinning barber pole in the hero.",
    changes: [{ verb: "Edited", path: "style.css" }],
    version: 2,
  },
  { role: "user", text: "Add a booking form and a Book now button in the header." },
  {
    role: "assistant",
    text: "Added a booking section with name, service and day, and a Book now button that jumps to it.",
    changes: [
      { verb: "Edited", path: "index.html" },
      { verb: "Edited", path: "app.js" },
    ],
    version: 3,
  },
];

export const VERSIONS = [
  { n: 3, label: "Booking form and Book now button", when: "Just now" },
  { n: 2, label: "Charcoal and gold restyle", when: "4 min ago" },
  { n: 1, label: "First build", when: "9 min ago" },
];

export const LATEST = VERSIONS[0].n;
