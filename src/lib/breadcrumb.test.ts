import { describe, expect, it } from "vitest";
import { buildCrumbs } from "./breadcrumb";

describe("buildCrumbs", () => {
  it("shows the full home-relative trail (home itself omitted)", () => {
    const crumbs = buildCrumbs("/Users/muki/Documents/01.project/tempo-term", {
      homeDir: "/Users/muki",
    });

    expect(crumbs).toEqual([
      { label: "Documents", path: "/Users/muki/Documents" },
      { label: "01.project", path: "/Users/muki/Documents/01.project" },
      { label: "tempo-term", path: "/Users/muki/Documents/01.project/tempo-term" },
    ]);
  });

  it("shows the full absolute path outside home", () => {
    const crumbs = buildCrumbs("/opt/homebrew/bin", {
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
      homeDir: "/Users/muki",
    });

    expect(crumbs).toEqual([{ label: "~", path: "/Users/muki" }]);
  });

  it("ignores trailing slashes", () => {
    const crumbs = buildCrumbs("/Users/muki/Documents/", {
      homeDir: "/Users/muki",
    });

    expect(crumbs).toEqual([{ label: "Documents", path: "/Users/muki/Documents" }]);
  });

  it("handles Windows backslash paths under home", () => {
    const crumbs = buildCrumbs("C:\\Users\\muki\\work\\tempo-term", {
      homeDir: "C:\\Users\\muki",
    });

    expect(crumbs).toEqual([
      { label: "work", path: "C:\\Users\\muki\\work" },
      { label: "tempo-term", path: "C:\\Users\\muki\\work\\tempo-term" },
    ]);
  });

  it("treats a bare-root home (/) as absolute display, never producing // paths", () => {
    const crumbs = buildCrumbs("/opt/homebrew", {
      homeDir: "/",
    });

    expect(crumbs).toEqual([
      { label: "opt", path: "/opt" },
      { label: "homebrew", path: "/opt/homebrew" },
    ]);
  });

  it("preserves the double-backslash prefix of a UNC path", () => {
    const crumbs = buildCrumbs("\\\\wsl$\\Ubuntu\\home", {
      homeDir: "C:\\Users\\muki",
    });

    expect(crumbs).toEqual([
      { label: "wsl$", path: "\\\\wsl$" },
      { label: "Ubuntu", path: "\\\\wsl$\\Ubuntu" },
      { label: "home", path: "\\\\wsl$\\Ubuntu\\home" },
    ]);
  });

  it("keeps the drive letter as the first crumb for Windows paths outside home", () => {
    const crumbs = buildCrumbs("C:\\Windows\\System32", {
      homeDir: "C:\\Users\\muki",
    });

    // "C:" on its own means the *current directory* on drive C:, not its root.
    // Only "C:\" reaches the root, so the crumb has to carry the separator —
    // without doubling it into the paths built on top of it.
    expect(crumbs).toEqual([
      { label: "C:", path: "C:\\" },
      { label: "Windows", path: "C:\\Windows" },
      { label: "System32", path: "C:\\Windows\\System32" },
    ]);
  });

  it("gives a bare Windows drive root a trailing separator", () => {
    expect(buildCrumbs("C:\\", { homeDir: "C:\\Users\\muki" })).toEqual([
      { label: "C:", path: "C:\\" },
    ]);
    expect(buildCrumbs("D:", { homeDir: "C:\\Users\\muki" })).toEqual([
      { label: "D:", path: "D:\\" },
    ]);
  });

  it("roots a Windows path even when home is unknown", () => {
    expect(buildCrumbs("D:\\code", { homeDir: null })).toEqual([
      { label: "D:", path: "D:\\" },
      { label: "code", path: "D:\\code" },
    ]);
  });

  it("leaves a drive-rooted home alone (the trail below it needs no re-rooting)", () => {
    const crumbs = buildCrumbs("C:\\Users\\muki", { homeDir: "C:\\" });

    expect(crumbs).toEqual([
      { label: "Users", path: "C:\\Users" },
      { label: "muki", path: "C:\\Users\\muki" },
    ]);
  });

  it("roots the ~ crumb too when home itself is a drive root", () => {
    expect(buildCrumbs("C:\\", { homeDir: "C:\\" })).toEqual([{ label: "~", path: "C:\\" }]);
  });
});
