import { describe, expect, it } from "vitest";
import { createTerminal, fileUriToPath } from "./createTerminal";

describe("fileUriToPath", () => {
  it("decodes a POSIX file URI", () => {
    expect(fileUriToPath("file:///Users/dev/My%20File.md", false)).toBe("/Users/dev/My File.md");
  });

  it("strips the leading slash before a Windows drive letter", () => {
    expect(fileUriToPath("file:///C:/Users/dev/notes.md", true)).toBe("C:/Users/dev/notes.md");
  });

  it("keeps rootless POSIX-looking paths intact on Windows", () => {
    expect(fileUriToPath("file:///srv/share/readme.md", true)).toBe("/srv/share/readme.md");
  });

  it("falls back to prefix stripping when decoding fails", () => {
    // %zz is invalid percent-encoding, so decodeURIComponent throws.
    expect(fileUriToPath("file:///C:/bad%zz.md", true)).toBe("C:/bad%zz.md");
  });

  it("rejects UNC-shaped paths that would fire an SMB connection", () => {
    expect(fileUriToPath("file:////attacker.example/share/x", true)).toBe("");
    expect(fileUriToPath("file:////attacker.example/share/x", false)).toBe("");
  });

  it("rejects URIs with a remote host instead of silently dropping it", () => {
    expect(fileUriToPath("file://evil.example/etc/passwd", false)).toBe("");
  });

  it("keeps accepting the localhost host form", () => {
    expect(fileUriToPath("file://localhost/etc/hosts", false)).toBe("/etc/hosts");
  });

  it("rejects non-file protocols", () => {
    expect(fileUriToPath("javascript:alert(1)", false)).toBe("");
    expect(fileUriToPath("ssh://c1/x", false)).toBe("");
  });
});

describe("createTerminal link handler", () => {
  it("allows non-http protocols so OSC 8 file:// links reach the handler", () => {
    const { term } = createTerminal();
    expect(term.options.linkHandler?.allowNonHttpProtocols).toBe(true);
    term.dispose();
  });
});

describe("createTerminal search", () => {
  it("exposes a search addon that finds text already in the buffer", async () => {
    const { term, search } = createTerminal();
    const container = document.createElement("div");
    document.body.appendChild(container);
    term.open(container);

    await new Promise<void>((resolve) => term.write("the quick brown fox\r\n", resolve));

    expect(search.findNext("brown")).toBe(true);
    expect(search.findNext("zebra")).toBe(false);

    term.dispose();
    container.remove();
  });
});
