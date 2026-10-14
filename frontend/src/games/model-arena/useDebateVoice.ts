import { useCallback, useEffect, useRef, useState } from "react";
import { VOICE_PRIORITY } from "../../components/hooks/useVoiceConversation";
import type { ArenaSpeech, SideIndex } from "./types";

const READ_ALOUD_KEY = "arena_read_aloud";

function storedChoice(): boolean {
  try {
    return localStorage.getItem(READ_ALOUD_KEY) === "1";
  } catch {
    return false;
  }
}

// Pleasant system voices worth using for the second debater when none of the preferred ones are installed
const GOOD_VOICES = ["Daniel", "Karen", "Moira", "Tessa", "Rishi", "Aaron", "Nicky", "Ava", "Allison", "Susan", "Tom"];

// macOS ships joke voices (Albert, Bad News, Whisper) and raspy synthetic ones (Grandpa, Rocko)
// under English. They are never what anyone wants reading a debate.
const UNFIT_VOICES =
  /^(Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Deranged|Good News|Hysterical|Jester|Organ|Pipe Organ|Superstar|Trinoids|Whisper|Wobble|Zarvox|Junior|Ralph|Fred|Kathy|Princess|Bruce|Agnes|Vicki|Eddy|Flo|Grandma|Grandpa|Reed|Rocko|Sandy|Shelley)\b/i;

function rank(voice: SpeechSynthesisVoice): number {
  const preferred = VOICE_PRIORITY.findIndex((name) => voice.name.includes(name));
  if (preferred !== -1) return preferred;
  const good = GOOD_VOICES.findIndex((name) => voice.name.startsWith(name));
  if (good !== -1) return VOICE_PRIORITY.length + good;
  const rest = VOICE_PRIORITY.length + GOOD_VOICES.length;
  return /natural|neural|enhanced|premium/i.test(voice.name) ? rest : rest + 1;
}

/** The two best English voices this browser has, one per debater, so the sides can be told apart by ear. */
function voiceFor(side: SideIndex): { voice: SpeechSynthesisVoice | null; pitch: number } {
  const voices = window.speechSynthesis.getVoices();
  const english = voices.filter((v) => v.lang.startsWith("en") && !UNFIT_VOICES.test(v.name));
  const ranked = (english.length ? english : voices).slice().sort((a, b) => rank(a) - rank(b));
  const first = ranked[0] ?? null;
  const second = ranked.find((v) => v.name !== first?.name) ?? null;
  if (side === 0) return { voice: first, pitch: 1 };
  // With only one voice to go round, the second debater speaks a touch higher: lowering it turns gravelly.
  return second ? { voice: second, pitch: 1 } : { voice: first, pitch: 1.15 };
}

/** Sentence-sized pieces: some browsers cut off a single long utterance part way through. */
function sentences(text: string): string[] {
  const plain = text.replace(/[*_#`>]/g, "").replace(/\s+/g, " ").trim();
  return plain.match(/[^.!?]+[.!?]*\s*/g)?.map((s) => s.trim()).filter(Boolean) ?? [];
}

/**
 * Reads a debate aloud with the browser's speech engine, each side in its own voice.
 * With read aloud on, speeches are spoken in order as they arrive; any one speech
 * can also be played on its own. The pace is the Voice Speed set in Preferences.
 */
export function useDebateVoice(speeches: ArenaSpeech[], live: boolean) {
  const supported = typeof window !== "undefined" && "speechSynthesis" in window;
  // A debate reopened from the list stays quiet until asked; one in progress follows the last choice made.
  const [readAloud, setReadAloud] = useState(() => supported && live && storedChoice());
  const [speaking, setSpeaking] = useState<number | null>(null);
  // The next speech read aloud should pick up. Starts past the ones already on screen.
  const nextUp = useRef(speeches.length);
  // Bumped whenever speech is started or stopped, so a finished utterance knows if it is still current.
  const current = useRef(0);
  // Chrome can drop an utterance's end event if nothing else holds on to it.
  const held = useRef<SpeechSynthesisUtterance[]>([]);
  const latest = useRef(speeches);

  useEffect(() => {
    latest.current = speeches;
  }, [speeches]);

  const stop = useCallback(() => {
    current.current += 1;
    held.current = [];
    window.speechSynthesis.cancel();
    setSpeaking(null);
  }, []);

  const say = useCallback((index: number) => {
    const speech = latest.current[index];
    const parts = speech ? sentences(speech.text) : [];
    if (!speech || parts.length === 0) return;
    const mine = ++current.current;
    window.speechSynthesis.cancel();
    setSpeaking(index);
    // Chrome drops speak() called straight after cancel(), so wait a tick.
    setTimeout(() => {
      if (current.current !== mine) return;
      const { voice, pitch } = voiceFor(speech.side);
      const rate = parseFloat(localStorage.getItem("voice_speech_rate") || "1.0");
      const done = () => {
        if (current.current !== mine) return;
        held.current = [];
        setSpeaking(null);
      };
      held.current = parts.map((part, i) => {
        const utterance = new SpeechSynthesisUtterance(part);
        if (voice) utterance.voice = voice;
        utterance.pitch = pitch;
        utterance.rate = rate;
        if (i === parts.length - 1) utterance.onend = done;
        utterance.onerror = done;
        window.speechSynthesis.speak(utterance);
        return utterance;
      });
    }, 50);
  }, []);

  // Read aloud: when nothing is being spoken, move on to the next speech that has arrived.
  useEffect(() => {
    if (!readAloud || speaking !== null) return;
    const waiting = nextUp.current < speeches.length;
    if (!waiting && live) return; // the next speech is still being written
    const id = setTimeout(() => {
      if (waiting) {
        say(nextUp.current);
        nextUp.current += 1;
      } else {
        setReadAloud(false); // a finished debate has been read to the end
      }
    }, 0);
    return () => clearTimeout(id);
  }, [readAloud, speaking, speeches.length, live, say]);

  useEffect(() => {
    if (!supported) return;
    return () => {
      current.current += 1;
      window.speechSynthesis.cancel();
    };
  }, [supported]);

  const toggleReadAloud = () => {
    const on = !readAloud;
    try {
      localStorage.setItem(READ_ALOUD_KEY, on ? "1" : "0");
    } catch {
      // the choice just will not be remembered
    }
    if (on) {
      // Mid-debate, start with the speech that just landed; afterwards, from the top.
      nextUp.current = live ? Math.max(0, speeches.length - 1) : 0;
    } else {
      stop();
    }
    setReadAloud(on);
  };

  /** Play one speech, or stop it if it is the one playing. Read aloud carries on from there. */
  const listen = (index: number) => {
    if (speaking === index) {
      stop();
      setReadAloud(false);
      return;
    }
    nextUp.current = index + 1;
    say(index);
  };

  return { supported, readAloud, toggleReadAloud, speaking, listen };
}
