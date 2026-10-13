// The ModelLoop wordmark. It can be grabbed and stretched: see stretchy.ts,
// which picks it up by its class name.

export function StretchyLogo({ text = "ModelLoop" }: { text?: string }) {
  return <span className="stretchy-logo">{text}</span>;
}
