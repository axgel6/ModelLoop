import { useEffect, useState } from "react";

// The voice Olly speaks with. One choice, used everywhere something is read aloud: voice mode,
// a message's Listen button and focused mode's read-aloud. The user can pick it in Preferences;
// otherwise (or if the picked voice isn't on this device) the best available one is chosen.
// Saved per browser, because the voices on offer depend on the device.

const STORAGE_KEY = "voice_name";
const CHANGED_EVENT = "olly-voice-changed";

// Ordered by quality: macOS premium > Microsoft Neural > Google Neural > generic online
export const VOICE_PRIORITY = [
  "Samantha", "Alex",                                                  // macOS premium
  "Microsoft Aria Online", "Microsoft Jenny Online",                   // Edge Neural
  "Microsoft Guy Online", "Microsoft Ava Online",                      // Edge Neural
  "Microsoft Emma Online", "Microsoft Brian Online",                   // Edge Neural
  "Google US English", "Google UK English Female",                     // Chrome Neural
  "Google UK English Male", "Google Australia English",                // Chrome Neural
];

const userLang = () => navigator.language || "en-US";

function voicesFor(lang: string): SpeechSynthesisVoice[] {
  const base = lang.split("-")[0];
  return window.speechSynthesis.getVoices().filter((v) => v.lang.startsWith(base));
}

/** The automatic pick, used when nothing is chosen */
export function automaticVoice(lang = userLang()): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;
  const langVoices = voicesFor(lang);
  if (!langVoices.length) return voices[0] ?? null;

  for (const name of VOICE_PRIORITY) {
    const match = langVoices.find((v) => v.name.includes(name));
    if (match) return match;
  }
  return (
    langVoices.find((v) => v.name.toLowerCase().includes("natural")) ??
    langVoices.find((v) => v.name.toLowerCase().includes("neural")) ??
    langVoices.find((v) => !v.localService) ??
    langVoices[0] ??
    null
  );
}

type VoiceQuality = "premium" | "enhanced" | "natural" | null;

/** How good a voice is likely to sound, from what its name and service say */
export function voiceQuality(voice: SpeechSynthesisVoice): VoiceQuality {
  const name = voice.name.toLowerCase();
  if (name.includes("premium")) return "premium";
  if (name.includes("enhanced")) return "enhanced";
  if (name.includes("neural") || name.includes("natural") || name.includes("online")) return "natural";
  return null;
}

const QUALITY_RANK: Record<string, number> = { premium: 0, enhanced: 1, natural: 2, null: 3 };

function readChoice(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

/** The voice to speak with: the user's choice when it's on this device, else the automatic pick */
export function chosenVoice(): SpeechSynthesisVoice | null {
  const uri = readChoice();
  if (uri) {
    const match = window.speechSynthesis.getVoices().find((v) => v.voiceURI === uri);
    if (match) return match;
  }
  return automaticVoice();
}

type SpeakOptions = { rate?: number; onEnd?: () => void };

/** Speak with the chosen voice. Cancels whatever is playing first. */
export function speakWithChosenVoice(text: string, options: SpeakOptions = {}) {
  return speakWithVoice(text, chosenVoice(), options);
}

/** Speak with a particular voice (for previews). Cancels whatever is playing first. */
export function speakWithVoice(
  text: string,
  voice: SpeechSynthesisVoice | null,
  { rate = 1, onEnd }: SpeakOptions = {},
): SpeechSynthesisUtterance {
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = voice?.lang || userLang();
  utterance.rate = rate;
  if (voice) utterance.voice = voice;
  utterance.onend = () => onEnd?.();
  utterance.onerror = () => onEnd?.();
  // cancel() then speak() straight away is dropped by Chrome, so defer a tick
  window.speechSynthesis.cancel();
  window.setTimeout(() => window.speechSynthesis.speak(utterance), 50);
  return utterance;
}

/** Calls back whenever the voice list loads or the user picks another voice */
export function onVoicesChanged(listener: () => void): () => void {
  window.speechSynthesis.addEventListener("voiceschanged", listener);
  window.addEventListener(CHANGED_EVENT, listener);
  return () => {
    window.speechSynthesis.removeEventListener("voiceschanged", listener);
    window.removeEventListener(CHANGED_EVENT, listener);
  };
}

// macOS's joke and retro voices: fun, but they bury the real ones, so the list keeps them folded
const NOVELTY = new Set([
  "albert", "bad news", "bahh", "bells", "boing", "bubbles", "cellos", "good news", "jester",
  "organ", "superstar", "trinoids", "whisper", "wobble", "zarvox", "junior", "ralph", "fred",
  "kathy", "deranged", "hysterical", "pipe organ",
]);

export function isNoveltyVoice(voice: SpeechSynthesisVoice): boolean {
  return NOVELTY.has(voiceLabel(voice).toLowerCase());
}

/** A voice's name without the quality tag, which the list shows as a badge instead */
export function voiceLabel(voice: SpeechSynthesisVoice): string {
  return voice.name.replace(/\s*\((premium|enhanced|natural)\)\s*$/i, "").trim();
}

/** Where the voice's accent is from, e.g. "United States", from its language tag */
export function voiceRegion(voice: SpeechSynthesisVoice): string {
  const region = voice.lang.split(/[-_]/)[1];
  if (!region) return voice.lang;
  try {
    return new Intl.DisplayNames([userLang()], { type: "region" }).of(region.toUpperCase()) ?? region;
  } catch {
    return region;
  }
}

/** Where to get better voices on this platform, or null where there's no simple answer */
export function betterVoicesTip(): string | null {
  const ua = navigator.userAgent;
  const touchMac = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  if (/iPhone|iPad|iPod/.test(ua) || touchMac)
    return "Get more natural voices in Settings → Accessibility → Spoken Content → Voices.";
  if (/Macintosh|Mac OS X/.test(ua))
    return "Get more natural voices in System Settings → Accessibility → Spoken Content → System voice → Manage Voices.";
  if (/Android/.test(ua))
    return "Get more natural voices in Settings → System → Languages → Text-to-speech.";
  if (/Windows/.test(ua))
    return "Microsoft Edge offers natural online voices, or add voices in Settings → Time & language → Speech.";
  return null;
}

/** For Preferences: the voices for the user's language, best first, and the current choice */
export function useVoiceChoice() {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(() => sortedVoices());
  const [choice, setChoiceState] = useState(readChoice);

  // Safari and Chrome load the list after the page does
  useEffect(() => onVoicesChanged(() => setVoices(sortedVoices())), []);

  const setChoice = (uri: string) => {
    try {
      if (uri) localStorage.setItem(STORAGE_KEY, uri);
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      // private mode: it lasts until the page closes
    }
    setChoiceState(uri);
    window.dispatchEvent(new Event(CHANGED_EVENT));
  };

  // The picked voice may be a duplicate the list folded away; show its twin as picked instead
  const picked = choice
    ? window.speechSynthesis.getVoices().find((v) => v.voiceURI === choice)
    : undefined;
  const listed = picked && voices.find((v) => sameVoice(v, picked));
  // "missing": a voice was picked on another device, or has since been removed
  const missing = !!choice && voices.length > 0 && !listed;
  return { voices, choice: listed ? listed.voiceURI : "", missing, setChoice };
}

// Browsers sometimes list one voice more than once under different ids (Safari does for some
// macOS voices); to the user they're the same voice, so the list shows each once
const sameVoice = (a: SpeechSynthesisVoice, b: SpeechSynthesisVoice) =>
  voiceLabel(a) === voiceLabel(b) && a.lang === b.lang && voiceQuality(a) === voiceQuality(b);

// Best first, then by name, with the novelty voices at the very end
function sortedVoices(): SpeechSynthesisVoice[] {
  if (typeof window === "undefined" || !window.speechSynthesis) return [];
  const sorted = voicesFor(userLang()).sort(
    (a, b) =>
      Number(isNoveltyVoice(a)) - Number(isNoveltyVoice(b)) ||
      QUALITY_RANK[String(voiceQuality(a))] - QUALITY_RANK[String(voiceQuality(b))] ||
      a.name.localeCompare(b.name),
  );
  return sorted.filter((v, i) => sorted.findIndex((w) => sameVoice(v, w)) === i);
}
