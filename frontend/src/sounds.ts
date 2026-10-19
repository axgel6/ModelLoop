// Calm sound feedback: short, soft tones synthesised with Web Audio, so there are
// no audio files to load. Every note comes from one pentatonic scale, which is why
// any two sounds overlapping still sound pleasant together.

export type SoundName = "tick" | "pop" | "send" | "done" | "warn" | "stop" | "sparkle" | "pay" | "lock" | "think" | "unthink" | "unlock" | "declined";

const STORAGE_KEY = "sound_fx";
const VOLUME_KEY = "sound_volume";

// While sound is on, each kind of sound has its own switch. Taps and replies start on;
// typing and hovering are extras, off until chosen.
export type SoundGroup = "clicks" | "replies" | "typing" | "hover";

export const SOUND_GROUPS: { id: SoundGroup; label: string; desc: string }[] = [
  { id: "clicks", label: "Taps and clicks", desc: "Buttons, toggles, sparkles and game moments." },
  { id: "replies", label: "Replies", desc: "Sending, the soft voice as a reply comes in, and its finish." },
  { id: "typing", label: "Typing", desc: "A soft tap for each key as you type." },
  { id: "hover", label: "Hovering", desc: "A low note when the pointer finds a button." },
];

const GROUP_KEYS: Record<SoundGroup, string> = {
  clicks: "sound_clicks",
  replies: "sound_replies",
  typing: "typing_sounds",
  hover: "sound_hover",
};

const GROUP_DEFAULTS: Record<SoundGroup, boolean> = {
  clicks: true,
  replies: true,
  typing: false,
  hover: false,
};

const GROUP_OF: Record<SoundName, SoundGroup> = {
  tick: "clicks", pop: "clicks", sparkle: "clicks", warn: "clicks",
  lock: "clicks", unlock: "clicks", think: "clicks", unthink: "clicks",
  pay: "clicks", declined: "clicks",
  send: "replies", done: "replies", stop: "replies",
};
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
  // Money changing hands: a quick "cha" of two coin ticks, then the "ching" ringing out
  pay: [
    [C6, 0, 0.07, 0.05], [E6, 0.06, 0.07, 0.05],
    [G5, 0.15, 0.6, 0.05], [C6, 0.15, 0.7, 0.05], [E6, 0.15, 0.8, 0.045],
  ],
  // A card turned down at the till: the same low note twice, flat and final
  declined: [[D4, 0, 0.1, 0.08], [D4, 0.15, 0.24, 0.08]],
  // Switching on: an unhurried low note, then a fifth up left to ring
  think: [[C5, 0, 0.22, 0.07], [G5, 0.24, 0.4, 0.07]],
  // Switching off: the same two notes the other way round, settling down
  unthink: [[G5, 0, 0.22, 0.07], [C5, 0.24, 0.4, 0.07]],
  // Only the low body of the bolt landing; the clicks themselves are in CLICKS
  lock: [[C4, 0.075, 0.07, 0.035]],
  unlock: [[C4, 0, 0.07, 0.035]],
};

// [centre frequency, delay in seconds, length in seconds, volume]
type Click = [number, number, number, number];

// Mechanical sounds are not notes: each click is a burst of noise narrowed to a pitch
// and cut off almost at once.
const CLICKS: Partial<Record<SoundName, Click[]>> = {
  // A lock turning shut: the latch snaps, then the heavier bolt drops into place
  lock: [[2600, 0, 0.022, 0.45], [1300, 0.075, 0.04, 0.6]],
  // The same lock opening: the bolt draws back first, then the latch springs free
  unlock: [[1300, 0, 0.04, 0.6], [2600, 0.075, 0.022, 0.45]],
};

// The "voice" a reply is spoken in while it streams: low notes, picked at random.
const BABBLE_NOTES = [C4, D4, E4, G4, A4];
const BABBLE_GAP_MS = 85;

// Every sound is played a few percent sharp or flat at random, so a sound heard over and over
// never comes out mechanically identical. Small enough that the pentatonic chords stay sweet.
const PITCH_SPREAD = 0.04;
const drift = () => 1 + (Math.random() * 2 - 1) * PITCH_SPREAD;

// Typing: a creamy "thock", like a well-damped keyboard. A wide, low band of noise for the key
// landing and a quick low thump under it, with nothing bright or clacky on top.
const KEY_BAND_HZ = 260;
const KEY_THUMP_HZ = 120;
const KEY_GAP_MS = 30;
// Hovering something you can press: a soft, low note eased in rather than struck, held back
// while the pointer sweeps
const HOVER_NOTES = [C4, D4, E4];
const HOVER_GAP_MS = 70;

class SoundManager {
  private ctx: AudioContext | null = null;
  private out: AudioNode | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private lastName: SoundName | null = null;
  private lastAt = 0;
  private lastBabble = 0;
  private lastKey = 0;
  private lastHover = 0;

  // Off until the user turns it on; their choice is remembered in this browser.
  isEnabled(): boolean {
    try {
      return localStorage.getItem(STORAGE_KEY) === "on";
    } catch {
      return false;
    }
  }

  setEnabled(on: boolean) {
    try {
      localStorage.setItem(STORAGE_KEY, on ? "on" : "off");
    } catch {
      // private mode: it lasts until the page closes
    }
  }

  // One kind of sound's own switch, as set in Preferences (see GROUP_DEFAULTS when unset)
  isGroupOn(group: SoundGroup): boolean {
    try {
      const stored = localStorage.getItem(GROUP_KEYS[group]);
      return stored === null ? GROUP_DEFAULTS[group] : stored === "on";
    } catch {
      return GROUP_DEFAULTS[group];
    }
  }

  setGroupOn(group: SoundGroup, on: boolean) {
    try {
      localStorage.setItem(GROUP_KEYS[group], on ? "on" : "off");
    } catch {
      // private mode: it lasts until the page closes
    }
  }

  // Whether a kind of sound is heard now: sound on, and that kind on
  private allows(group: SoundGroup): boolean {
    return this.isEnabled() && this.isGroupOn(group);
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
    if (!this.allows(GROUP_OF[name])) return;
    // One click can reach here twice (a global handler plus a local one).
    const now = performance.now();
    if (name === this.lastName && now - this.lastAt < 60) return;
    this.lastName = name;
    this.lastAt = now;

    try {
      this.ready();
      // One drift for the whole sound, so its notes keep their intervals
      const pitch = drift();
      for (const [freq, ...rest] of SOUNDS[name]) this.note(freq * pitch, ...rest);
      for (const [freq, ...rest] of CLICKS[name] ?? []) this.click(freq * pitch, ...rest);
    } catch {
      // No audio available (or blocked before a user gesture): stay silent.
    }
  }

  // Call once per streamed token. Tokens arrive far faster than this should sound,
  // so it voices at most one very quiet blip every BABBLE_GAP_MS.
  babble() {
    if (!this.allows("replies")) return;
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

  // Call on each key typed into a text field. Fast typing is thinned out, not queued.
  key() {
    if (!this.allows("typing")) return;
    const now = performance.now();
    if (now - this.lastKey < KEY_GAP_MS) return;
    this.lastKey = now;
    try {
      this.ready();
      // Both swell in over a few ms: a hard edge on the noise is what made it a typewriter
      this.click(KEY_BAND_HZ * drift(), 0, 0.05, 0.14, 0.7, 0.005);
      this.note(KEY_THUMP_HZ * drift(), 0, 0.07, 0.045, 0.006);
    } catch {
      // stay silent
    }
  }

  // Call when the pointer comes onto something pressable.
  hover() {
    // Browsers only allow audio after a press, so hovers stay silent until the first one has
    // started it, rather than starting it early and getting blocked
    if (!this.allows("hover") || !this.ctx) return;
    const now = performance.now();
    if (now - this.lastHover < HOVER_GAP_MS) return;
    this.lastHover = now;
    try {
      this.ready();
      this.note(HOVER_NOTES[Math.floor(Math.random() * HOVER_NOTES.length)] * drift(), 0, 0.16, 0.022, 0.03);
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

  // White noise through a band-pass (narrow by default), snapping on (or swelling in, given an
  // attack) and dying away within a few ms.
  private click(freq: number, delay: number, length: number, volume: number, q = 3, attack = 0) {
    const ctx = this.ctx!;
    if (!this.noise) {
      // A tenth of a second covers any click, and the buffer is reused for all of them
      this.noise = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 0.1), ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    const start = ctx.currentTime + delay;
    const source = ctx.createBufferSource();
    source.buffer = this.noise;
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = freq;
    band.Q.value = q;
    const gain = ctx.createGain();
    if (attack > 0) {
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(volume, start + attack);
    } else {
      gain.gain.setValueAtTime(volume, start);
    }
    gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
    source.connect(band).connect(gain).connect(this.out!);
    source.start(start);
    source.stop(start + length + 0.01);
  }

  // A sine with a quiet octave above it, struck quickly (or eased in, with a longer attack) and
  // left to ring out.
  private note(freq: number, delay: number, length: number, volume: number, attack = 0.012) {
    const ctx = this.ctx!;
    const start = ctx.currentTime + delay;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + attack);
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
