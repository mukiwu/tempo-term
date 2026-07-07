/**
 * Turns a session title into a filesystem-safe filename stem for the
 * export save dialog's default path. Lowercases, collapses every run of
 * non-letter/non-digit characters into a single "-", trims leading/trailing
 * dashes, and caps the result at 60 characters. Unicode letters and digits
 * are kept (`\p{L}`/`\p{N}`), so a Chinese/Japanese/Korean title keeps its
 * characters instead of collapsing to "session" — zh-Hant is a first-class
 * locale. Only a title with no letters or digits at all (all-punctuation,
 * all-emoji, empty) falls back to "session" so the dialog never offers a
 * blank filename. Path separators (not letters/digits) are dropped, so the
 * stem can't introduce directories.
 */
export function slugifyTitle(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    // Cap by characters, not code units, so a multi-byte CJK title isn't cut
    // mid-character; then trim any dash the cap left dangling.
    .split("")
    .slice(0, 60)
    .join("")
    .replace(/-+$/g, "");
  return slug || "session";
}
