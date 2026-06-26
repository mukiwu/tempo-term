/**
 * True when `href` is a URL we should hand to the system browser / mail client
 * (http, https, or mailto). Local file paths and relative links return false.
 */
export function isWebUrl(href: string): boolean {
  return /^(https?|mailto):/i.test(href.trim());
}

/**
 * True when `href` is an http(s) URL pointing at the local machine (localhost,
 * loopback, or any IPv4 host). These are the URLs worth opening in the in-app
 * preview rather than the system browser, and which allow being framed.
 */
export function isLocalUrl(href: string): boolean {
  try {
    const { hostname } = new URL(href.trim());
    return (
      hostname === "localhost" ||
      hostname === "0.0.0.0" ||
      hostname === "::1" ||
      /^(?:\d{1,3}\.){3}\d{1,3}$/.test(hostname)
    );
  } catch {
    return false;
  }
}
