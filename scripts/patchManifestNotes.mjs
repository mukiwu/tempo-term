import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Re-inject the changelog into an updater manifest's `notes`.
 *
 * The Windows CI's tauri-action regenerates latest.json to add the Windows
 * platforms, but in doing so it wipes the `notes` field that the macOS release
 * embedded from the changelog. The in-app updater renders `notes`, so this
 * restores it after that step. A blank changelog leaves the existing notes
 * untouched (so a missing file can't blank a good manifest).
 *
 * @param {Record<string, unknown>} manifest
 * @param {string} notes
 * @returns {Record<string, unknown>}
 */
export function patchManifestNotes(manifest, notes) {
  const trimmed = notes.trim();
  if (!trimmed) {
    return manifest;
  }
  return { ...manifest, notes: trimmed };
}

// CLI: node scripts/patchManifestNotes.mjs <manifestPath> <changelogPath>
// Rewrites the manifest in place with the changelog folded into `notes`.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [manifestPath, changelogPath] = process.argv.slice(2);
  if (!manifestPath || !changelogPath) {
    process.stderr.write("usage: patchManifestNotes.mjs <manifestPath> <changelogPath>\n");
    process.exit(1);
  }

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const notes = readFileSync(changelogPath, "utf8");
  const patched = patchManifestNotes(manifest, notes);
  writeFileSync(manifestPath, `${JSON.stringify(patched, null, 2)}\n`);
}
