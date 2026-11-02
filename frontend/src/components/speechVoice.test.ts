import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  automaticVoice,
  betterVoicesTip,
  chosenVoice,
  isNoveltyVoice,
  speakWithChosenVoice,
  speakWithVoice,
  useVoiceChoice,
  voiceLabel,
  voiceQuality,
  voiceRegion,
} from "./speechVoice";
import { fakeVoice, installFakeSpeech } from "../test/speech";

const samantha = fakeVoice("Samantha");
const ava = fakeVoice("Ava (Premium)");
const zoe = fakeVoice("Zoe (Enhanced)");
const aria = fakeVoice("Microsoft Aria Online (Natural)", "en-US", false);
const daniel = fakeVoice("Daniel", "en-GB");
const danielTwin = { ...fakeVoice("Daniel", "en-GB"), voiceURI: "uri:daniel-twin" } as SpeechSynthesisVoice;
const ralph = fakeVoice("Ralph");
const thomas = fakeVoice("Thomas", "fr-FR");

let synth: ReturnType<typeof installFakeSpeech>;
beforeEach(() => {
  localStorage.clear();
  vi.spyOn(navigator, "language", "get").mockReturnValue("en-US");
  synth = installFakeSpeech([samantha, ava, zoe, aria, daniel, danielTwin, ralph, thomas]);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("voice details", () => {
  it("rates voices by what their names say", () => {
    expect(voiceQuality(ava)).toBe("premium");
    expect(voiceQuality(zoe)).toBe("enhanced");
    expect(voiceQuality(aria)).toBe("natural");
    expect(voiceQuality(samantha)).toBeNull();
  });

  it("shows names without the quality tag the badge already shows", () => {
    expect(voiceLabel(ava)).toBe("Ava");
    expect(voiceLabel(zoe)).toBe("Zoe");
    expect(voiceLabel(aria)).toBe("Microsoft Aria Online");
    expect(voiceLabel(samantha)).toBe("Samantha");
  });

  it("knows macOS's novelty voices", () => {
    expect(isNoveltyVoice(ralph)).toBe(true);
    expect(isNoveltyVoice(samantha)).toBe(false);
  });

  it("names the region of the voice's accent", () => {
    expect(voiceRegion(daniel)).toBe("United Kingdom");
    expect(voiceRegion(fakeVoice("Plain", "en"))).toBe("en");
  });
});

describe("automaticVoice", () => {
  it("prefers the known good voices for the user's language", () => {
    expect(automaticVoice()?.name).toBe("Samantha");
  });

  it("falls back to a natural voice, then any voice in the language", () => {
    synth.voices = [daniel, aria];
    expect(automaticVoice()).toBe(aria);
    synth.voices = [daniel];
    expect(automaticVoice()).toBe(daniel);
  });

  it("is null before the browser has loaded any voices", () => {
    synth.voices = [];
    expect(automaticVoice()).toBeNull();
  });
});

describe("chosenVoice", () => {
  it("uses the saved choice when it's on this device", () => {
    localStorage.setItem("voice_name", ava.voiceURI);
    expect(chosenVoice()).toBe(ava);
  });

  it("falls back to the automatic voice when the saved one isn't here", () => {
    localStorage.setItem("voice_name", "uri:gone");
    expect(chosenVoice()).toBe(samantha);
  });
});

describe("speaking", () => {
  it("cancels what's playing, then speaks with the voice and rate asked for", () => {
    vi.useFakeTimers();
    const onEnd = vi.fn();
    const utterance = speakWithVoice("Hello", zoe, { rate: 1.4, onEnd });
    expect(synth.cancel).toHaveBeenCalled();
    expect(synth.speak).not.toHaveBeenCalled(); // deferred a tick for Chrome
    vi.advanceTimersByTime(60);
    expect(synth.speak).toHaveBeenCalledWith(utterance);
    expect(utterance.voice).toBe(zoe);
    expect(utterance.rate).toBe(1.4);
    utterance.onend?.(new Event("end") as SpeechSynthesisEvent);
    expect(onEnd).toHaveBeenCalled();
  });

  it("speaks with the chosen voice everywhere", () => {
    localStorage.setItem("voice_name", daniel.voiceURI);
    expect(speakWithChosenVoice("Hi").voice).toBe(daniel);
  });
});

describe("useVoiceChoice", () => {
  it("lists the user's language only: best first, novelty last, each voice once", () => {
    const { result } = renderHook(() => useVoiceChoice());
    expect(result.current.voices.map((v) => v.name)).toEqual([
      "Ava (Premium)",
      "Zoe (Enhanced)",
      "Microsoft Aria Online (Natural)",
      "Daniel",
      "Samantha",
      "Ralph",
    ]);
  });

  it("saves a choice, and tells the voice users it changed", () => {
    const changed = vi.fn();
    window.addEventListener("olly-voice-changed", changed);
    const { result } = renderHook(() => useVoiceChoice());
    act(() => result.current.setChoice(zoe.voiceURI));
    expect(result.current.choice).toBe(zoe.voiceURI);
    expect(localStorage.getItem("voice_name")).toBe(zoe.voiceURI);
    expect(changed).toHaveBeenCalled();
    act(() => result.current.setChoice(""));
    expect(localStorage.getItem("voice_name")).toBeNull();
    window.removeEventListener("olly-voice-changed", changed);
  });

  it("shows a folded-away duplicate's twin as the picked voice", () => {
    localStorage.setItem("voice_name", danielTwin.voiceURI);
    const { result } = renderHook(() => useVoiceChoice());
    expect(result.current.choice).toBe(daniel.voiceURI);
    expect(result.current.missing).toBe(false);
  });

  it("says when the picked voice isn't on this device, but not while voices are still loading", () => {
    localStorage.setItem("voice_name", "uri:gone");
    synth.voices = [];
    const { result } = renderHook(() => useVoiceChoice());
    expect(result.current.missing).toBe(false);
    act(() => synth.setVoices([samantha]));
    expect(result.current.missing).toBe(true);
    expect(result.current.choice).toBe("");
  });
});

describe("betterVoicesTip", () => {
  const as = (ua: string, touchPoints = 0) => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(ua);
    // jsdom doesn't define maxTouchPoints, so it can't be spied on
    Object.defineProperty(navigator, "maxTouchPoints", { value: touchPoints, configurable: true });
    return betterVoicesTip();
  };

  it("points each platform to its own voice settings", () => {
    expect(as("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari")).toMatch(/System Settings/);
    expect(as("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)")).toMatch(/^Get more .* Settings → Accessibility/);
    expect(as("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 5)).not.toMatch(/System Settings/); // iPad
    expect(as("Mozilla/5.0 (Linux; Android 15)")).toMatch(/Text-to-speech/);
    expect(as("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toMatch(/Edge/);
  });

  it("offers nothing where there's no simple answer", () => {
    expect(as("Mozilla/5.0 (X11; Linux x86_64)")).toBeNull();
  });
});
