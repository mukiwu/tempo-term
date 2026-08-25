/**
 * File types the built-in browser (a real WebView) renders on its own. Source
 * files, archives and binaries are deliberately absent: the WebView would show
 * them as raw text or refuse them outright, so the explorer hides "Open in
 * Browser" for those and the editor stays the way to look at them.
 */
const PREVIEWABLE_EXTENSIONS = new Set([
  // Documents the WebView renders as pages.
  "html",
  "htm",
  "xhtml",
  "svg",
  "pdf",
  // Images.
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "avif",
  "bmp",
  "ico",
  // Media the WebView has a built-in player for.
  "mp4",
  "webm",
  "mp3",
  "wav",
  "ogg",
]);

/**
 * Whether the built-in browser can render this file. Extension-based (the
 * explorer has no file contents to sniff), case-insensitive, and false for
 * extension-less files and dotfiles like `.env` — a leading dot is the name,
 * not a suffix.
 */
export function isBrowserPreviewable(path: string): boolean {
  const name = path.split(/[\\/]/).pop() ?? "";
  const dot = name.lastIndexOf(".");
  if (dot <= 0) {
    return false;
  }
  return PREVIEWABLE_EXTENSIONS.has(name.slice(dot + 1).toLowerCase());
}
