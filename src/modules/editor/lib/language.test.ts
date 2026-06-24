import { describe, expect, it } from "vitest";
import { languageIdForPath, languageLabel } from "./language";

describe("languageIdForPath", () => {
  it("maps JavaScript and TypeScript family extensions", () => {
    expect(languageIdForPath("src/App.tsx")).toBe("javascript");
    expect(languageIdForPath("a.ts")).toBe("javascript");
    expect(languageIdForPath("b.jsx")).toBe("javascript");
    expect(languageIdForPath("c.mjs")).toBe("javascript");
  });

  it("maps common data and markup formats", () => {
    expect(languageIdForPath("package.json")).toBe("json");
    expect(languageIdForPath("index.html")).toBe("html");
    expect(languageIdForPath("styles.css")).toBe("css");
    expect(languageIdForPath("README.md")).toBe("markdown");
  });

  it("maps systems and scripting languages", () => {
    expect(languageIdForPath("main.rs")).toBe("rust");
    expect(languageIdForPath("script.py")).toBe("python");
  });

  it("is case insensitive on the extension", () => {
    expect(languageIdForPath("Component.TSX")).toBe("javascript");
    expect(languageIdForPath("DATA.JSON")).toBe("json");
  });

  it("falls back to plaintext for unknown or missing extensions", () => {
    expect(languageIdForPath("Makefile")).toBe("plaintext");
    expect(languageIdForPath("notes.xyz")).toBe("plaintext");
    expect(languageIdForPath("/path/to/file")).toBe("plaintext");
  });
});

describe("languageLabel", () => {
  it("returns text for an extensionless path that contains uppercase letters", () => {
    expect(languageLabel("/home/user/README")).toBe("text");
  });

  it("returns the lowercased extension for a normal path", () => {
    expect(languageLabel("src/main.go")).toBe("go");
    expect(languageLabel("src/Component.TSX")).toBe("tsx");
  });

  it("uses the last extension for multi-dot names", () => {
    expect(languageLabel("archive.tar.gz")).toBe("gz");
  });

  it("returns text for dotfiles and trailing-dot names", () => {
    expect(languageLabel(".bashrc")).toBe("text");
    expect(languageLabel("weird.")).toBe("text");
  });
});
