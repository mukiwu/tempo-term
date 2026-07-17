import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { UpdateModal } from "./UpdateModal";
import "../i18n";
import { useUpdaterStore } from "@/stores/updaterStore";

describe("UpdateModal release notes", () => {
  beforeEach(() => {
    useUpdaterStore.setState({
      modalOpen: true,
      available: {
        version: "0.0.6",
        notes: "## What's new\n\n- First item\n- Second item",
        releaseUrl: "",
        update: null as never,
      },
      installing: false,
      errorMessage: "",
    });
  });

  afterEach(() => {
    useUpdaterStore.setState({ modalOpen: false, available: null, errorMessage: "" });
  });

  it("renders markdown notes as real heading and list elements", () => {
    render(<UpdateModal />);

    expect(screen.getByRole("heading", { name: "What's new" })).toBeInTheDocument();
    expect(screen.getByText("First item").tagName).toBe("LI");
    expect(screen.getByText("Second item").tagName).toBe("LI");
    // The raw markdown markers must not leak through as plain text.
    expect(screen.queryByText(/## What's new/)).not.toBeInTheDocument();
  });

  it("shows the install error message when one is set", () => {
    useUpdaterStore.setState({ errorMessage: "disk full" });

    render(<UpdateModal />);

    expect(screen.getByText("disk full")).toBeInTheDocument();
  });

  it("shows byte progress and a progress bar while downloading", () => {
    useUpdaterStore.setState({
      installing: true,
      installPhase: "downloading",
      progress: { downloaded: 5_242_880, total: 10_485_760 },
    });

    render(<UpdateModal />);

    expect(screen.getByText("5.0 / 10.0 MB (50%)")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "50");
  });

  it("shows downloaded bytes alone when the total size is unknown", () => {
    useUpdaterStore.setState({
      installing: true,
      installPhase: "downloading",
      progress: { downloaded: 5_242_880, total: null },
    });

    render(<UpdateModal />);

    expect(screen.getByText("5.0 MB")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("switches to the installing label once the download finishes", () => {
    useUpdaterStore.setState({
      installing: true,
      installPhase: "installing",
      progress: { downloaded: 10_485_760, total: 10_485_760 },
    });

    render(<UpdateModal />);

    expect(screen.getByText("Installing…")).toBeInTheDocument();
  });
});
