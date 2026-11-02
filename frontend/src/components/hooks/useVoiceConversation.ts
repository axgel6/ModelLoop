import { useCallback, useEffect, useRef, useState } from "react";
import { chosenVoice, onVoicesChanged } from "../speechVoice";

// "paused": voice mode stays open but stops listening, and the mic is let go
export type VoiceStatus = "idle" | "listening" | "processing" | "speaking" | "paused";

const SILENCE_TIMEOUT_MS = 30_000;

// ── helpers ──────────────────────────────────────────────────────────────────

function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`]+`/g, "")
    .replace(/#{1,6}\s/gm, "")
    .replace(/\*\*(.+?)\*\*/gs, "$1")
    .replace(/\*(.+?)\*/gs, "$1")
    .replace(/__(.+?)__/gs, "$1")
    .replace(/_(.+?)_/gs, "$1")
    .replace(/\[(.+?)\]\(.+?\)/g, "$1")
    .replace(/^[-*+]\s/gm, "")
    .replace(/^\d+\.\s/gm, "")
    .replace(/^>\s/gm, "")
    .replace(/\n{2,}/g, ". ")
    .replace(/\n/g, " ")
    .trim();
}

function prepareForSpeech(text: string): string {
  return text
    // Em/en dashes → natural spoken pause
    .replace(/\s*[—–]\s*/g, ", ")
    // Semicolons → softer pause
    .replace(/;\s*/g, ", ")
    // Common abbreviations → full spoken form
    .replace(/\be\.g\.\s*/gi, "for example, ")
    .replace(/\bi\.e\.\s*/gi, "that is, ")
    .replace(/\betc\.\s*/gi, "and so on")
    .replace(/\bvs\.\s*/gi, "versus ")
    .replace(/\bapprox\.\s*/gi, "approximately ")
    // Numbers + units
    .replace(/(\d+)%/g, "$1 percent")
    .replace(/(\d+)x\b/gi, "$1 times")
    // Clean up any double punctuation introduced
    .replace(/,\s*,/g, ",")
    .replace(/\.\s*\./g, ".")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// Common abbreviations that end with a dot but don't terminate a sentence.
const ABBREVS = new Set([
  "mr", "mrs", "ms", "dr", "prof", "sr", "jr", "rev", "gen", "sgt", "cpl",
  "vs", "etc", "inc", "ltd", "dept", "approx", "est", "no", "vol", "fig",
  "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "oct", "nov", "dec",
  "u.s", "u.k", "e.g", "i.e",
]);

// Returns index just past the first complete sentence in text[from…], or -1.
function findSentenceEnd(text: string, from: number): number {
  for (let i = from; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];
    if (c === "\n" && next === "\n") return i + 2;
    if (c === "!" || c === "?") {
      if (next === undefined || next === " " || next === "\n") return i + 1;
    }
    if (c === ".") {
      if (/\d/.test(text[i - 1] ?? "")) continue; // skip decimals like 3.14
      if (next !== undefined && next !== " " && next !== "\n") continue; // mid-word dot
      // Check if dot follows a known abbreviation
      const wordStart = text.lastIndexOf(" ", i - 1) + 1;
      const word = text.slice(wordStart, i).toLowerCase().replace(/\.$/, "");
      if (ABBREVS.has(word)) continue;
      return i + 1;
    }
  }
  return -1;
}

function getSpeechRecognitionCtor(): (typeof SpeechRecognition) | undefined {
  return (
    (window as unknown as { SpeechRecognition?: typeof SpeechRecognition }).SpeechRecognition ??
    (window as unknown as { webkitSpeechRecognition?: typeof SpeechRecognition }).webkitSpeechRecognition
  );
}

// ── hook ─────────────────────────────────────────────────────────────────────

interface Options {
  onSubmit: (text: string) => void;
  loading: boolean;
  lastResponseText: string;
  speechRate: number;
}

export interface VoiceConversationHandle {
  isActive: boolean;
  status: VoiceStatus;
  statusLabel: string;
  transcript: string;
  speakingText: string;
  error: string | null;
  toggle: () => void;
  stop: () => void;
  interrupt: () => void;
  /** Whether listening is paused (a reply already under way still finishes speaking) */
  paused: boolean;
  togglePause: () => void;
  /** Called on each spoken word, where the voice reports word boundaries; returns an unsubscribe */
  onWord: (listener: () => void) => () => void;
}

export function useVoiceConversation({
  onSubmit,
  loading,
  lastResponseText,
  speechRate,
}: Options): VoiceConversationHandle {
  const [isActive, setIsActive] = useState(false);
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [transcript, setTranscript] = useState("");
  const [speakingText, setSpeakingText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);

  const isActiveRef       = useRef(false);
  const pausedRef         = useRef(false);
  const statusRef         = useRef<VoiceStatus>("idle");
  const recognitionRef    = useRef<SpeechRecognition | null>(null);
  const onSubmitRef       = useRef(onSubmit);
  const loadingRef        = useRef(loading);
  const lastResponseTextRef = useRef(lastResponseText);
  const prevLoadingRef    = useRef(loading);
  const startListeningRef = useRef<() => void>(() => {});
  const stopAllRef        = useRef<() => void>(() => {});
  const voiceRef          = useRef<SpeechSynthesisVoice | null>(null);
  const speechRateRef     = useRef(speechRate);

  // Speech queue — only one utterance plays at a time (avoids Chrome onend bug)
  const speechQueueRef    = useRef<string[]>([]);
  const isSpeakingRef     = useRef(false);
  const spokenUpToRef     = useRef(0);
  const loadingDoneRef    = useRef(false);
  const silenceTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wordListenersRef  = useRef(new Set<() => void>());

  useEffect(() => { onSubmitRef.current = onSubmit; }, [onSubmit]);
  useEffect(() => { loadingRef.current = loading; }, [loading]);
  useEffect(() => { lastResponseTextRef.current = lastResponseText; }, [lastResponseText]);
  useEffect(() => { speechRateRef.current = speechRate; }, [speechRate]);

  // The chosen voice (see speechVoice.ts); refreshed when the list loads or the choice changes
  useEffect(() => {
    const load = () => {
      voiceRef.current = chosenVoice();
    };
    load();
    return onVoicesChanged(load);
  }, []);

  const setStatusSync = (s: VoiceStatus) => {
    statusRef.current = s;
    setStatus(s);
  };

  const stopRecognition = () => {
    const r = recognitionRef.current;
    if (!r) return;
    recognitionRef.current = null;
    r.onstart = null; r.onresult = null; r.onerror = null; r.onend = null;
    try { r.abort(); } catch { /* ignore */ }
  };

  const cancelSpeech = () => {
    speechQueueRef.current = [];
    isSpeakingRef.current = false;
    window.speechSynthesis.cancel();
  };

  const clearSilenceTimer = () => {
    if (silenceTimerRef.current !== null) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  };

  const resetSilenceTimer = () => {
    clearSilenceTimer();
    silenceTimerRef.current = setTimeout(() => {
      if (isActiveRef.current && statusRef.current === "listening") {
        stopAllRef.current();
      }
    }, SILENCE_TIMEOUT_MS);
  };

  // processQueue: dequeue and speak one segment; when done, call itself again.
  // This ensures only one SpeechSynthesisUtterance is active at a time, which
  // reliably fires onend in Chrome (queuing multiple utterances doesn't).
  const processQueueRef = useRef<() => void>(() => {});

  const checkAllDone = useCallback(() => {
    if (
      loadingDoneRef.current &&
      speechQueueRef.current.length === 0 &&
      !isSpeakingRef.current &&
      isActiveRef.current
    ) {
      loadingDoneRef.current = false;
      spokenUpToRef.current = 0;
      if (pausedRef.current) setStatusSync("paused");
      else startListeningRef.current();
    }
  }, []);

  useEffect(() => {
    processQueueRef.current = () => {
      // Drain until we find a non-empty segment
      let cleaned = "";
      while (speechQueueRef.current.length > 0 && !cleaned) {
        cleaned = stripMarkdown(speechQueueRef.current.shift()!);
      }

      if (!cleaned) {
        isSpeakingRef.current = false;
        setSpeakingText("");
        checkAllDone();
        return;
      }

      isSpeakingRef.current = true;
      setSpeakingText(cleaned);
      const utterance = new SpeechSynthesisUtterance(prepareForSpeech(cleaned));
      utterance.lang = navigator.language || "en-US";
      utterance.rate = speechRateRef.current;
      utterance.pitch = 0.95;
      if (voiceRef.current) utterance.voice = voiceRef.current;
      utterance.onboundary = (e) => {
        if (e.name === "word") wordListenersRef.current.forEach((fn) => fn());
      };
      utterance.onend  = () => processQueueRef.current();
      utterance.onerror = () => processQueueRef.current();
      window.speechSynthesis.speak(utterance);
    };
  }, [checkAllDone]);

  const enqueue = useCallback((segment: string) => {
    speechQueueRef.current.push(segment);
    if (!isSpeakingRef.current) {
      if (statusRef.current === "processing") setStatusSync("speaking");
      processQueueRef.current();
    }
  }, []);

  // Speak each completed sentence as response streams in
  useEffect(() => {
    if (!isActiveRef.current) return;
    if (statusRef.current !== "processing" && statusRef.current !== "speaking") return;
    if (!lastResponseText) return;

    let cursor = spokenUpToRef.current;
    let advanced = false;

    while (true) {
      const end = findSentenceEnd(lastResponseText, cursor);
      if (end === -1) break;
      const segment = lastResponseText.slice(cursor, end).trim();
      cursor = end;
      if (!segment) continue;
      advanced = true;
      enqueue(segment);
    }

    if (advanced) spokenUpToRef.current = cursor;
  }, [lastResponseText, enqueue]);

  // loading true→false: flush trailing text, then wait for queue to drain
  useEffect(() => {
    const wasLoading = prevLoadingRef.current;
    prevLoadingRef.current = loading;

    if (
      wasLoading && !loading &&
      isActiveRef.current &&
      (statusRef.current === "processing" || statusRef.current === "speaking")
    ) {
      const remaining = lastResponseTextRef.current.slice(spokenUpToRef.current).trim();
      spokenUpToRef.current = lastResponseTextRef.current.length;
      loadingDoneRef.current = true;

      if (remaining) enqueue(remaining);

      // Queue might already be empty (short response, all spoken mid-stream)
      checkAllDone();
    }
  }, [loading, enqueue, checkAllDone]);

  const startListening = useCallback(() => {
    if (!isActiveRef.current || pausedRef.current) return;

    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      setError("Voice chat isn't available in this browser, but typing works just fine.");
      isActiveRef.current = false;
      setIsActive(false);
      setStatusSync("idle");
      return;
    }

    setStatusSync("listening");
    setTranscript("");
    resetSilenceTimer();

    const recognition = new Ctor();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = navigator.language || "en-US";
    recognitionRef.current = recognition;

    let accumulated = "";

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let finalText = "";
      let interimText = "";
      for (let i = 0; i < event.results.length; i++) {
        if (event.results[i].isFinal) finalText += event.results[i][0].transcript;
        else interimText += event.results[i][0].transcript;
      }
      if (finalText || interimText) clearSilenceTimer();
      if (finalText) accumulated = finalText;
      setTranscript((finalText || interimText).trim());
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (event.error === "not-allowed") {
        setError("I can't hear you yet. Allow the microphone in System Settings, under Privacy & Security, then Microphone.");
        clearSilenceTimer();
        isActiveRef.current = false;
        setIsActive(false);
        setStatusSync("idle");
        stopRecognition();
      }
      // "no-speech" and other transient errors: onend fires next and restarts listening
    };

    recognition.onend = () => {
      clearSilenceTimer();
      recognitionRef.current = null;
      if (!isActiveRef.current) return;

      const text = accumulated.trim();
      if (text) {
        setTranscript("");
        setStatusSync("processing");
        spokenUpToRef.current = 0;
        loadingDoneRef.current = false;
        cancelSpeech();
        onSubmitRef.current(text);
      } else {
        setTimeout(() => startListeningRef.current(), 150);
      }
    };

    try {
      recognition.start();
    } catch {
      recognitionRef.current = null;
      setTimeout(() => startListeningRef.current(), 500);
    }
  }, []);

  useEffect(() => { startListeningRef.current = startListening; }, [startListening]);

  const stopAll = useCallback(() => {
    isActiveRef.current = false;
    pausedRef.current = false;
    setIsActive(false);
    setPaused(false);
    setStatusSync("idle");
    setTranscript("");
    setSpeakingText("");
    spokenUpToRef.current = 0;
    loadingDoneRef.current = false;
    clearSilenceTimer();
    stopRecognition();
    cancelSpeech();
  }, []);

  useEffect(() => { stopAllRef.current = stopAll; }, [stopAll]);

  const toggle = useCallback(() => {
    if (isActiveRef.current) {
      stopAll();
    } else {
      isActiveRef.current = true;
      pausedRef.current = false;
      setIsActive(true);
      setPaused(false);
      setError(null);
      if (loadingRef.current) {
        setStatusSync("processing");
      } else {
        startListening();
      }
    }
  }, [stopAll, startListening]);

  useEffect(() => {
    return () => { stopRecognition(); cancelSpeech(); clearSilenceTimer(); };
  }, []);

  // Interrupt: cancel TTS and return to listening (user wants to speak again)
  const interrupt = useCallback(() => {
    if (!isActiveRef.current || statusRef.current !== "speaking") return;
    cancelSpeech();
    spokenUpToRef.current = lastResponseTextRef.current.length;
    loadingDoneRef.current = false;
    if (pausedRef.current) setStatusSync("paused");
    else startListeningRef.current();
  }, []);

  // Pause stops listening straight away and lets go of the mic. A reply that's under way still
  // finishes speaking, and then it rests instead of listening. Resume picks up listening again.
  const togglePause = useCallback(() => {
    if (!isActiveRef.current) return;
    if (pausedRef.current) {
      pausedRef.current = false;
      setPaused(false);
      if (statusRef.current === "paused") startListeningRef.current();
      return;
    }
    pausedRef.current = true;
    setPaused(true);
    clearSilenceTimer();
    if (statusRef.current === "listening" || statusRef.current === "idle") {
      stopRecognition();
      setTranscript("");
      setStatusSync("paused");
    }
  }, []);

  const onWord = useCallback((listener: () => void) => {
    const listeners = wordListenersRef.current;
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, []);

  const statusLabel =
    status === "listening"  ? "Listening…"  :
    status === "processing" ? "Processing…" :
    status === "speaking"   ? "Speaking…"   :
    status === "paused"     ? "Paused"      : "";

  return {
    isActive, status, statusLabel, transcript, speakingText, error,
    toggle, stop: stopAll, interrupt, paused, togglePause, onWord,
  };
}
