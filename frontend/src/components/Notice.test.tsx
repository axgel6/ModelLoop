import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Notice } from "./Notice";

vi.mock("../sounds", () => ({ sounds: { play: vi.fn() } }));

describe("Notice", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("shows nothing without a message", () => {
    render(<Notice message="" />);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows the message with its kicker, then leaves by itself and reports it", () => {
    const onDone = vi.fn();
    render(<Notice message="Add your password." kicker="Sign in" onDone={onDone} />);
    expect(screen.getByRole("alert").textContent).toContain("Sign in");
    expect(screen.getByText("Add your password.")).toBeTruthy();

    act(() => vi.advanceTimersByTime(4200));
    expect(document.querySelector(".notice.is-out")).not.toBeNull();
    act(() => vi.advanceTimersByTime(380));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("leaves on a click", () => {
    render(<Notice message="No microphone." />);
    fireEvent.click(screen.getByTitle("Dismiss"));
    act(() => vi.advanceTimersByTime(380));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("stays hidden for the same message once it has gone, and comes back for a new try", () => {
    const { rerender } = render(<Notice message="Wrong password." shake={1} />);
    act(() => vi.advanceTimersByTime(4200));
    act(() => vi.advanceTimersByTime(380));
    rerender(<Notice message="Wrong password." shake={1} />);
    expect(screen.queryByRole("alert")).toBeNull();

    rerender(<Notice message="Wrong password." shake={2} />);
    expect(screen.getByText("Wrong password.")).toBeTruthy();
  });

  it("starts to leave when the message is cleared", () => {
    const { rerender } = render(<Notice message="Upload failed." />);
    rerender(<Notice message="" />);
    expect(document.querySelector(".notice.is-out")).not.toBeNull();
    act(() => vi.advanceTimersByTime(380));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
