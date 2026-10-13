// Calm sound feedback: short, soft tones synthesised with Web Audio, so there are
// no audio files to load. Every note comes from one pentatonic scale, which is why
// any two sounds overlapping still sound pleasant together.

export type SoundName = "tick" | "pop" | "send" | "done" | "warn" | "stop" | "sparkle";

const STORAGE_KEY = "sound_fx";
const VOLUME_KEY = "sound_volume";
// The slider's starting point. The note volumes below were tuned at this setting,
// so the master gain is the chosen volume relative to it.
const DEFAULT_VOLUME = 0.6;

const C4 = 261.63, D4 = 293.66, E4 = 329.63, G4 = 392.0, A4 = 440.0;
const C5 = 523.25, E5 = 659.25, G5 = 783.99, A5 = 880.0;
const C6 = 1046.5, E6 = 1318.51;

// [frequency, delay in seconds, length in seconds, volume]
type Note = [number, number, number, number];

const SOUNDS: Record<SoundName, Note[]> = {
  tick: [[A5, 0, 0.07, 0.05]],
  pop: [[C5, 0, 0.12, 0.06], [G5, 0.045, 0.14, 0.06]],
  send: [[E5, 0, 0.2, 0.07], [G5, 0.07, 0.2, 0.07], [C6, 0.14, 0.3, 0.07]],
  done: [[G5, 0, 0.45, 0.06], [C6, 0.11, 0.5, 0.06], [E6, 0.22, 0.7, 0.05]],
  warn: [[E4, 0, 0.26, 0.07], [C4, 0.12, 0.36, 0.07]],
  stop: [[G4, 0, 0.18, 0.06]],
  // Two low, soft notes stepping up: a small "bloop" for clicks on empty space
  sparkle: [[E4, 0, 0.1, 0.045], [A4, 0.07, 0.2, 0.04]],
};

// The "voice" a reply is spoken in while it streams: low notes, picked at random.
const BABBLE_NOTES = [C4, D4, E4, G4, A4];
const BABBLE_GAP_MS = 85;

class SoundManager {
  private ctx: AudioContext | null = null;
  private out: AudioNode | null = null;
  private master: GainNode | null = null;
  private lastName: SoundName | null = null;
  private lastAt = 0;
  private lastBabble = 0;

  // On until the user turns it off; their choice is remembered in this browser.
  isEnabled(): boolean {
    return localStorage.getItem(STORAGE_KEY) !== "off";
  }

  setEnabled(on: boolean) {
    localStorage.setItem(STORAGE_KEY, on ? "on" : "off");
  }

  // 0 to 1, remembered in this browser.
  getVolume(): number {
    const stored = parseFloat(localStorage.getItem(VOLUME_KEY) ?? "");
    return Number.isFinite(stored) ? Math.min(1, Math.max(0, stored)) : DEFAULT_VOLUME;
  }

  setVolume(volume: number) {
    const clamped = Math.min(1, Math.max(0, volume));
    localStorage.setItem(VOLUME_KEY, String(clamped));
    if (this.master) this.master.gain.value = clamped / DEFAULT_VOLUME;
  }

  play(name: SoundName) {
    if (!this.isEnabled()) return;
    // One click can reach here twice (a global handler plus a local one).
    const now = performance.now();
    if (name === this.lastName && now - this.lastAt < 60) return;
    this.lastName = name;
    this.lastAt = now;

    try {
      this.ready();
      for (const note of SOUNDS[name]) this.note(...note);
    } catch {
      // No audio available (or blocked before a user gesture): stay silent.
    }
  }

  // Call once per streamed token. Tokens arrive far faster than this should sound,
  // so it voices at most one very quiet blip every BABBLE_GAP_MS.
  babble() {
    if (!this.isEnabled()) return;
    const now = performance.now();
    if (now - this.lastBabble < BABBLE_GAP_MS) return;
    this.lastBabble = now;
    try {
      this.ready();
      const base = BABBLE_NOTES[Math.floor(Math.random() * BABBLE_NOTES.length)];
      this.note(base * (0.97 + Math.random() * 0.06), 0, 0.07, 0.022);
    } catch {
      // stay silent
    }
  }

  private ready() {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      // A gentle low-pass takes the edge off the top notes.
      const filter = this.ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 3200;
      this.master = this.ctx.createGain();
      this.master.gain.value = this.getVolume() / DEFAULT_VOLUME;
      filter.connect(this.master).connect(this.ctx.destination);
      this.out = filter;
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  // A sine with a quiet octave above it, struck quickly and left to ring out.
  private note(freq: number, delay: number, length: number, volume: number) {
    const ctx = this.ctx!;
    const start = ctx.currentTime + delay;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
    gain.connect(this.out!);

    for (const [multiple, level] of [[1, 1], [2, 0.22]]) {
      const osc = ctx.createOscillator();
      const partial = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq * multiple;
      partial.gain.value = level;
      osc.connect(partial).connect(gain);
      osc.start(start);
      osc.stop(start + length + 0.05);
    }
  }
}

export const sounds = new SoundManager();
