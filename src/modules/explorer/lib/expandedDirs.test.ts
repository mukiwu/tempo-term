import { describe, it, expect } from "vitest";
import {
  forgetDir,
  forgetRoot,
  isDirRemembered,
  rememberDir,
  MAX_DIRS_PER_ROOT,
  MAX_ROOTS,
  type ExpandedDirs,
} from "./expandedDirs";

describe("expandedDirs", () => {
  it("remembers a folder under its root and reads it back", () => {
    const map = rememberDir({}, "/root", "/root/src");
    expect(isDirRemembered(map, "/root", "/root/src")).toBe(true);
    expect(isDirRemembered(map, "/root", "/root/docs")).toBe(false);
  });

  it("scopes the lookup to the root, so an unrelated root never sees it", () => {
    const map = rememberDir({}, "/root-a", "/shared/src");
    expect(isDirRemembered(map, "/root-b", "/shared/src")).toBe(false);
  });

  it("treats a null root (no folder open) as remembering nothing", () => {
    expect(rememberDir({}, null, "/x")).toEqual({});
    expect(isDirRemembered({ "/root": ["/root/src"] }, null, "/root/src")).toBe(false);
  });

  it("returns the same object when re-remembering the most recent folder", () => {
    const map = rememberDir({}, "/root", "/root/src");
    expect(rememberDir(map, "/root", "/root/src")).toBe(map);
  });

  it("does not duplicate a folder remembered twice", () => {
    let map = rememberDir({}, "/root", "/root/src");
    map = rememberDir(map, "/root", "/root/docs");
    map = rememberDir(map, "/root", "/root/src");
    expect(map["/root"]).toEqual(["/root/docs", "/root/src"]);
  });

  it("drops the least recently opened folder past the per-root cap", () => {
    let map: ExpandedDirs = {};
    for (let i = 0; i < MAX_DIRS_PER_ROOT + 5; i += 1) {
      map = rememberDir(map, "/root", `/root/dir-${i}`);
    }
    expect(map["/root"]).toHaveLength(MAX_DIRS_PER_ROOT);
    expect(isDirRemembered(map, "/root", "/root/dir-0")).toBe(false);
    expect(isDirRemembered(map, "/root", `/root/dir-${MAX_DIRS_PER_ROOT + 4}`)).toBe(true);
  });

  it("drops the oldest root past the root cap, always keeping the one just written", () => {
    let map: ExpandedDirs = {};
    for (let i = 0; i < MAX_ROOTS + 3; i += 1) {
      map = rememberDir(map, `/root-${i}`, `/root-${i}/src`);
    }
    expect(Object.keys(map)).toHaveLength(MAX_ROOTS);
    expect(map["/root-0"]).toBeUndefined();
    expect(map[`/root-${MAX_ROOTS + 2}`]).toBeDefined();
  });

  it("forgets a single collapsed folder and leaves its siblings alone", () => {
    let map = rememberDir({}, "/root", "/root/src");
    map = rememberDir(map, "/root", "/root/docs");
    map = forgetDir(map, "/root", "/root/src");
    expect(map["/root"]).toEqual(["/root/docs"]);
  });

  it("returns the same object when forgetting something it never remembered", () => {
    const map = rememberDir({}, "/root", "/root/src");
    expect(forgetDir(map, "/root", "/root/nope")).toBe(map);
    expect(forgetDir(map, "/other", "/root/src")).toBe(map);
  });

  it("forgets a whole root without touching the others", () => {
    let map = rememberDir({}, "/root-a", "/root-a/src");
    map = rememberDir(map, "/root-b", "/root-b/src");
    map = forgetRoot(map, "/root-a");
    expect(map["/root-a"]).toBeUndefined();
    expect(map["/root-b"]).toEqual(["/root-b/src"]);
  });

  it("returns the same object when forgetting an unknown root", () => {
    const map = rememberDir({}, "/root", "/root/src");
    expect(forgetRoot(map, "/other")).toBe(map);
    expect(forgetRoot(map, null)).toBe(map);
  });
});
