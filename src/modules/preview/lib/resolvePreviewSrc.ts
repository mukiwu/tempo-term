// The webview loads local files through Tauri's asset protocol. On macOS/Linux
// that scheme is `asset://localhost/<path>` (Windows/Android use
// `http://asset.localhost/`, which this macOS app never hits).
const ASSET_ORIGIN = "asset://localhost";

function fileUrlToPath(url: string): string {
  const withoutScheme = url.replace(/^file:\/\//i, "");
  try {
    return decodeURIComponent(withoutScheme);
  } catch {
    return withoutScheme;
  }
}

/**
 * Build an asset-protocol URL for an absolute file path.
 *
 * Tauri's asset handler resolves the file from `request.uri().path()[1..]` (it
 * strips exactly the URL's structural leading "/") and then percent-decodes it.
 * So the path's OWN leading slash must be sent as `%2F` — a literal leading
 * slash gets stripped, turning `/Users/x` into the relative `Users/x`, which
 * `File::open` then fails to find (the 404 we hit). The `%2F` survives the strip
 * and decodes back to `/`, yielding the correct absolute path.
 *
 * Inner separators stay literal (segments encoded, slashes kept) so the iframe
 * uses this URL as a real base and a previewed page's relative CSS/JS/images
 * resolve to their sibling files. (Tauri's `convertFileSrc` percent-encodes the
 * whole path into one segment, which collapses the base dir and breaks every
 * relative reference.)
 */
function toAssetUrl(path: string): string {
  const segments = path.split("/").filter((seg) => seg !== "").map(encodeURIComponent);
  return `${ASSET_ORIGIN}/%2F${segments.join("/")}`;
}

/**
 * Turn whatever lands in the preview's address bar (a typed path, a typed URL,
 * or a dropped file's `file://` url) into a src the WebView's iframe can load.
 *
 * WKWebView refuses to load raw `file://` from the app's own (custom-scheme)
 * origin, so local paths must go through the asset protocol. Real web URLs and
 * already-converted asset URLs pass through untouched.
 */
export function resolvePreviewSrc(input: string): string {
  const value = input.trim();
  if (value.startsWith("file://")) {
    return toAssetUrl(fileUrlToPath(value));
  }
  if (value.startsWith("/")) {
    return toAssetUrl(value);
  }
  return value;
}
