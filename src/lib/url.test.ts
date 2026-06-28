import { describe, expect, it } from "vitest";
import { isLocalUrl, isWebUrl } from "./url";

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
