import { describe, expect, it } from "vitest";
import { isLocalUrl, isWebUrl, normalizeAddressInput } from "./url";

describe("isWebUrl", () => {
  it("treats an https URL as a web URL", () => {
    expect(isWebUrl("https://example.com")).toBe(true);
  });

  it("treats http and mailto as web URLs", () => {
    expect(isWebUrl("http://example.com/path?q=1")).toBe(true);
    expect(isWebUrl("mailto:hi@example.com")).toBe(true);
    expect(isWebUrl("  https://example.com  ")).toBe(true);
  });

  it("rejects local paths, relative links and non-web schemes", () => {
    expect(isWebUrl("/Users/me/notes/a.md")).toBe(false);
    expect(isWebUrl("./relative/file.txt")).toBe(false);
    expect(isWebUrl("notes/a.md")).toBe(false);
    expect(isWebUrl("file:///Users/me/a.txt")).toBe(false);
    expect(isWebUrl("")).toBe(false);
  });
});

describe("isLocalUrl", () => {
  it("treats localhost and loopback/IP URLs as local (keeping the path)", () => {
    expect(isLocalUrl("http://localhost:3030/gomoku/scene-1")).toBe(true);
    expect(isLocalUrl("http://127.0.0.1:8080")).toBe(true);
    expect(isLocalUrl("http://192.168.1.5/admin")).toBe(true);
    expect(isLocalUrl("https://localhost")).toBe(true);
  });

  it("treats public hosts as not local", () => {
    expect(isLocalUrl("https://example.com")).toBe(false);
    expect(isLocalUrl("https://github.com/foo")).toBe(false);
  });

  it("returns false for non-URLs", () => {
    expect(isLocalUrl("not a url")).toBe(false);
    expect(isLocalUrl("")).toBe(false);
  });
});

describe("normalizeAddressInput", () => {
  it("adds https:// to a bare public host", () => {
    expect(normalizeAddressInput("google.com.tw")).toBe("https://google.com.tw");
  });

  it("keeps the path and query when adding the scheme", () => {
    expect(normalizeAddressInput("google.com.tw/search?q=a")).toBe(
      "https://google.com.tw/search?q=a",
    );
  });

  it("adds http:// to localhost, loopback and IPv4 hosts (dev servers)", () => {
    expect(normalizeAddressInput("localhost:3000")).toBe("http://localhost:3000");
    expect(normalizeAddressInput("127.0.0.1:8080/admin")).toBe("http://127.0.0.1:8080/admin");
    expect(normalizeAddressInput("192.168.1.5")).toBe("http://192.168.1.5");
  });

  it("leaves an input that already has a scheme untouched", () => {
    expect(normalizeAddressInput("https://muki.tw/wp-admin")).toBe("https://muki.tw/wp-admin");
    expect(normalizeAddressInput("http://localhost:3000")).toBe("http://localhost:3000");
    expect(normalizeAddressInput("file:///x/index.html")).toBe("file:///x/index.html");
  });

  it("leaves an absolute file path for the asset resolver to handle", () => {
    expect(normalizeAddressInput("/Users/me/page.html")).toBe("/Users/me/page.html");
  });

  it("trims and returns empty for blank input", () => {
    expect(normalizeAddressInput("  https://muki.tw  ")).toBe("https://muki.tw");
    expect(normalizeAddressInput("   ")).toBe("");
  });
});
