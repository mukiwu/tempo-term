import { describe, expect, it, vi } from "vitest";
import { applyNoteDrop, resolveNoteDrop } from "./noteDrag";

describe("resolveNoteDrop", () => {
  it("resolves a folder header to a folder target carrying its path", () => {
    const div = document.createElement("div");
    div.setAttribute("data-folder-path", "/root/Ideas");
    expect(resolveNoteDrop(div)).toEqual({ kind: "folder", path: "/root/Ideas" });
  });

  it("resolves the root container to a root target carrying the root path", () => {
    const root = document.createElement("div");
    root.setAttribute("data-notes-root", "/root");
    expect(resolveNoteDrop(root)).toEqual({ kind: "root", path: "/root" });
  });

  it("prefers the folder when a note row sits inside a folder subtree", () => {
    const folderWrap = document.createElement("div");
    folderWrap.setAttribute("data-folder-path", "/root/Ideas");
    const li = document.createElement("li");
    li.setAttribute("data-note-path", "/root/Ideas/n.md");
    folderWrap.appendChild(li);
    expect(resolveNoteDrop(li)).toEqual({ kind: "folder", path: "/root/Ideas" });
  });

  it("returns null when the cursor is outside any drop zone", () => {
    expect(resolveNoteDrop(document.createElement("div"))).toBeNull();
    expect(resolveNoteDrop(null)).toBeNull();
  });
});

describe("applyNoteDrop", () => {
  it("moves the note into a folder when dropped on a folder", () => {
    const moveNote = vi.fn().mockResolvedValue("/root/Ideas/n.md");
    applyNoteDrop({ kind: "folder", path: "/root/Ideas" }, "/root/n.md", { moveNote });
    expect(moveNote).toHaveBeenCalledWith("/root/n.md", "/root/Ideas");
  });

  it("moves the note to the root when dropped on the root zone", () => {
    const moveNote = vi.fn().mockResolvedValue("/root/n.md");
    applyNoteDrop({ kind: "root", path: "/root" }, "/root/Ideas/n.md", { moveNote });
    expect(moveNote).toHaveBeenCalledWith("/root/Ideas/n.md", "/root");
  });

  it("does nothing when there is no drop target", () => {
    const moveNote = vi.fn();
    applyNoteDrop(null, "/root/n.md", { moveNote });
    expect(moveNote).not.toHaveBeenCalled();
  });
});
