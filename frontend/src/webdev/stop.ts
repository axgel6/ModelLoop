import { useSyncExternalStore } from "react";

// One switch for every preview on the page: the studio's, the card's thumbnail and the hidden
// check. Stopping takes each preview's frame off the page, and the browser then drops everything
// in it: its scripts, timers, sounds and memory. Previews stay stopped until Run is pressed.
let stopped = false;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function stopPreviews(): void {
  if (stopped) return;
  stopped = true;
  emit();
}

export function runPreviews(): void {
  if (!stopped) return;
  stopped = false;
  emit();
}

export function previewsStopped(): boolean {
  return stopped;
}

/** Calls `listener` whenever previews stop or run again; returns the unsubscribe */
export function onPreviewsChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePreviewsStopped(): boolean {
  return useSyncExternalStore(onPreviewsChange, previewsStopped);
}
