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

// Browser storage can be blocked (some private modes); then settings last until the page closes.
function load(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function save(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // blocked: the choice still holds for this visit
  }
}

const clampVolume = (v: number) => Math.min(1, Math.max(0, v));

class SoundManager {
  private ctx: AudioContext | null = null;
  private out: AudioNode | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  // When each kind of sound last played, for thinning out rapid repeats
  private lastAt = new Map<string, number>();

  // Settings are read from storage once and kept here, since some sounds are asked for on every
  // streamed token, keystroke or hover.
  private enabled = false;
  private groups = { ...GROUP_DEFAULTS };
  private volume = DEFAULT_VOLUME;

  constructor() {
    this.loadSettings();
    // Pick up a change made in another tab
    window.addEventListener("storage", () => this.loadSettings());
  }

  private loadSettings() {
    // Off until the user turns it on
    this.enabled = load(STORAGE_KEY) === "on";
    for (const group of Object.keys(GROUP_KEYS) as SoundGroup[]) {
      const stored = load(GROUP_KEYS[group]);
      this.groups[group] = stored === null ? GROUP_DEFAULTS[group] : stored === "on";
    }
    const volume = parseFloat(load(VOLUME_KEY) ?? "");
    this.volume = Number.isFinite(volume) ? clampVolume(volume) : DEFAULT_VOLUME;
    if (this.master) this.master.gain.value = this.volume / DEFAULT_VOLUME;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    save(STORAGE_KEY, on ? "on" : "off");
  }

  // One kind of sound's own switch, as set in Preferences (see GROUP_DEFAULTS when unset)
  isGroupOn(group: SoundGroup): boolean {
    return this.groups[group];
  }

  setGroupOn(group: SoundGroup, on: boolean) {
    this.groups[group] = on;
    save(GROUP_KEYS[group], on ? "on" : "off");
  }

  // 0 to 1
  getVolume(): number {
    return this.volume;
  }

  setVolume(volume: number) {
    this.volume = clampVolume(volume);
    save(VOLUME_KEY, String(this.volume));
    if (this.master) this.master.gain.value = this.volume / DEFAULT_VOLUME;
  }

  // Plays `voice` if its kind of sound is on and `id` has not played within `gapMs`.
  private emit(group: SoundGroup, id: string, gapMs: number, voice: () => void) {
    if (!this.enabled || !this.groups[group]) return;
    const now = performance.now();
    if (now - (this.lastAt.get(id) ?? -Infinity) < gapMs) return;
    this.lastAt.set(id, now);
    try {
      this.ready();
      voice();
    } catch {
      // No audio available (or blocked before a user gesture): stay silent
    }
  }

  play(name: SoundName) {
    // The short gap catches one click reaching here twice (a global handler plus a local one)
    this.emit(GROUP_OF[name], name, 60, () => {
      // One drift for the whole sound, so its notes keep their intervals
      const pitch = drift();
      for (const [freq, ...rest] of SOUNDS[name]) this.note(freq * pitch, ...rest);
      for (const [freq, ...rest] of CLICKS[name] ?? []) this.click(freq * pitch, ...rest);
    });
  }

  // Call once per streamed token. Tokens arrive far faster than this should sound,
  // so it voices at most one very quiet blip every BABBLE_GAP_MS.
  babble() {
    this.emit("replies", "babble", BABBLE_GAP_MS, () => {
      const base = BABBLE_NOTES[Math.floor(Math.random() * BABBLE_NOTES.length)];
      this.note(base * (0.97 + Math.random() * 0.06), 0, 0.07, 0.022);
    });
  }

  // Call on each key typed into a text field. Fast typing is thinned out, not queued.
  key() {
    this.emit("typing", "key", KEY_GAP_MS, () => {
      // Both swell in over a few ms: a hard edge on the noise is what made it a typewriter
      this.click(KEY_BAND_HZ * drift(), 0, 0.05, 0.14, 0.7, 0.005);
      this.note(KEY_THUMP_HZ * drift(), 0, 0.07, 0.045, 0.006);
    });
  }

  // Call when the pointer comes onto something pressable.
  hover() {
    // Browsers only allow audio after a press, so hovers stay silent until the first one has
    // started it, rather than starting it early and getting blocked
    if (!this.ctx) return;
    this.emit("hover", "hover", HOVER_GAP_MS, () => {
      this.note(HOVER_NOTES[Math.floor(Math.random() * HOVER_NOTES.length)] * drift(), 0, 0.16, 0.022, 0.03);
    });
  }

  private ready() {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      // A gentle low-pass takes the edge off the top notes.
      const filter = this.ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 3200;
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume / DEFAULT_VOLUME;
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
