import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StatusBar } from "./StatusBar";
import "../i18n";
import { useUpdaterStore } from "@/stores/updaterStore";

const AVAILABLE = {
  version: "0.0.9",
  notes: "",
  releaseUrl: "",
  update: null as never,
};

describe("StatusBar update indicator", () => {
  beforeEach(() => {
    useUpdaterStore.setState({ available: null, modalOpen: false });
  });
  afterEach(() => {
    useUpdaterStore.setState({ available: null, modalOpen: false });
  });

  it("hides the indicator when no update is available", () => {
    render(<StatusBar />);
    expect(screen.queryByLabelText("Update available")).not.toBeInTheDocument();
  });

  it("shows the indicator when an update is available and the modal is closed", () => {
    useUpdaterStore.setState({ available: AVAILABLE, modalOpen: false });
    render(<StatusBar />);
    expect(screen.getByLabelText("Update available")).toBeInTheDocument();
  });

  it("hides the indicator while the modal is open", () => {
    useUpdaterStore.setState({ available: AVAILABLE, modalOpen: true });
    render(<StatusBar />);
    expect(screen.queryByLabelText("Update available")).not.toBeInTheDocument();
  });

  it("opens the modal when the indicator is clicked", () => {
    useUpdaterStore.setState({ available: AVAILABLE, modalOpen: false });
    render(<StatusBar />);

    fireEvent.click(screen.getByLabelText("Update available"));

    expect(useUpdaterStore.getState().modalOpen).toBe(true);
  });
});
