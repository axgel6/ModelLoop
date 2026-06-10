import { useCallback, useEffect, useRef, useState } from "react";

export type VoiceStatus = "idle" | "listening" | "processing" | "speaking";

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

function getPreferredVoice(lang: string): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;
  const base = lang.split("-")[0];
  const langVoices = voices.filter((v) => v.lang.startsWith(base));
  return (
    langVoices.find((v) => v.name.includes("Google")) ??
    langVoices.find((v) => !v.localService) ??
    langVoices[0] ??
    null
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
  error: string | null;
  toggle: () => void;
  stop: () => void;
  interrupt: () => void;
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
  const [error, setError] = useState<string | null>(null);

  const isActiveRef       = useRef(false);
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

  useEffect(() => { onSubmitRef.current = onSubmit; }, [onSubmit]);
  useEffect(() => { loadingRef.current = loading; }, [loading]);
  useEffect(() => { lastResponseTextRef.current = lastResponseText; }, [lastResponseText]);
  useEffect(() => { speechRateRef.current = speechRate; }, [speechRate]);

  // Load best available voice; refresh on voiceschanged
  useEffect(() => {
    const load = () => {
      voiceRef.current = getPreferredVoice(navigator.language || "en-US");
    };
    load();
    window.speechSynthesis.addEventListener("voiceschanged", load);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", load);
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
      startListeningRef.current();
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
        checkAllDone();
        return;
      }

      isSpeakingRef.current = true;
      const utterance = new SpeechSynthesisUtterance(cleaned);
      utterance.lang = navigator.language || "en-US";
      utterance.rate = speechRateRef.current;
      if (voiceRef.current) utterance.voice = voiceRef.current;
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
    if (!isActiveRef.current) return;

    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      setError("Speech recognition is not supported in this browser.");
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
        setError("Microphone access denied. Enable it in macOS System Settings → Privacy & Security → Microphone.");
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
    setIsActive(false);
    setStatusSync("idle");
    setTranscript("");
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
      setIsActive(true);
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
    startListeningRef.current();
  }, []);

  const statusLabel =
    status === "listening"  ? "Listening…"  :
    status === "processing" ? "Processing…" :
    status === "speaking"   ? "Speaking…"   : "";

  return { isActive, status, statusLabel, transcript, error, toggle, stop: stopAll, interrupt };
}
