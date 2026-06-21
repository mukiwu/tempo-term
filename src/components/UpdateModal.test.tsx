import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { UpdateModal } from "./UpdateModal";
import "../i18n";
import { useUpdaterStore } from "@/stores/updaterStore";

describe("UpdateModal release notes", () => {
  beforeEach(() => {
    useUpdaterStore.setState({
      status: "available",
      version: "0.0.6",
      notes: "## What's new\n\n- First item\n- Second item",
      releaseUrl: "",
      installing: false,
    });
  });

  afterEach(() => {
    useUpdaterStore.setState({ status: "idle", notes: "", version: "" });
  });

  it("renders markdown notes as real heading and list elements", () => {
    render(<UpdateModal />);

    expect(screen.getByRole("heading", { name: "What's new" })).toBeInTheDocument();
    expect(screen.getByText("First item").tagName).toBe("LI");
    expect(screen.getByText("Second item").tagName).toBe("LI");
    // The raw markdown markers must not leak through as plain text.
    expect(screen.queryByText(/## What's new/)).not.toBeInTheDocument();
  });
});
