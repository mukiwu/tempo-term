import { describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import { gitPull } from "./gitGraphBridge";
import { useSettingsStore } from "@/stores/settingsStore";

describe("gitPull", () => {
  it("passes the pull mode from settings", async () => {
    useSettingsStore.setState({ gitPullMode: "ff-only" });
    await gitPull("/repo", "origin", "main");
    expect(invoke).toHaveBeenCalledWith("git_pull", {
      repoPath: "/repo",
      remote: "origin",
      branch: "main",
      mode: "ff-only",
    });
  });
});
