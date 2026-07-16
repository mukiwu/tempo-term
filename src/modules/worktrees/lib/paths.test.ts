import { describe, expect, it } from "vitest";
import { isUnder } from "./paths";

describe("isUnder", () => {
  it("counts a directory as under itself", () => {
    // A terminal sitting exactly at the worktree root belongs to that worktree.
    expect(isUnder("/a/b", "/a/b", false)).toBe(true);
  });

  it("matches a nested directory", () => {
    expect(isUnder("/a/b/src/deep", "/a/b", false)).toBe(true);
  });

  it("does not match a sibling that merely shares the prefix", () => {
    // The whole feature puts worktrees in `<repo>-worktrees/`, so a plain
    // startsWith would report every worktree as living inside the repo itself.
    expect(isUnder("/a/b-worktrees/feature", "/a/b", false)).toBe(false);
    expect(isUnder("/a/bc", "/a/b", false)).toBe(false);
  });

  it("does not match a parent or an unrelated path", () => {
    expect(isUnder("/a", "/a/b", false)).toBe(false);
    expect(isUnder("/x/y", "/a/b", false)).toBe(false);
  });

  it("ignores trailing slashes on either side", () => {
    expect(isUnder("/a/b/", "/a/b", false)).toBe(true);
    expect(isUnder("/a/b/src", "/a/b/", false)).toBe(true);
    expect(isUnder("/a/b//", "/a/b", false)).toBe(true);
  });

  it("is case-sensitive off Windows", () => {
    expect(isUnder("/A/b", "/a/b", false)).toBe(false);
  });

  it("treats separators interchangeably on Windows", () => {
    // The pty reports one form and canonicalize another; both must match.
    expect(isUnder("C:\\src\\repo\\pkg", "C:\\src\\repo", true)).toBe(true);
    expect(isUnder("C:/src/repo/pkg", "C:\\src\\repo", true)).toBe(true);
    expect(isUnder("C:\\src\\repo", "C:/src/repo", true)).toBe(true);
  });

  it("is case-insensitive on Windows", () => {
    // Windows paths are case-insensitive; comparing them case-sensitively would
    // silently drop panes from their worktree.
    expect(isUnder("C:\\Src\\Repo\\Pkg", "c:\\src\\repo", true)).toBe(true);
  });

  it("still rejects a prefix sibling on Windows", () => {
    expect(isUnder("C:\\src\\repo-worktrees\\x", "C:\\src\\repo", true)).toBe(false);
  });

  it("rejects empty input rather than matching everything", () => {
    expect(isUnder("/a/b", "", false)).toBe(false);
    expect(isUnder("", "/a/b", false)).toBe(false);
  });

  it("treats the filesystem root as a real directory", () => {
    // "/" trims to the empty string; if that collapses into "no path", the root
    // stops containing anything at all.
    expect(isUnder("/a/b", "/", false)).toBe(true);
    expect(isUnder("/", "/", false)).toBe(true);
    // ...and the prefix must not become "//".
    expect(isUnder("//a", "/", false)).toBe(true);
  });

  it("handles a Windows drive root", () => {
    expect(isUnder("C:\\src", "C:\\", true)).toBe(true);
    expect(isUnder("C:\\", "C:\\", true)).toBe(true);
  });
});
