// Tests the extracted EditorPaneHeader component (see EditorPaneHeader.tsx).
// We test the toolbar in isolation to avoid mounting CodeMirror and its
// heavy Tauri/codemirror dependencies in jsdom. The behavior under test —
// "HTML file shows a Globe button; non-HTML hides it; click fires callback" —
// lives entirely inside the toolbar and is fully covered here.
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import "@/i18n";
import { EditorPaneHeader } from "./EditorPaneHeader";

const base = {
  wordWrap: false,
  onToggleWordWrap: vi.fn(),
  onRefresh: vi.fn(),
  mode: "edit" as const,
  onSetMode: vi.fn(),
  onSwitchFile: vi.fn(),
  showClose: false,
  onClose: vi.fn(),
};

describe("EditorPaneHeader web preview button", () => {
  it("shows the web-preview button for an HTML file and calls the callback", () => {
    const onOpenWebPreview = vi.fn();
    render(
      <EditorPaneHeader {...base} path="/proj/index.html" onOpenWebPreview={onOpenWebPreview} />,
    );
    const btn = screen.getByRole("button", { name: "Web preview" });
    fireEvent.click(btn);
    expect(onOpenWebPreview).toHaveBeenCalledTimes(1);
  });

  it("shows the web-preview button for an .htm file", () => {
    const onOpenWebPreview = vi.fn();
    render(
      <EditorPaneHeader {...base} path="/proj/page.htm" onOpenWebPreview={onOpenWebPreview} />,
    );
    expect(screen.getByRole("button", { name: "Web preview" })).toBeInTheDocument();
  });

  it("does not show the button for a non-HTML file", () => {
    render(<EditorPaneHeader {...base} path="/proj/notes.txt" onOpenWebPreview={() => {}} />);
    expect(screen.queryByRole("button", { name: "Web preview" })).toBeNull();
  });

  it("does not show the button when onOpenWebPreview is not provided", () => {
    render(<EditorPaneHeader {...base} path="/proj/index.html" />);
    expect(screen.queryByRole("button", { name: "Web preview" })).toBeNull();
  });
});
