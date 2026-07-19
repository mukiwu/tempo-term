import { act } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Tooltip } from "./Tooltip";

describe("Tooltip", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function hoverAnchor() {
    fireEvent.mouseEnter(screen.getByRole("button").parentElement!);
  }

  it("shows the label only after the delay elapses", () => {
    render(
      <Tooltip label="Close">
        <button type="button">x</button>
      </Tooltip>,
    );
    hoverAnchor();
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(300));
    expect(screen.getByRole("tooltip")).toHaveTextContent("Close");
  });

  it("cancels the pending tooltip when the pointer leaves early", () => {
    render(
      <Tooltip label="Close">
        <button type="button">x</button>
      </Tooltip>,
    );
    hoverAnchor();
    fireEvent.mouseLeave(screen.getByRole("button").parentElement!);
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("hides on mousedown so click-opened popovers are not covered", () => {
    render(
      <Tooltip label="More">
        <button type="button">x</button>
      </Tooltip>,
    );
    hoverAnchor();
    act(() => vi.advanceTimersByTime(300));
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole("button"));
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("appends className to the wrapper", () => {
    render(
      <Tooltip label="hint" className="min-w-0 flex-1">
        <button type="button">x</button>
      </Tooltip>,
    );
    expect(screen.getByRole("button").parentElement).toHaveClass(
      "inline-flex",
      "min-w-0",
      "flex-1",
    );
  });

  it("never shows a tooltip for a falsy label", () => {
    render(
      <Tooltip label={undefined}>
        <button type="button">x</button>
      </Tooltip>,
    );
    hoverAnchor();
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("suppresses an ancestor tooltip while a nested one is hovered", () => {
    const { container } = render(
      <Tooltip label="card">
        <div>
          <Tooltip label="badge">
            <button type="button">x</button>
          </Tooltip>
        </div>
      </Tooltip>,
    );
    const outer = container.firstElementChild!;
    const inner = screen.getByRole("button").parentElement!;

    fireEvent.mouseEnter(outer);
    act(() => vi.advanceTimersByTime(300));
    expect(screen.getByRole("tooltip")).toHaveTextContent("card");

    // Entering the nested tooltip hides the ancestor's immediately, and only
    // the nested label shows after the delay.
    fireEvent.mouseEnter(inner);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(300));
    const tips = screen.getAllByRole("tooltip");
    expect(tips).toHaveLength(1);
    expect(tips[0]).toHaveTextContent("badge");

    // Leaving the nested one (pointer still over the ancestor — relatedTarget
    // points inside it, so no leave fires on the ancestor) brings the
    // ancestor's tooltip back after its delay.
    fireEvent.mouseLeave(inner, { relatedTarget: outer });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(300));
    expect(screen.getByRole("tooltip")).toHaveTextContent("card");

    // Leaving the ancestor too cancels everything.
    fireEvent.mouseLeave(outer);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("releases the suppression when the nested tooltip unmounts mid-hover", () => {
    const { container, rerender } = render(
      <Tooltip label="card">
        <div>
          <Tooltip label="badge">
            <button type="button">x</button>
          </Tooltip>
        </div>
      </Tooltip>,
    );
    const outer = container.firstElementChild!;

    fireEvent.mouseEnter(outer);
    fireEvent.mouseEnter(screen.getByRole("button").parentElement!);
    rerender(
      <Tooltip label="card">
        <div />
      </Tooltip>,
    );
    // The ancestor is no longer suppressed, so it can show again.
    act(() => vi.advanceTimersByTime(300));
    expect(screen.getByRole("tooltip")).toHaveTextContent("card");
  });
});
