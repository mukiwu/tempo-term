import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DirEntry } from "@/modules/explorer/lib/fsBridge";

vi.mock("@/modules/explorer/lib/fsBridge", () => ({
  fsReadDir: vi.fn(),
  fsReadFile: vi.fn(),
  fsWriteFile: vi.fn(),
  fsCreateFile: vi.fn(),
  fsCreateDir: vi.fn(),
  fsDelete: vi.fn(),
  fsRename: vi.fn(),
}));

import * as fs from "@/modules/explorer/lib/fsBridge";
import { useNotesStore } from "./notesStore";

const mocked = vi.mocked(fs);

function file(name: string, parent = "/root"): DirEntry {
  return { name, path: `${parent}/${name}`, is_dir: false, size: 1 };
}
function dir(name: string, parent = "/root"): DirEntry {
  return { name, path: `${parent}/${name}`, is_dir: true, size: 0 };
}

/** Make fsReadDir return entries per directory from a map. */
function withDirs(map: Record<string, DirEntry[]>) {
  mocked.fsReadDir.mockImplementation(async (path: string) => map[path] ?? []);
}

beforeEach(() => {
  vi.clearAllMocks();
  useNotesStore.setState({ rootPath: null, tree: [], loading: false, error: null });
  mocked.fsReadDir.mockResolvedValue([]);
  mocked.fsCreateFile.mockResolvedValue(undefined);
  mocked.fsCreateDir.mockResolvedValue(undefined);
  mocked.fsWriteFile.mockResolvedValue(undefined);
  mocked.fsRename.mockResolvedValue(undefined);
  mocked.fsDelete.mockResolvedValue(undefined);
});

describe("notesStore.refresh", () => {
  it("builds a sorted tree of folders and markdown notes from the root", async () => {
    withDirs({
      "/root": [file("banana.md"), dir("Sub"), file("note.txt"), file("Apple.md")],
      "/root/Sub": [file("inner.md", "/root/Sub")],
    });
    useNotesStore.setState({ rootPath: "/root" });
    await useNotesStore.getState().refresh();

    const tree = useNotesStore.getState().tree;
    expect(tree.map((n) => n.name)).toEqual(["Sub", "Apple.md", "banana.md"]);
    const sub = tree[0];
    expect(sub.kind === "folder" && sub.children.map((c) => c.name)).toEqual(["inner.md"]);
  });

  it("flags conflict copies", async () => {
    withDirs({ "/root": [file("n (conflicted copy).md")] });
    useNotesStore.setState({ rootPath: "/root" });
    await useNotesStore.getState().refresh();
    expect(useNotesStore.getState().tree[0]).toMatchObject({ kind: "note", isConflict: true });
  });

  it("clears the tree when there is no root", async () => {
    useNotesStore.setState({
      rootPath: null,
      tree: [{ kind: "note", name: "x.md", title: "x", path: "/x.md", isConflict: false }],
    });
    await useNotesStore.getState().refresh();
    expect(useNotesStore.getState().tree).toEqual([]);
    expect(mocked.fsReadDir).not.toHaveBeenCalled();
  });
});

describe("notesStore.createNote", () => {
  it("creates Untitled.md in the given directory", async () => {
    withDirs({ "/root": [] });
    const path = await useNotesStore.getState().createNote("/root");
    expect(path).toBe("/root/Untitled.md");
    expect(mocked.fsCreateFile).toHaveBeenCalledWith("/root/Untitled.md");
  });

  it("dedupes the name when Untitled.md already exists", async () => {
    withDirs({ "/root": [file("Untitled.md")] });
    const path = await useNotesStore.getState().createNote("/root");
    expect(path).toBe("/root/Untitled 2.md");
    expect(mocked.fsCreateFile).toHaveBeenCalledWith("/root/Untitled 2.md");
  });

  it("dedupes case-insensitively (case-insensitive filesystems)", async () => {
    withDirs({ "/root": [file("untitled.md")] });
    const path = await useNotesStore.getState().createNote("/root");
    expect(path).toBe("/root/Untitled 2.md");
  });
});

describe("notesStore.createFolder", () => {
  it("creates a directory and refreshes", async () => {
    await useNotesStore.getState().createFolder("/root", "Ideas");
    expect(mocked.fsCreateDir).toHaveBeenCalledWith("/root/Ideas");
  });

  it("dedupes the folder name when it already exists", async () => {
    withDirs({ "/root": [dir("New Folder")] });
    const path = await useNotesStore.getState().createFolder("/root", "New Folder");
    expect(path).toBe("/root/New Folder 2");
    expect(mocked.fsCreateDir).toHaveBeenCalledWith("/root/New Folder 2");
  });
});

describe("notesStore.renameNote", () => {
  it("renames the file to the sanitized title and returns the new path", async () => {
    const next = await useNotesStore.getState().renameNote("/root/old.md", "New Name");
    expect(next).toBe("/root/New Name.md");
    expect(mocked.fsRename).toHaveBeenCalledWith("/root/old.md", "/root/New Name.md");
  });

  it("does not rename when the name is unchanged", async () => {
    const next = await useNotesStore.getState().renameNote("/root/Same.md", "Same");
    expect(next).toBe("/root/Same.md");
    expect(mocked.fsRename).not.toHaveBeenCalled();
  });
});

describe("notesStore.renameFolder", () => {
  it("renames the folder to the sanitized name and returns the new path", async () => {
    const next = await useNotesStore.getState().renameFolder("/root/Old", "New");
    expect(next).toBe("/root/New");
    expect(mocked.fsRename).toHaveBeenCalledWith("/root/Old", "/root/New");
  });

  it("does not rename when the name is unchanged", async () => {
    const next = await useNotesStore.getState().renameFolder("/root/Same", "Same");
    expect(next).toBe("/root/Same");
    expect(mocked.fsRename).not.toHaveBeenCalled();
  });
});

describe("notesStore.moveNote", () => {
  it("renames the file into the target directory", async () => {
    const next = await useNotesStore.getState().moveNote("/root/a.md", "/root/Sub");
    expect(next).toBe("/root/Sub/a.md");
    expect(mocked.fsRename).toHaveBeenCalledWith("/root/a.md", "/root/Sub/a.md");
  });
});

describe("notesStore.deleteNote / read / write", () => {
  it("deletes via fsDelete", async () => {
    await useNotesStore.getState().deleteNote("/root/a.md");
    expect(mocked.fsDelete).toHaveBeenCalledWith("/root/a.md");
  });

  it("reads and writes note content via the bridge", async () => {
    mocked.fsReadFile.mockResolvedValue("# hi");
    expect(await useNotesStore.getState().readNote("/root/a.md")).toBe("# hi");
    await useNotesStore.getState().writeNote("/root/a.md", "new");
    expect(mocked.fsWriteFile).toHaveBeenCalledWith("/root/a.md", "new");
  });
});
