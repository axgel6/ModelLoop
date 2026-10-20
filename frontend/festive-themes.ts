// Festive themes' colours (see src/festive.ts for the rest of each one). A festive theme is its
// base theme's layout in its own palette: the page sets data-theme="<base>" (so every one of the
// base's rules for layout, glass and contrast applies) and data-festive="<id>". As the CSS is
// built, this PostCSS step follows each rule that targets the base theme with a copy of its
// colours, recoloured into the festive palette and scoped to data-festive="<id>" at the same
// specificity. Because each copy sits right after its base rule, it wins and loses against every
// other rule exactly as the base does: whatever later replaces a base style (the progressive-blur
// top bar, say) replaces the festive one too. Nothing here can match outside its festive theme.
//
// To add a palette: an entry in PALETTES with the base theme's own colours placed by hand in
// `exact`, and a `recolour` that moves every other colour across by hue, saturation and lightness.

type RGB = [number, number, number];

interface Palette {
  /** The festive theme's id, as in src/festive.ts and data-festive */
  id: string;
  /** The everyday theme it is built from, as in data-theme */
  base: string;
  /** The base theme's own colours (six-digit hex, no #) and what each becomes */
  exact: Record<string, string>;
  /** Everything else, by hue (degrees), saturation and lightness (0 to 1) */
  recolour: (h: number, s: number, l: number, rgb: RGB) => RGB;
}

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

const PALETTES: Palette[] = [
  {
    // Halloween: plum-black, pumpkin and witch violet, from Frost
    id: "halloween",
    base: "frost",
    // Nord's own colours, placed by hand
    exact: {
      "2e3440": "150d1c", // page: plum-black
      "3b4252": "211530", // cards and bubbles
      "434c5e": "2b1c3b", // hover
      "4c566a": "3d2a4f", // borders
      "d8dee9": "ece0cc", // body text: old bone
      "e5e9f0": "f1e6d2",
      "eceff4": "f6ead6", // headings
      "88c0d0": "f27a24", // accent: pumpkin
      "8fbcbb": "f59a45",
      "81a1c1": "9d6fd6", // witch violet
      "5e81ac": "7a4fb8",
      "bf616a": "d9434e", // blood red
      "d08770": "ff7518", // jack-o'-lantern
      "ebcb8b": "f0c060", // candle flame
      "a3be8c": "9bd14a", // slime
      "b48ead": "b07ad6",
    },
    recolour: (deg, s, l, rgb) => {
      if (s < 0.22) {
        // Greys: the dark ones (surfaces) become plum-black a step deeper, the middle ones (muted
        // text) a dusty mauve, the light ones old bone
        if (l < 0.38) return fromHsl(282, 0.34, l < 0.32 ? l * 0.6 : l - 0.12);
        if (l < 0.7) return fromHsl(285, 0.1, l);
        return fromHsl(38, 0.38, l);
      }
      // Frost's cyan accent becomes pumpkin, a little deeper so it reads as orange, not apricot
      if (deg >= 170 && deg < 200) return fromHsl(24, 0.92, Math.min(l * 0.85, 0.62));
      if (deg >= 200 && deg < 260) return fromHsl(272, 0.45, l); // blues become witch violet
      if (deg >= 260 && deg < 330) return fromHsl(280, s, l);
      if (deg >= 20 && deg < 35) return fromHsl(24, Math.max(s, 0.85), l); // oranges become pumpkin
      if (deg >= 60 && deg < 170) return fromHsl(85, Math.min(Math.max(s, 0.4), 0.6), l); // greens become slime
      return rgb; // reds and yellows keep their hue
    },
  },
];

/** Moves a base theme colour into a festive palette */
function recolour(palette: Palette, rgb: RGB): RGB {
  const key = rgb.map((c) => c.toString(16).padStart(2, "0")).join("");
  const exact = palette.exact[key];
  if (exact) return [0, 2, 4].map((i) => parseInt(exact.slice(i, i + 2), 16)) as RGB;
  const [deg, s, l] = toHsl(rgb);
  // Black shadows and white highlights stay as they are
  if (l <= 0.03 || l >= 0.97) return rgb;
  return palette.recolour(deg, s, l, rgb);
}

const HEX = /#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/g;
const RGB_FN = /\b(rgba?)\(([^()]*)\)/g;

function recolourValue(palette: Palette, value: string): string {
  return value
    .replace(HEX, (_, raw: string) => {
      const full = raw.length <= 4 ? [...raw].map((c) => c + c).join("") : raw;
      const rgb = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as RGB;
      return "#" + recolour(palette, rgb).map((c) => c.toString(16).padStart(2, "0")).join("") + full.slice(6);
    })
    .replace(RGB_FN, (whole, fn: string, args: string) => {
      const parts = args.split(",").map((p) => p.trim());
      if (parts.length < 3) return whole;
      const [r, g, b] = recolour(palette, parts.slice(0, 3).map((p) => Math.trunc(parseFloat(p))) as RGB);
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

export function festiveThemes() {
  return {
    postcssPlugin: "festive-themes",
    Once(root: CssRoot) {
      for (const palette of PALETTES) {
        const base = `[data-theme="${palette.base}"]`;
        // :where() adds nothing to specificity, so each copy weighs exactly what its base rule does
        const scoped = `${base}:where([data-festive="${palette.id}"])`;
        // A rule written for (or copied into) a festive theme names the base too, but is never copied
        const isBase = (s: string) => s.includes(base) && !s.includes("data-festive");
        const baseRules: CssRule[] = [];
        root.walkRules((rule) => {
          if (rule.selectors.some(isBase)) baseRules.push(rule);
        });
        for (const rule of baseRules) {
          // A selector list can name several themes; only the base's are copied
          const selectors = rule.selectors.filter(isBase).map((s) => s.split(base).join(scoped));
          const copy = rule.cloneAfter({ selectors });
          for (const node of [...copy.nodes]) {
            const decl = node as CssDecl;
            if (node.type !== "decl" || !hasColour(decl.value)) node.remove();
            else decl.value = recolourValue(palette, decl.value);
          }
          if (copy.nodes.length === 0) copy.remove();
        }
      }
    },
  };
}
