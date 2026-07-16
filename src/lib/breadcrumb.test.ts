import { describe, expect, it } from "vitest";
import { buildCrumbs } from "./breadcrumb";

describe("buildCrumbs", () => {
  it("starts at the workspace root's name for a path inside the workspace", () => {
    const crumbs = buildCrumbs("/Users/muki/Documents/01.project/tempo-term/src/lib", {
      workspaceRoot: "/Users/muki/Documents/01.project/tempo-term",
      homeDir: "/Users/muki",
    });

    expect(crumbs).toEqual([
      { label: "tempo-term", path: "/Users/muki/Documents/01.project/tempo-term" },
      { label: "src", path: "/Users/muki/Documents/01.project/tempo-term/src" },
      { label: "lib", path: "/Users/muki/Documents/01.project/tempo-term/src/lib" },
    ]);
  });

  it("falls back to home-relative (home itself omitted) outside the workspace", () => {
    const crumbs = buildCrumbs("/Users/muki/Downloads/assets", {
      workspaceRoot: "/Users/muki/Documents/01.project/tempo-term",
      homeDir: "/Users/muki",
    });

    expect(crumbs).toEqual([
      { label: "Downloads", path: "/Users/muki/Downloads" },
      { label: "assets", path: "/Users/muki/Downloads/assets" },
    ]);
  });

  it("shows the full absolute path outside home", () => {
    const crumbs = buildCrumbs("/opt/homebrew/bin", {
      workspaceRoot: "/Users/muki/Documents/01.project/tempo-term",
      homeDir: "/Users/muki",
    });

    expect(crumbs).toEqual([
      { label: "opt", path: "/opt" },
      { label: "homebrew", path: "/opt/homebrew" },
      { label: "bin", path: "/opt/homebrew/bin" },
    ]);
  });

  it("shows a ~ crumb when the path is home itself", () => {
    const crumbs = buildCrumbs("/Users/muki", {
      workspaceRoot: "/Users/muki/Documents/01.project/tempo-term",
      homeDir: "/Users/muki",
    });

    expect(crumbs).toEqual([{ label: "~", path: "/Users/muki" }]);
  });

  it("shows just the root crumb when the path is the workspace root itself", () => {
    const crumbs = buildCrumbs("/Users/muki/Documents/01.project/tempo-term/", {
      workspaceRoot: "/Users/muki/Documents/01.project/tempo-term",
      homeDir: "/Users/muki",
    });

    expect(crumbs).toEqual([
      { label: "tempo-term", path: "/Users/muki/Documents/01.project/tempo-term" },
    ]);
  });

  it("handles Windows backslash paths inside the workspace", () => {
    const crumbs = buildCrumbs("C:\\work\\tempo-term\\src", {
      workspaceRoot: "C:\\work\\tempo-term",
      homeDir: "C:\\Users\\muki",
    });

    expect(crumbs).toEqual([
      { label: "tempo-term", path: "C:\\work\\tempo-term" },
      { label: "src", path: "C:\\work\\tempo-term\\src" },
    ]);
  });

  it("keeps the drive letter as the first crumb for Windows paths outside home", () => {
    const crumbs = buildCrumbs("C:\\Windows\\System32", {
      workspaceRoot: "C:\\work\\tempo-term",
      homeDir: "C:\\Users\\muki",
    });

    expect(crumbs).toEqual([
      { label: "C:", path: "C:" },
      { label: "Windows", path: "C:\\Windows" },
      { label: "System32", path: "C:\\Windows\\System32" },
    ]);
  });
});
