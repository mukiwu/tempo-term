import { describe, expect, it } from "vitest";
import {
  languageDescriptionForPath,
  languageLabel,
  loadLanguageExtension,
} from "./language";

describe("loadLanguageExtension", () => {
  it("returns an empty extension list for unknown files", async () => {
    expect(await loadLanguageExtension("notes.xyz")).toEqual([]);
  });

  it("loads a language support extension for a known file", async () => {
    const ext = await loadLanguageExtension("a.ts");
    expect(ext.length).toBeGreaterThan(0);
  });
});

describe("languageDescriptionForPath", () => {
  it("recognizes .vue via the bundled language registry", () => {
    expect(languageDescriptionForPath("src/components/App.vue")?.name).toBe("Vue");
  });

  it("recognizes languages that the old static map never covered", () => {
    expect(languageDescriptionForPath("main.go")?.name).toBe("Go");
    expect(languageDescriptionForPath("schema.sql")?.name).toBe("SQL");
    expect(languageDescriptionForPath("config.yaml")?.name).toBe("YAML");
  });

  it("still resolves the languages bundled before", () => {
    expect(languageDescriptionForPath("a.ts")?.name).toBe("TypeScript");
    expect(languageDescriptionForPath("styles.css")?.name).toBe("CSS");
    expect(languageDescriptionForPath("main.rs")?.name).toBe("Rust");
  });

  it("returns null for unknown or extensionless paths", () => {
    expect(languageDescriptionForPath("notes.xyz")).toBeNull();
    expect(languageDescriptionForPath("Makefile")).toBeNull();
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
