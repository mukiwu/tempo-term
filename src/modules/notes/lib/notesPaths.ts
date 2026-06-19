/**
 * Pure helpers for mapping between note titles and the `.md` filenames that
 * back them on disk, plus detection of cloud-provider conflict copies. No
 * filesystem access here so the rules stay unit-testable.
 */

// Characters that are illegal in filenames on common platforms, plus control
// characters. Replaced with a dash so a title always yields a usable filename.
// Spaces are intentionally preserved.
// eslint-disable-next-line no-control-regex
const ILLEGAL_NAME_CHARS = /[/\\:*?"<>|\x00-\x1f]/g;

const MD_SUFFIX = /\.md$/i;

/** Drop a trailing `.md` (case-insensitive); other names are left as-is. */
export function titleFromFilename(filename: string): string {
  return filename.replace(MD_SUFFIX, "");
}

/** Make a string safe to use as a single path segment. */
export function sanitizeName(name: string): string {
  const cleaned = name.replace(ILLEGAL_NAME_CHARS, "-").trim();
  return cleaned === "" ? "Untitled" : cleaned;
}

/** Sanitize a note title and give it a single `.md` extension. */
export function fileNameForTitle(title: string): string {
  return `${sanitizeName(title)}.md`;
}

// Dropbox/Box write "... conflicted copy ..."; Syncthing writes
// ".sync-conflict-<timestamp>-...". Kept conservative to avoid flagging
// ordinary names that merely contain the word "conflict".
const CONFLICT_PATTERNS = [/conflicted copy/i, /\.sync-conflict-/i];

/** True when a filename looks like a cloud-sync conflict copy. */
export function isConflictCopy(filename: string): boolean {
  return CONFLICT_PATTERNS.some((re) => re.test(filename));
}
