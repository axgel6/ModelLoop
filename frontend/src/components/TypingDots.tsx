/**
 * Three dots that rise and brighten in turn, like a messaging app's "typing" bubble: shown while
 * Olly thinks before replying, and while a Marketplace seller types. Matte, in the theme's muted
 * text color. They focus in like a reply's words, and hold still with reduced motion.
 * `label` is what a screen reader hears ("Olly is thinking", "Dana is typing").
 */
export function TypingDots({ label }: { label: string }) {
  return (
    <span className="typing-dots" role="status" aria-label={label}>
      <i aria-hidden="true" />
      <i aria-hidden="true" />
      <i aria-hidden="true" />
    </span>
  );
}
