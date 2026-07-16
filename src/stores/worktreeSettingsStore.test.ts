import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_COPY_GLOBS, useWorktreeSettingsStore } from "./worktreeSettingsStore";

const store = () => useWorktreeSettingsStore.getState();

beforeEach(() => useWorktreeSettingsStore.setState({ byRepo: {} }));

describe("worktreeSettingsStore", () => {
  it("returns empty settings for a repo it has never seen", () => {
    expect(store().repoSettings("/repo")).toEqual({});
  });

  it("merges a patch instead of replacing the repo's settings", () => {
    // The create dialog saves one field at a time; a replace would silently drop
    // the setup command the moment the user picked an agent.
    store().setRepoSettings("/repo", { setupCommand: "pnpm install" });
    store().setRepoSettings("/repo", { lastAgent: "codex" });

    expect(store().repoSettings("/repo")).toEqual({
      setupCommand: "pnpm install",
      lastAgent: "codex",
    });
  });

  it("keeps repos independent", () => {
    store().setRepoSettings("/a", { setupCommand: "pnpm install" });
    store().setRepoSettings("/b", { setupCommand: "cargo build" });

    expect(store().repoSettings("/a").setupCommand).toBe("pnpm install");
    expect(store().repoSettings("/b").setupCommand).toBe("cargo build");
  });

  it("forgets a repo", () => {
    store().setRepoSettings("/repo", { setupCommand: "pnpm install" });
    store().forgetRepo("/repo");

    expect(store().repoSettings("/repo")).toEqual({});
  });

  it("defaults the copy globs recursively, so a monorepo's package .env files come across", () => {
    expect(DEFAULT_COPY_GLOBS).toEqual(["**/.env*"]);
  });
});
