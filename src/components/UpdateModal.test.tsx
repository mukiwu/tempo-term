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
});
