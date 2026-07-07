/**
 * Turns a session title into a filesystem-safe filename stem for the
 * export save dialog's default path. Lowercases, collapses every run of
 * non-alphanumeric characters into a single "-", trims leading/trailing
 * dashes, and caps the result at 60 characters. A title with no latin
 * letters or digits (all-CJK, all-emoji, empty) collapses to an empty
 * string, which falls back to "session" so the dialog never offers a
 * blank filename.
 */
export function slugifyTitle(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return slug || "session";
}
