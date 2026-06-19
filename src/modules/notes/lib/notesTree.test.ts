import { describe, expect, it } from "vitest";
import type { DirEntry } from "@/modules/explorer/lib/fsBridge";
import {
  type NotesNode,
  isMarkdown,
  nodesFromEntries,
  sortNodes,
} from "./notesTree";

function dir(name: string, path: string): DirEntry {
  return { name, path, is_dir: true, size: 0 };
}
function file(name: string, path: string): DirEntry {
  return { name, path, is_dir: false, size: 1 };
}

describe("isMarkdown", () => {
  it("is true only for non-directory .md entries", () => {
    expect(isMarkdown(file("a.md", "/r/a.md"))).toBe(true);
    expect(isMarkdown(file("a.txt", "/r/a.txt"))).toBe(false);
    expect(isMarkdown(dir("a.md", "/r/a.md"))).toBe(false);
  });
});

describe("sortNodes", () => {
  it("puts folders before notes, each group sorted case-insensitively by name", () => {
    const nodes: NotesNode[] = [
      { kind: "note", name: "banana.md", title: "banana", path: "/r/banana.md", isConflict: false },
      { kind: "folder", name: "Zeta", path: "/r/Zeta", children: [] },
      { kind: "note", name: "Apple.md", title: "Apple", path: "/r/Apple.md", isConflict: false },
      { kind: "folder", name: "alpha", path: "/r/alpha", children: [] },
    ];
    expect(sortNodes(nodes).map((n) => n.name)).toEqual([
      "alpha",
      "Zeta",
      "Apple.md",
      "banana.md",
    ]);
  });
});

describe("nodesFromEntries", () => {
  it("keeps markdown notes and folders, drops other files, and recurses folders", () => {
    const entries: DirEntry[] = [
      file("keep.md", "/r/keep.md"),
      file("skip.txt", "/r/skip.txt"),
      dir("sub", "/r/sub"),
    ];
    const childrenOf = (path: string): NotesNode[] =>
      path === "/r/sub"
        ? [{ kind: "note", name: "inner.md", title: "inner", path: "/r/sub/inner.md", isConflict: false }]
        : [];

    const nodes = nodesFromEntries(entries, childrenOf);

    expect(nodes).toHaveLength(2);
    const folder = nodes.find((n) => n.kind === "folder");
    const note = nodes.find((n) => n.kind === "note");
    expect(note).toMatchObject({ kind: "note", title: "keep", path: "/r/keep.md", isConflict: false });
    expect(folder).toMatchObject({ kind: "folder", path: "/r/sub" });
    expect(folder?.kind === "folder" && folder.children).toHaveLength(1);
  });

  it("flags conflict-copy notes", () => {
    const entries: DirEntry[] = [file("n (conflicted copy).md", "/r/n (conflicted copy).md")];
    const nodes = nodesFromEntries(entries, () => []);
    expect(nodes[0]).toMatchObject({ kind: "note", isConflict: true });
  });
});
