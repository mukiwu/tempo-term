/**
 * True when `href` is a URL we should hand to the system browser / mail client
 * (http, https, or mailto). Local file paths and relative links return false.
 */
export function isWebUrl(href: string): boolean {
  return /^(https?|mailto):/i.test(href.trim());
}

/** True for a hostname on the local machine (localhost, loopback, or IPv4). */
function isLocalHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "0.0.0.0" ||
    hostname === "::1" ||
    /^(?:\d{1,3}\.){3}\d{1,3}$/.test(hostname)
  );
}

/**
 * True when `href` is an http(s) URL pointing at the local machine (localhost,
 * loopback, or any IPv4 host). These are the URLs worth opening in the in-app
 * preview rather than the system browser, and which allow being framed.
 */
export function isLocalUrl(href: string): boolean {
  try {
    return isLocalHostname(new URL(href.trim()).hostname);
  } catch {
    return false;
  }
}

/**
 * Normalize an address-bar entry into a url the preview can load. A bare host
 * like "google.com.tw" or "localhost:3000" has no scheme, so the webview treats
 * it as a relative path and shows a blank page; add the scheme the host implies
 * (http for localhost/loopback/IPv4 dev servers, https otherwise). Inputs that
 * already carry a scheme (http://, https://, file://) or are absolute file
 * paths (Unix "/Users/...", Windows "C:\..." or "\\unc") pass through untouched.
 */
export function normalizeAddressInput(input: string): string {
  const value = input.trim();
  if (
    value === "" ||
    value.startsWith("/") ||
    value.startsWith("\\") ||
    /^[a-z]:[\\/]/i.test(value) ||
    /^[a-z][a-z0-9+.-]*:\/\//i.test(value)
  ) {
    return value;
  }
  // Isolate the authority (drop any path/query/fragment, then userinfo) before
  // reading the hostname, so a "?"/"@" in a query can't be mistaken for the host.
  const authority = value.split(/[/?#]/)[0];
  const host = (authority.split("@").pop() ?? authority).split(":")[0];
  return `${isLocalHostname(host) ? "http" : "https"}://${value}`;
}
