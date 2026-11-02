import { vi } from "vitest";

// jsdom has no speech engine or speech recognition, so tests install these fakes. The fake
// engine records what it was asked to say; the fake recogniser lets a test drive its events.

export const fakeVoice = (name: string, lang = "en-US", localService = true) =>
  ({ name, lang, voiceURI: `uri:${name}:${lang}`, localService, default: false }) as SpeechSynthesisVoice;

export class FakeUtterance {
  text: string;
  voice: SpeechSynthesisVoice | null = null;
  lang = "";
  rate = 1;
  pitch = 1;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onboundary: ((e: { name: string }) => void) | null = null;
  constructor(text: string) {
    this.text = text;
  }
}

export function installFakeSpeech(voices: SpeechSynthesisVoice[] = []) {
  const listeners = new Set<() => void>();
  const synth = {
    voices,
    spoken: [] as FakeUtterance[],
    getVoices: () => synth.voices,
    speak: vi.fn((u: FakeUtterance) => synth.spoken.push(u)),
    cancel: vi.fn(),
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
    /** Replace the voice list and tell listeners, as a browser does once voices load */
    setVoices(next: SpeechSynthesisVoice[]) {
      synth.voices = next;
      listeners.forEach((fn) => fn());
    },
  };
  Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true });
  vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
  return synth;
}

export class FakeRecognition {
  static instances: FakeRecognition[] = [];
  continuous = false;
  interimResults = false;
  lang = "";
  started = false;
  aborted = false;
  onstart: (() => void) | null = null;
  onresult: ((e: unknown) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onend: (() => void) | null = null;
  constructor() {
    FakeRecognition.instances.push(this);
  }
  start() {
    this.started = true;
  }
  abort() {
    this.aborted = true;
  }
  stop() {}
  /** The user said `text` and stopped talking */
  hear(text: string) {
    this.onresult?.({ results: [Object.assign([{ transcript: text }], { isFinal: true })] });
    this.onend?.();
  }
}

export function installFakeRecognition() {
  FakeRecognition.instances = [];
  vi.stubGlobal("SpeechRecognition", FakeRecognition);
  return FakeRecognition;
}
