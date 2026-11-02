import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { READER_SIZES, useReaderPrefs } from "./readerPrefs";

beforeEach(() => localStorage.clear());

describe("useReaderPrefs", () => {
  it("starts on Night, Rounded, normal size and width", () => {
    const { result } = renderHook(() => useReaderPrefs());
    expect(result.current[0]).toEqual({
      theme: "night",
      font: "rounded",
      size: READER_SIZES.indexOf(1),
      width: "normal",
    });
  });

  it("remembers changes for next time", () => {
    const { result } = renderHook(() => useReaderPrefs());
    act(() => result.current[1]({ theme: "paper", size: 5 }));
    expect(result.current[0].theme).toBe("paper");
    const again = renderHook(() => useReaderPrefs());
    expect(again.result.current[0]).toMatchObject({ theme: "paper", size: 5, font: "rounded" });
  });

  it("ignores saved values it doesn't recognise, keeping the good ones", () => {
    localStorage.setItem(
      "focused_reader",
      JSON.stringify({ theme: "neon", font: "serif", size: 99, width: "huge" }),
    );
    const { result } = renderHook(() => useReaderPrefs());
    expect(result.current[0]).toEqual({ theme: "night", font: "serif", size: 3, width: "normal" });
  });

  it("survives a corrupted save", () => {
    localStorage.setItem("focused_reader", "{not json");
    const { result } = renderHook(() => useReaderPrefs());
    expect(result.current[0].theme).toBe("night");
  });
});
