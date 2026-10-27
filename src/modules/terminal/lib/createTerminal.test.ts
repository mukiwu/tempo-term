import { describe, expect, it, vi } from "vitest";
import { openUrl } from "@tauri-apps/plugin-opener";
import { IS_MAC } from "@/lib/platform";
import { createTerminal, fileUriToPath } from "./createTerminal";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

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

  it("shows the resolved target in the hover tooltip, not just the hint", () => {
    const { term } = createTerminal({
      linkHint: "Cmd-click to open",
      webLinkHint: "Alt-click to preview",
    });
    const event = new MouseEvent("mousemove", { clientX: 10, clientY: 20 });
    const range = { start: { x: 1, y: 1 }, end: { x: 2, y: 1 } };

    // OSC 8 display text can lie about its target, so the tooltip must show
    // where the link really points.
    term.options.linkHandler?.hover?.(event, "file:///Users/dev/notes.md", range);
    const tooltip = document.querySelector(".terminal-link-tooltip");
    expect(tooltip?.textContent).toBe("/Users/dev/notes.md (Cmd-click to open)");

    term.options.linkHandler?.hover?.(event, "https://example.com/x", range);
    expect(tooltip?.textContent).toBe("https://example.com/x (Alt-click to preview)");

    term.dispose();
  });

  it("opens web links in the preview on Alt and in the browser on Cmd/Ctrl", () => {
    const onOpenPreviewUrl = vi.fn();
    const { term } = createTerminal({ onOpenPreviewUrl });
    const range = { start: { x: 1, y: 1 }, end: { x: 2, y: 1 } };
    const click = (init: MouseEventInit) => new MouseEvent("click", init);
    const browserKey = IS_MAC ? { metaKey: true } : { ctrlKey: true };
    vi.mocked(openUrl).mockClear();

    term.options.linkHandler?.activate(click({ altKey: true }), "https://example.com", range);
    expect(onOpenPreviewUrl).toHaveBeenCalledWith("https://example.com");
    expect(openUrl).not.toHaveBeenCalled();

    term.options.linkHandler?.activate(click(browserKey), "http://localhost:3000", range);
    expect(openUrl).toHaveBeenCalledWith("http://localhost:3000");
    expect(onOpenPreviewUrl).toHaveBeenCalledTimes(1);

    term.options.linkHandler?.activate(click({}), "https://example.com", range);
    expect(onOpenPreviewUrl).toHaveBeenCalledTimes(1);
    expect(openUrl).toHaveBeenCalledTimes(1);

    term.dispose();
  });
});

describe("createTerminal search", () => {
  it("enables transparency before the terminal is opened", () => {
    const { term } = createTerminal();
    expect(term.options.allowTransparency).toBe(true);
    term.dispose();
  });

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
