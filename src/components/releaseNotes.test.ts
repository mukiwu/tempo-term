import { describe, expect, it } from "vitest";
import { separateLanguageSections } from "./releaseNotes";

describe("separateLanguageSections", () => {
  it("inserts a divider before each language block after the first", () => {
    const notes = ["## English", "", "- a", "", "## 正體中文", "", "- b"].join("\n");

    const result = separateLanguageSections(notes);

    // A thematic break (---) sits between the two top-level sections...
    expect(result).toContain("\n---\n");
    // ...specifically right before the second language heading.
    expect(result).toMatch(/---\n+## 正體中文/);
    // ...and never before the first.
    expect(result.indexOf("---")).toBeGreaterThan(result.indexOf("## English"));
  });
});
