import { describe, it, expect, vi, afterEach } from "vitest";
import { matchesOpenModifier, openModifierLabel } from "./platform";

type Mods = { altKey?: boolean; metaKey?: boolean; ctrlKey?: boolean };
const ev = (m: Mods) => ({ altKey: false, metaKey: false, ctrlKey: false, ...m });

describe("matchesOpenModifier", () => {
  it("mac: Cmd matches", () => {
    expect(matchesOpenModifier(ev({ metaKey: true }), true)).toBe(true);
  });
  it("mac: Alt matches", () => {
    expect(matchesOpenModifier(ev({ altKey: true }), true)).toBe(true);
  });
  it("mac: Ctrl alone does not match", () => {
    expect(matchesOpenModifier(ev({ ctrlKey: true }), true)).toBe(false);
  });
  it("mac: no modifier does not match", () => {
    expect(matchesOpenModifier(ev({}), true)).toBe(false);
  });
  it("non-mac: Ctrl matches", () => {
    expect(matchesOpenModifier(ev({ ctrlKey: true }), false)).toBe(true);
  });
  it("non-mac: Alt matches", () => {
    expect(matchesOpenModifier(ev({ altKey: true }), false)).toBe(true);
  });
  it("non-mac: Cmd alone does not match", () => {
    expect(matchesOpenModifier(ev({ metaKey: true }), false)).toBe(false);
  });
});

describe("openModifierLabel", () => {
  it("mac label", () => expect(openModifierLabel(true)).toBe("Alt / Cmd"));
  it("non-mac label", () => expect(openModifierLabel(false)).toBe("Alt / Ctrl"));
});

// IS_MAC is evaluated at module load, so each case stubs navigator, resets the
// module registry, and re-imports to observe a fresh evaluation.
describe("IS_MAC platform detection", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  async function loadIsMac(nav: unknown): Promise<boolean> {
    vi.stubGlobal("navigator", nav);
    vi.resetModules();
    const mod = await import("./platform");
    return mod.IS_MAC;
  }

  it("does not throw and falls back to userAgent when platform is undefined", async () => {
    await expect(
      loadIsMac({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X)", platform: undefined }),
    ).resolves.toBe(true);
  });

  it("detects mac via platform when userAgent is missing", async () => {
    await expect(loadIsMac({ platform: "MacIntel" })).resolves.toBe(true);
  });

  it("is false on a non-mac platform", async () => {
    await expect(
      loadIsMac({ userAgent: "Mozilla/5.0 (Windows NT 10.0)", platform: "Win32" }),
    ).resolves.toBe(false);
  });
});

describe("IS_WINDOWS platform detection", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  async function loadIsWindows(nav: unknown): Promise<boolean> {
    vi.stubGlobal("navigator", nav);
    vi.resetModules();
    const mod = await import("./platform");
    return mod.IS_WINDOWS;
  }

  it("detects windows via platform", async () => {
    await expect(loadIsWindows({ platform: "Win32" })).resolves.toBe(true);
  });

  it("falls back to userAgent when platform is undefined", async () => {
    await expect(
      loadIsWindows({ userAgent: "Mozilla/5.0 (Windows NT 10.0)", platform: undefined }),
    ).resolves.toBe(true);
  });

  it("is false on mac", async () => {
    await expect(
      loadIsWindows({ platform: "MacIntel", userAgent: "Mac OS X" }),
    ).resolves.toBe(false);
  });
});
