import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import "@/i18n";
import { QuickLaunchButton } from "./QuickLaunchButton";
import { useTabsStore } from "@/stores/tabsStore";

function renderButton() {
  return render(<QuickLaunchButton boundsRef={createRef<HTMLElement>()} />);
}

describe("QuickLaunchButton", () => {
  beforeEach(() => {
    cleanup();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("opens the launcher tab on click", () => {
    const openLauncherTab = vi.fn();
    useTabsStore.setState({ openLauncherTab });
    renderButton();
    fireEvent.click(screen.getByRole("button", { name: "Add tab" }));
    expect(openLauncherTab).toHaveBeenCalled();
  });

  it("slides out the launcher actions on hover and closes after the pointer leaves", () => {
    renderButton();
    const button = screen.getByRole("button", { name: "Add tab" });

    fireEvent.mouseEnter(button);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(200));
    expect(screen.getByRole("menuitem", { name: "Git Graph" })).toBeInTheDocument();

    fireEvent.mouseLeave(button);
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("runs an action straight from the strip", () => {
    const openGitGraphTab = vi.fn();
    useTabsStore.setState({ openGitGraphTab });
    renderButton();
    fireEvent.mouseEnter(screen.getByRole("button", { name: "Add tab" }));
    act(() => vi.advanceTimersByTime(200));
    fireEvent.click(screen.getByRole("menuitem", { name: "Git Graph" }));
    expect(openGitGraphTab).toHaveBeenCalled();
  });
});
