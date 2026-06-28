import { describe, expect, it } from "vitest";
import { externalChangeAction, manualReloadAction, shouldReloadFromDisk } from "./reload";

describe("shouldReloadFromDisk", () => {
  it("reloads when no buffer is open yet", () => {
    expect(shouldReloadFromDisk(undefined)).toBe(true);
  });

  it("reloads a clean buffer so external edits show up on reopen", () => {
    expect(shouldReloadFromDisk({ content: "v1", baseline: "v1" })).toBe(true);
  });

  it("keeps a dirty buffer so unsaved edits are not clobbered", () => {
    expect(shouldReloadFromDisk({ content: "edited", baseline: "v1" })).toBe(false);
  });
});

describe("manualReloadAction", () => {
  it("reloads straight away when no buffer is open", () => {
    expect(manualReloadAction(undefined)).toBe("reload");
  });

  it("reloads a clean buffer without prompting", () => {
    expect(manualReloadAction({ content: "v1", baseline: "v1" })).toBe("reload");
  });

  it("confirms first when the buffer has unsaved edits, so they are not silently discarded", () => {
    expect(manualReloadAction({ content: "edited", baseline: "v1" })).toBe("confirm");
  });
});

describe("externalChangeAction", () => {
  it("ignores a change caused by our own save, even on a clean or dirty buffer", () => {
    expect(externalChangeAction({ content: "v1", baseline: "v1" }, true)).toBe("ignore");
    expect(externalChangeAction({ content: "edited", baseline: "v1" }, true)).toBe("ignore");
  });

  it("auto-reloads a clean (or not-yet-open) buffer changed by something else", () => {
    expect(externalChangeAction({ content: "v1", baseline: "v1" }, false)).toBe("reload");
    expect(externalChangeAction(undefined, false)).toBe("reload");
  });

  it("flags a conflict when a dirty buffer changes on disk, so unsaved edits are kept", () => {
    expect(externalChangeAction({ content: "edited", baseline: "v1" }, false)).toBe("flag");
  });
});
