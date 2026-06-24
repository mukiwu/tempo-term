import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UpdateToast } from "./UpdateToast";
import "../i18n";
import { useUpdaterStore } from "@/stores/updaterStore";

describe("UpdateToast", () => {
  beforeEach(() => {
    useUpdaterStore.setState({ toast: { version: "0.0.9" }, modalOpen: false });
  });
  afterEach(() => {
    vi.useRealTimers();
    useUpdaterStore.setState({ toast: null, modalOpen: false });
  });

  it("shows nothing when there is no toast", () => {
    useUpdaterStore.setState({ toast: null });
    const { container } = render(<UpdateToast />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the new version and opens the modal when clicked", () => {
    render(<UpdateToast />);

    expect(screen.getByText(/0\.0\.9/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button"));

    expect(useUpdaterStore.getState().modalOpen).toBe(true);
  });

  it("auto-clears the toast after the fade timeout", () => {
    vi.useFakeTimers();
    render(<UpdateToast />);

    act(() => {
      vi.advanceTimersByTime(6000);
    });

    expect(useUpdaterStore.getState().toast).toBeNull();
  });
});
