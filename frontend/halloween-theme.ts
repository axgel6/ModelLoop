// Halloween is Frost's layout in its own palette. The page sets data-theme="frost" (so every
// Frost rule for layout, glass and contrast applies) and data-festive="halloween". As the CSS is
// built, this PostCSS step follows each rule that targets Frost with a copy of its colours,
// recoloured into the Halloween palette and scoped to data-festive="halloween" at the same
// specificity. Because each copy sits right after its Frost rule, it wins and loses against every
// other rule exactly as Frost does: whatever later replaces a Frost style (the progressive-blur
// top bar, say) replaces Halloween's too. Nothing here can match outside the Halloween theme.

const FROST = '[data-theme="frost"]';
// :where() adds nothing to specificity, so each copy weighs exactly what its Frost rule does
const SCOPED = '[data-theme="frost"]:where([data-festive="halloween"])';

// Nord's own colours, placed by hand; everything else goes through recolour() below
const EXACT: Record<string, string> = {
  "2e3440": "0b1024", // page: midnight navy
  "3b4252": "161b30", // cards and bubbles
  "434c5e": "1f2540", // hover
  "4c566a": "2c3250", // borders
  "d8dee9": "e8dfd0", // body text: moonlit parchment
  "e5e9f0": "efe6d6",
  "eceff4": "f4e9d6", // headings
  "88c0d0": "e6a96b", // accent: moon amber
  "8fbcbb": "e0b07a",
  "81a1c1": "8f86c9", // dusk violet
  "5e81ac": "6f66b0",
  "bf616a": "c9555f", // red
  "d08770": "d9772b", // pumpkin
  "ebcb8b": "e8c27a",
  "a3be8c": "8fb573", // moss
  "b48ead": "a585c9",
};

type RGB = [number, number, number];

function toHsl([r, g, b]: RGB): [number, number, number] {
  const [rr, gg, bb] = [r / 255, g / 255, b / 255];
  const max = Math.max(rr, gg, bb), min = Math.min(rr, gg, bb);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === rr ? (gg - bb) / d + (gg < bb ? 6 : 0) : max === gg ? (bb - rr) / d + 2 : (rr - gg) / d + 4;
  return [h * 60, s, l];
}

function fromHsl(h: number, s: number, l: number): RGB {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

/** Moves a Frost colour into the Halloween palette by its hue, saturation and lightness */
function recolour(rgb: RGB): RGB {
  const key = rgb.map((c) => c.toString(16).padStart(2, "0")).join("");
  if (EXACT[key]) return [0, 2, 4].map((i) => parseInt(EXACT[key].slice(i, i + 2), 16)) as RGB;
  const [deg, s, l] = toHsl(rgb);
  // Black shadows and white highlights stay as they are
  if (l <= 0.03 || l >= 0.97) return rgb;
  if (s < 0.22) {
    // Greys: the dark ones (surfaces) become navy a step deeper, the middle ones (muted text)
    // a cool slate, the light ones parchment
    if (l < 0.38) return fromHsl(230, 0.38, l < 0.32 ? l * 0.62 : l - 0.12);
    if (l < 0.7) return fromHsl(231, 0.14, l);
    return fromHsl(38, 0.38, l);
  }
  if (deg >= 170 && deg < 200) return fromHsl(30, 0.72, l); // Frost's cyan accent becomes the moon's amber
  if (deg >= 200 && deg < 260) return fromHsl(248, 0.38, l); // blues become dusk violet
  if (deg >= 260 && deg < 330) return fromHsl(265, s, l);
  if (deg >= 20 && deg < 35) return fromHsl(26, Math.max(s, 0.65), l); // oranges become pumpkin
  if (deg >= 60 && deg < 170) return fromHsl(95, Math.min(s, 0.33), l); // greens become moss
  return rgb; // reds and yellows keep their hue
}

const HEX = /#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/g;
const RGB_FN = /\b(rgba?)\(([^()]*)\)/g;

function recolourValue(value: string): string {
  return value
    .replace(HEX, (_, raw: string) => {
      const full = raw.length <= 4 ? [...raw].map((c) => c + c).join("") : raw;
      const rgb = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as RGB;
      return "#" + recolour(rgb).map((c) => c.toString(16).padStart(2, "0")).join("") + full.slice(6);
    })
    .replace(RGB_FN, (whole, fn: string, args: string) => {
      const parts = args.split(",").map((p) => p.trim());
      if (parts.length < 3) return whole;
      const [r, g, b] = recolour(parts.slice(0, 3).map((p) => Math.trunc(parseFloat(p))) as RGB);
      return `${fn}(${[r, g, b, ...parts.slice(3)].join(", ")})`;
    });
}

const hasColour = (value: string) => new RegExp(HEX.source).test(value) || new RegExp(RGB_FN.source).test(value);

// Just the parts of PostCSS's node types used here, so this needs no import from it
interface CssNode {
  type: string;
  remove(): void;
}
interface CssDecl extends CssNode {
  prop: string;
  value: string;
}
interface CssRule extends CssNode {
  selectors: string[];
  nodes: CssNode[];
  cloneAfter(overrides: { selectors: string[] }): CssRule;
}
interface CssRoot {
  walkRules(callback: (rule: CssRule) => void): void;
}

export function halloweenTheme() {
  return {
    postcssPlugin: "halloween-theme",
    Once(root: CssRoot) {
      const frostRules: CssRule[] = [];
      root.walkRules((rule) => {
        if (rule.selectors.some((s) => s.includes(FROST))) frostRules.push(rule);
      });
      for (const rule of frostRules) {
        // A selector list can name several themes; only Frost's are copied
        const selectors = rule.selectors.filter((s) => s.includes(FROST)).map((s) => s.split(FROST).join(SCOPED));
        const copy = rule.cloneAfter({ selectors });
        for (const node of [...copy.nodes]) {
          const decl = node as CssDecl;
          if (node.type !== "decl" || !hasColour(decl.value)) node.remove();
          else decl.value = recolourValue(decl.value);
        }
        if (copy.nodes.length === 0) copy.remove();
      }
    },
  };
}
