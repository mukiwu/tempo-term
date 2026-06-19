import { describe, expect, it } from "vitest";
import {
  fileNameForTitle,
  isConflictCopy,
  sanitizeName,
  titleFromFilename,
} from "./notesPaths";

describe("titleFromFilename", () => {
  it("strips a trailing .md (case-insensitive)", () => {
    expect(titleFromFilename("My Note.md")).toBe("My Note");
    expect(titleFromFilename("Plan.MD")).toBe("Plan");
  });

  it("leaves non-md names intact", () => {
    expect(titleFromFilename("a.txt")).toBe("a.txt");
    expect(titleFromFilename("README")).toBe("README");
  });
});

describe("sanitizeName", () => {
  it("replaces filesystem-illegal characters with a dash", () => {
    expect(sanitizeName("a:b*c")).toBe("a-b-c");
    expect(sanitizeName("a/b\\c")).toBe("a-b-c");
  });

  it("trims and falls back to Untitled when empty", () => {
    expect(sanitizeName("   ")).toBe("Untitled");
    expect(sanitizeName("")).toBe("Untitled");
  });
});

describe("fileNameForTitle", () => {
  it("sanitizes the title and appends a single .md", () => {
    expect(fileNameForTitle("My Note")).toBe("My Note.md");
    expect(fileNameForTitle("a/b")).toBe("a-b.md");
  });

  it("uses Untitled.md for blank titles", () => {
    expect(fileNameForTitle("   ")).toBe("Untitled.md");
  });
});

describe("isConflictCopy", () => {
  it("detects Dropbox-style conflicted copies", () => {
    expect(isConflictCopy("notes (conflicted copy 2024-01-01).md")).toBe(true);
    expect(isConflictCopy("notes (Muki's conflicted copy 2024-01-01).md")).toBe(true);
  });

  it("detects Syncthing-style conflicts", () => {
    expect(isConflictCopy("plan.sync-conflict-20240101-120000-ABCDEF.md")).toBe(true);
  });

  it("returns false for ordinary names", () => {
    expect(isConflictCopy("plan.md")).toBe(false);
    expect(isConflictCopy("my conflict notes.md")).toBe(false);
  });
});
