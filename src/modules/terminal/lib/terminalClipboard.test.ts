import { describe, expect, it } from "vitest";
import {
  formatImagePathsForTerminal,
  formatPathsForTerminal,
  isImageAttachmentCli,
  isImagePath,
  resolvePasteAction,
  shellQuotePath,
  shouldAttachImage,
} from "./terminalClipboard";

describe("terminal clipboard helpers", () => {
  it("detects Claude-like CLI commands that should receive Ctrl+V directly", () => {
    expect(isImageAttachmentCli("/opt/homebrew/bin/node /path/to/claude")).toBe(true);
    expect(isImageAttachmentCli("claude")).toBe(true);
    expect(isImageAttachmentCli("codex")).toBe(true);
    expect(isImageAttachmentCli("node /usr/local/bin/gemini")).toBe(true);
    expect(isImageAttachmentCli("/bin/zsh -l")).toBe(false);
  });

  it("formats image paths with a trailing separator", () => {
    expect(formatImagePathsForTerminal(["/tmp/a.png", "/tmp/CleanShot 1.jpg"])).toBe(
      "/tmp/a.png '/tmp/CleanShot 1.jpg' ",
    );
    expect(formatImagePathsForTerminal([])).toBe("");
  });

  it("formats any file or folder path with shell quoting", () => {
    expect(formatPathsForTerminal(["/tmp/a folder", "/Applications"])).toBe(
      "'/tmp/a folder' /Applications ",
    );
  });

  it("detects supported image paths", () => {
    expect(isImagePath("/tmp/a.PNG")).toBe(true);
    expect(isImagePath("/tmp/a.txt")).toBe(false);
  });

  it("only attaches a single image path for image-aware CLIs", () => {
    expect(shouldAttachImage("claude", ["/tmp/a.png"])).toBe(true);
    expect(shouldAttachImage("claude", ["/tmp/a.txt"])).toBe(false);
    expect(shouldAttachImage("claude", ["/tmp/a.png", "/tmp/b.png"])).toBe(false);
    expect(shouldAttachImage("zsh", ["/tmp/a.png"])).toBe(false);
  });

  it("shell-quotes paths only when needed", () => {
    expect(shellQuotePath("/tmp/a.png")).toBe("/tmp/a.png");
    expect(shellQuotePath("/tmp/it's here.png")).toBe("'/tmp/it'\\''s here.png'");
  });

  it("quotes Windows paths with double quotes, leaving plain drive paths bare", () => {
    expect(shellQuotePath("C:\\Users\\me\\a.png", true)).toBe("C:\\Users\\me\\a.png");
    expect(shellQuotePath("C:\\My Documents\\a.png", true)).toBe('"C:\\My Documents\\a.png"');
    // A comma must force quoting: PowerShell treats a bare comma as its array
    // operator and would split the path into separate arguments.
    expect(shellQuotePath("C:\\data\\a,b.png", true)).toBe('"C:\\data\\a,b.png"');
  });
});

describe("resolvePasteAction", () => {
  it("pastes clipboard text verbatim, even when it looks like a path", () => {
    expect(
      resolvePasteAction({
        shortcut: "cmd",
        clipboardText: "/usr/local/bin",
        filePaths: [],
        imagePaths: [],
        foregroundCommand: "zsh",
      }),
    ).toEqual({ kind: "text", text: "/usr/local/bin" });
  });

  it("pastes a copied file's path when the clipboard has no text", () => {
    expect(
      resolvePasteAction({
        shortcut: "cmd",
        clipboardText: "",
        filePaths: ["/Users/me/My File.txt"],
        imagePaths: [],
        foregroundCommand: "zsh",
      }),
    ).toEqual({ kind: "paste-paths", paths: ["/Users/me/My File.txt"] });
  });

  it("attaches a copied image when the foreground command is an image-aware CLI", () => {
    expect(
      resolvePasteAction({
        shortcut: "cmd",
        clipboardText: "",
        filePaths: [],
        imagePaths: ["/tmp/shot.png"],
        foregroundCommand: "claude",
      }),
    ).toEqual({ kind: "attach-image", path: "/tmp/shot.png" });
  });

  it("pastes the image path instead of attaching when the shell is not image-aware", () => {
    expect(
      resolvePasteAction({
        shortcut: "cmd",
        clipboardText: "",
        filePaths: [],
        imagePaths: ["/tmp/shot.png"],
        foregroundCommand: "zsh",
      }),
    ).toEqual({ kind: "paste-paths", paths: ["/tmp/shot.png"] });
  });

  it("falls back to the control byte for Ctrl+V with an empty clipboard", () => {
    const base = { clipboardText: "", filePaths: [], imagePaths: [], foregroundCommand: null };
    expect(resolvePasteAction({ ...base, shortcut: "ctrl" })).toEqual({ kind: "control" });
    expect(resolvePasteAction({ ...base, shortcut: "cmd" })).toEqual({ kind: "none" });
  });
});
