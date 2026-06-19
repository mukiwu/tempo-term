import { describe, expect, it } from "vitest";
import { decideExternalChange } from "./notesExternalChange";

const base = {
  notePath: "/root/a.md",
  changedPaths: ["/root/a.md"],
  dirty: false,
  selfWrite: null,
  now: 10_000,
  selfWriteWindowMs: 2_000,
};

describe("decideExternalChange", () => {
  it("ignores changes that do not touch the open note", () => {
    expect(decideExternalChange({ ...base, changedPaths: ["/root/b.md"] })).toBe("ignore");
  });

  it("ignores the echo of our own recent write", () => {
    expect(
      decideExternalChange({
        ...base,
        selfWrite: { path: "/root/a.md", at: 9_000 },
      }),
    ).toBe("ignore");
  });

  it("reloads when the file changed externally and there are no unsaved edits", () => {
    expect(decideExternalChange(base)).toBe("reload");
  });

  it("prompts when the file changed externally and there are unsaved edits", () => {
    expect(decideExternalChange({ ...base, dirty: true })).toBe("prompt");
  });

  it("does not treat a stale self-write as our echo", () => {
    expect(
      decideExternalChange({
        ...base,
        selfWrite: { path: "/root/a.md", at: 1_000 },
      }),
    ).toBe("reload");
  });

  it("treats a self-write to a different path as not our echo", () => {
    expect(
      decideExternalChange({
        ...base,
        dirty: true,
        selfWrite: { path: "/root/other.md", at: 9_500 },
      }),
    ).toBe("prompt");
  });
});
