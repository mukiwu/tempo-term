import { describe, expect, it } from "vitest";

// @ts-expect-error - plain .mjs release helper, no type declarations
import { patchManifestNotes } from "./patchManifestNotes.mjs";

const MERGED_MANIFEST = {
  version: "0.0.7",
  notes: "",
  pub_date: "2026-06-22T17:03:26.650Z",
  platforms: {
    "darwin-aarch64": { signature: "mac-sig", url: "https://example.com/mac.tar.gz" },
    "windows-x86_64": { signature: "win-sig", url: "https://example.com/win.exe" },
  },
};

describe("patchManifestNotes", () => {
  it("restores the changelog into notes while keeping the merged platforms", () => {
    const result = patchManifestNotes(MERGED_MANIFEST, "## What's new\n- feat: a thing\n");

    expect(result.notes).toBe("## What's new\n- feat: a thing");
    expect(result.platforms).toEqual(MERGED_MANIFEST.platforms);
    expect(result.version).toBe("0.0.7");
  });

  it("leaves existing notes untouched when the changelog is blank", () => {
    const manifest = { ...MERGED_MANIFEST, notes: "keep me" };
    expect(patchManifestNotes(manifest, "   \n  ").notes).toBe("keep me");
  });
});
