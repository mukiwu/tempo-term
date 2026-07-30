import { describe, expect, it } from "vitest";
import { getTheme } from "@/themes/themes";
import { terminalThemeWithBackground } from "./backgroundTheme";

describe("terminalThemeWithBackground", () => {
  it("returns the normal opaque theme without a configured background", () => {
    expect(terminalThemeWithBackground("vitesse-dark", false)).toBe(
      getTheme("vitesse-dark").terminal,
    );
  });

  it("uses a readable translucent surface for dark and light themes", () => {
    expect(terminalThemeWithBackground("vitesse-dark", true).background).toBe(
      "rgba(34, 34, 34, 0.82)",
    );
    expect(terminalThemeWithBackground("vitesse-light", true).background).toContain("0.88");
  });
});
