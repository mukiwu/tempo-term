import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@/i18n";
import { WorkspaceSettingsSection } from "./WorkspaceSettingsSection";
import { useSettingsStore } from "@/stores/settingsStore";

vi.mock("@/modules/workspace/lib/prBridge", () => ({
  ghAvailable: vi.fn().mockResolvedValue(true),
}));
vi.mock("@/modules/ai/lib/aiBridge", () => ({
  secretsHasKey: vi.fn().mockResolvedValue(false),
  secretsSetKey: vi.fn().mockResolvedValue(undefined),
  secretsDeleteKey: vi.fn().mockResolvedValue(undefined),
}));

beforeEach(() => {
  useSettingsStore.setState({
    workspaceCard: { status: true, branch: true, cwd: true, pr: true },
    prSource: "auto",
    claudeFlags: "",
    codexFlags: "",
  });
});

describe("WorkspaceSettingsSection", () => {
  it("toggles a card block in the store", () => {
    render(<WorkspaceSettingsSection />);
    fireEvent.click(screen.getByLabelText("Pull request"));
    expect(useSettingsStore.getState().workspaceCard.pr).toBe(false);
  });

  it("changes the PR source in the store", () => {
    render(<WorkspaceSettingsSection />);
    fireEvent.click(screen.getByRole("button", { name: "GitHub token" }));
    expect(useSettingsStore.getState().prSource).toBe("token");
  });

  it("reveals the token input only when the source is token", () => {
    render(<WorkspaceSettingsSection />);
    expect(screen.queryByPlaceholderText("Paste a GitHub token")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "GitHub token" }));
    expect(screen.getByPlaceholderText("Paste a GitHub token")).toBeInTheDocument();
  });

  it("shows the stored Claude flags and writes edits back to the store", () => {
    useSettingsStore.setState({ claudeFlags: "--model opus" });
    render(<WorkspaceSettingsSection />);
    const input = screen.getByLabelText("Claude Code flags");
    expect(input).toHaveValue("--model opus");
    fireEvent.change(input, { target: { value: "--resume" } });
    expect(useSettingsStore.getState().claudeFlags).toBe("--resume");
  });

  it("writes Codex flag edits back to the store", () => {
    render(<WorkspaceSettingsSection />);
    const input = screen.getByLabelText("Codex flags");
    fireEvent.change(input, { target: { value: "--full-auto" } });
    expect(useSettingsStore.getState().codexFlags).toBe("--full-auto");
  });
});
