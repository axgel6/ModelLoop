// Faces for the people of the Marketplace, drawn from a seed so the same person always looks the same.
// Notionists by Zoish, via DiceBear; the artwork is CC0 1.0.
import { createAvatar } from "@dicebear/core";
import * as notionists from "@dicebear/notionists";
import { useMemo } from "react";

// Each face gets one of these behind it, picked by its seed
const PASTELS = ["b6e3f4", "c0aede", "d1d4f9", "ffd5dc", "ffdfbf", "c7ecd4", "f4e3b6"];

// Drawn once per seed for the life of the page: the same face appears in lists, headers and every bubble
const drawn = new Map<string, string>();

function faceFor(seed: string): string {
  let uri = drawn.get(seed);
  if (!uri) {
    // Black line art on a soft pastel circle, so it reads on light and dark themes alike
    uri = createAvatar(notionists, { seed, size: 96, backgroundColor: PASTELS, backgroundType: ["solid"] }).toDataUri();
    drawn.set(seed, uri);
  }
  return uri;
}

/** A round face. `size` is in pixels; the circle and its background come from the stylesheet. */
export function Avatar({ seed, size = 38, className = "" }: { seed: string; size?: number; className?: string }) {
  const uri = useMemo(() => faceFor(seed), [seed]);
  return (
    <img
      className={`neg-avatar ${className}`.trim()}
      src={uri}
      alt=""
      width={size}
      height={size}
      style={{ width: size, height: size }}
      draggable={false}
    />
  );
}
