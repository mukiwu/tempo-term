/** Normalize an absolute Windows drive path, or return null for other paths. */
export function normalizeWindowsDrivePath(path: string): string | null {
  const normalized = path.replace(/\\/g, "/").replace(/^\/(?=[a-zA-Z]:\/)/, "");
  return /^[a-zA-Z]:\//.test(normalized) ? normalized : null;
}
