import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useVoiceConversation } from "./useVoiceConversation";
import { FakeRecognition, installFakeRecognition, installFakeSpeech } from "../../test/speech";

type Props = { loading: boolean; lastResponseText: string };

let synth: ReturnType<typeof installFakeSpeech>;
const onSubmit = vi.fn();

function setup() {
  return renderHook(
    (props: Props) => useVoiceConversation({ onSubmit, speechRate: 1, ...props }),
    { initialProps: { loading: false, lastResponseText: "" } },
  );
}

const latestRecognition = () => FakeRecognition.instances.at(-1)!;

/** Start voice mode, say something, and have Olly start answering with `reply` */
function startReplying(hook: ReturnType<typeof setup>, reply: string) {
  act(() => hook.result.current.toggle());
  act(() => latestRecognition().hear("tell me something"));
  hook.rerender({ loading: true, lastResponseText: "" });
  hook.rerender({ loading: true, lastResponseText: reply });
}

/** Finish every utterance the engine has been given so far (and any it queues meanwhile) */
function finishSpeaking() {
  for (let i = 0; i < 20 && synth.spoken.length; i++) {
    const u = synth.spoken.shift()!;
    act(() => u.onend?.());
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  onSubmit.mockClear();
  synth = installFakeSpeech([]);
  installFakeRecognition();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useVoiceConversation", () => {
  it("starts listening when switched on", () => {
    const { result } = setup();
    act(() => result.current.toggle());
    expect(result.current.isActive).toBe(true);
    expect(result.current.status).toBe("listening");
    expect(latestRecognition().started).toBe(true);
  });

  it("sends what was heard and moves on to processing", () => {
    const { result } = setup();
    act(() => result.current.toggle());
    act(() => latestRecognition().hear("what's the weather"));
    expect(onSubmit).toHaveBeenCalledWith("what's the weather");
    expect(result.current.status).toBe("processing");
  });

  describe("pause", () => {
    it("stops listening at once and lets go of recognition", () => {
      const { result } = setup();
      act(() => result.current.toggle());
      const recognition = latestRecognition();
      act(() => result.current.togglePause());
      expect(result.current.paused).toBe(true);
      expect(result.current.status).toBe("paused");
      expect(result.current.statusLabel).toBe("Paused");
      expect(recognition.aborted).toBe(true);
    });

    it("listens again on resume", () => {
      const { result } = setup();
      act(() => result.current.toggle());
      act(() => result.current.togglePause());
      const before = FakeRecognition.instances.length;
      act(() => result.current.togglePause());
      expect(result.current.paused).toBe(false);
      expect(result.current.status).toBe("listening");
      expect(FakeRecognition.instances.length).toBe(before + 1);
    });

    it("doesn't close voice mode for silence while paused", () => {
      const { result } = setup();
      act(() => result.current.toggle());
      act(() => result.current.togglePause());
      act(() => vi.advanceTimersByTime(60_000));
      expect(result.current.isActive).toBe(true);
      expect(result.current.status).toBe("paused");
    });

    it("lets a reply under way finish, then rests instead of listening", () => {
      const hook = setup();
      startReplying(hook, "Here is a fact. And another one.");
      expect(hook.result.current.status).toBe("speaking");
      const recognitions = FakeRecognition.instances.length;

      act(() => hook.result.current.togglePause());
      expect(hook.result.current.paused).toBe(true);
      expect(hook.result.current.status).toBe("speaking"); // still talking

      hook.rerender({ loading: false, lastResponseText: "Here is a fact. And another one." });
      finishSpeaking();
      expect(hook.result.current.status).toBe("paused");
      expect(FakeRecognition.instances.length).toBe(recognitions); // didn't start listening
    });

    it("rests instead of listening when interrupted while paused", () => {
      const hook = setup();
      startReplying(hook, "A long answer. With more.");
      act(() => hook.result.current.togglePause());
      act(() => hook.result.current.interrupt());
      expect(hook.result.current.status).toBe("paused");
      expect(synth.cancel).toHaveBeenCalled();
    });

    it("is cleared when voice mode ends, so the next session starts listening", () => {
      const { result } = setup();
      act(() => result.current.toggle());
      act(() => result.current.togglePause());
      act(() => result.current.toggle()); // end
      expect(result.current.paused).toBe(false);
      act(() => result.current.toggle()); // start again
      expect(result.current.status).toBe("listening");
    });

    it("does nothing when voice mode is off", () => {
      const { result } = setup();
      act(() => result.current.togglePause());
      expect(result.current.paused).toBe(false);
      expect(result.current.status).toBe("idle");
    });
  });

  it("tells word listeners about each spoken word", () => {
    const hook = setup();
    const onWord = vi.fn();
    const unsubscribe = hook.result.current.onWord(onWord);
    startReplying(hook, "Hello there.");
    const utterance = synth.spoken.at(-1)!;
    utterance.onboundary?.({ name: "word" });
    utterance.onboundary?.({ name: "sentence" });
    expect(onWord).toHaveBeenCalledTimes(1);
    unsubscribe();
    utterance.onboundary?.({ name: "word" });
    expect(onWord).toHaveBeenCalledTimes(1);
  });
});
