import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { act, fireEvent, screen } from "@testing-library/react";
import { FileTree } from "./FileTree";
import { useTabsStore } from "@/stores/tabsStore";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("./lib/fsBridge", () => ({
  fsReadDir: vi.fn(),
  fsCreateDir: vi.fn(),
  fsCreateFile: vi.fn(),
  fsDelete: vi.fn(),
  fsRename: vi.fn(),
  fsReveal: vi.fn(),
}));

describe("FileTree icons", () => {
  it("renders a catppuccin type icon (not the generic lucide glyph) for a file", () => {
    const entries = [
      { name: "main.ts", path: "/p/main.ts", is_dir: false, size: 0 },
    ];
    const { container } = render(
      <FileTree entries={entries} onReloadRoot={() => {}} />,
    );
    // The vendored TypeScript icon colours its stroke with var(--vscode-ctp-*),
    // which the lucide File glyph never contains.
    expect(container.innerHTML).toContain("vscode-ctp");
  });
});

describe("FileTree opening a file", () => {
  beforeEach(() => {
    useTabsStore.setState({ tabs: [], activeId: null, spaces: [], activeSpaceId: null });
  });

  it("opens the clicked file via openFromSidebar instead of openEditorTab", () => {
    const entries = [{ name: "main.ts", path: "/p/main.ts", is_dir: false, size: 0 }];
    render(<FileTree entries={entries} onReloadRoot={() => {}} />);

    fireEvent.click(screen.getByText("main.ts"));

    const tabs = useTabsStore.getState().tabs;
    expect(tabs).toHaveLength(1);
    const pane = tabs[0].paneTree;
    expect(pane.kind === "leaf" && pane.pane).toMatchObject({
      kind: "editor",
      path: "/p/main.ts",
    });
  });

  it("splits a second click on a different file next to the first, instead of replacing it", () => {
    const entries = [
      { name: "main.ts", path: "/p/main.ts", is_dir: false, size: 0 },
      { name: "util.ts", path: "/p/util.ts", is_dir: false, size: 0 },
    ];
    render(<FileTree entries={entries} onReloadRoot={() => {}} />);

    fireEvent.click(screen.getByText("main.ts"));
    fireEvent.click(screen.getByText("util.ts"));

    expect(useTabsStore.getState().tabs).toHaveLength(1);
    const tab = useTabsStore.getState().tabs[0];
    expect(tab.paneTree.kind).toBe("split");
  });
});

describe("FileTree at pane capacity", () => {
  beforeEach(() => {
    useTabsStore.setState({ tabs: [], activeId: null, spaces: [], activeSpaceId: null });
  });

  it("shows an InfoDialog instead of opening a 9th pane", () => {
    useTabsStore.getState().openEditorTab("/0.ts");
    for (let i = 1; i < 8; i++) {
      useTabsStore.getState().openFromSidebar({ kind: "editor", path: `/${i}.ts` });
    }
    const entries = [{ name: "9.ts", path: "/9.ts", is_dir: false, size: 0 }];
    render(<FileTree entries={entries} onReloadRoot={() => {}} />);

    fireEvent.click(screen.getByText("9.ts"));

    expect(screen.getByText("paneCapacityAlert")).toBeInTheDocument();
    expect(useTabsStore.getState().tabs[0].paneOrder).toHaveLength(8);
  });
});

describe("FileTree collapse-all", () => {
  it("collapses expanded folders when collapseSignal increments", async () => {
    const { fsReadDir } = await import("./lib/fsBridge");
    vi.mocked(fsReadDir).mockResolvedValue([
      { name: "child.ts", path: "/p/dir/child.ts", is_dir: false, size: 0 },
    ]);
    const entries = [{ name: "dir", path: "/p/dir", is_dir: true, size: 0 }];
    const { rerender } = render(
      <FileTree entries={entries} onReloadRoot={() => {}} collapseSignal={0} />,
    );

    fireEvent.click(screen.getByText("dir"));
    expect(await screen.findByText("child.ts")).toBeInTheDocument();

    rerender(
      <FileTree entries={entries} onReloadRoot={() => {}} collapseSignal={1} />,
    );
    expect(screen.queryByText("child.ts")).not.toBeInTheDocument();
  });

  it("does not re-expand a folder whose expand-all fetch is still in flight when collapse-all fires", async () => {
    const { fsReadDir } = await import("./lib/fsBridge");
    let resolveFetch!: (entries: { name: string; path: string; is_dir: boolean; size: number }[]) => void;
    const pending = new Promise<{ name: string; path: string; is_dir: boolean; size: number }[]>(
      (resolve) => {
        resolveFetch = resolve;
      },
    );
    vi.mocked(fsReadDir).mockReturnValue(pending);

    const entries = [{ name: "dir", path: "/p/dir", is_dir: true, size: 0 }];
    const { rerender } = render(
      <FileTree entries={entries} onReloadRoot={() => {}} collapseSignal={0} expandSignal={0} />,
    );

    // Expand-all fires, kicking off a fetch for "dir" that we hold pending
    // (mirroring a real, slower Tauri IPC round trip).
    rerender(
      <FileTree entries={entries} onReloadRoot={() => {}} collapseSignal={0} expandSignal={1} />,
    );

    // Collapse-all fires before that fetch resolves.
    rerender(
      <FileTree entries={entries} onReloadRoot={() => {}} collapseSignal={1} expandSignal={1} />,
    );

    // The stale fetch lands after the collapse.
    await act(async () => {
      resolveFetch([{ name: "child.ts", path: "/p/dir/child.ts", is_dir: false, size: 0 }]);
      await pending;
    });

    // The user already asked to collapse everything; a fetch that was in
    // flight at that moment shouldn't silently re-open the folder once it
    // lands.
    expect(screen.queryByText("child.ts")).not.toBeInTheDocument();
  });
});

describe("FileTree expand-all", () => {
  it("expands a collapsed folder and loads its children when expandSignal increments", async () => {
    const { fsReadDir } = await import("./lib/fsBridge");
    vi.mocked(fsReadDir).mockResolvedValue([
      { name: "child.ts", path: "/p/dir/child.ts", is_dir: false, size: 0 },
    ]);
    const entries = [{ name: "dir", path: "/p/dir", is_dir: true, size: 0 }];
    const { rerender } = render(
      <FileTree entries={entries} onReloadRoot={() => {}} expandSignal={0} />,
    );

    expect(screen.queryByText("child.ts")).not.toBeInTheDocument();

    rerender(
      <FileTree entries={entries} onReloadRoot={() => {}} expandSignal={1} />,
    );
    expect(await screen.findByText("child.ts")).toBeInTheDocument();
  });

  it("recursively expands nested folders that have not been lazily loaded yet", async () => {
    const { fsReadDir } = await import("./lib/fsBridge");
    vi.mocked(fsReadDir).mockImplementation(async (path: string) => {
      if (path === "/p/dir") {
        return [{ name: "subdir", path: "/p/dir/subdir", is_dir: true, size: 0 }];
      }
      if (path === "/p/dir/subdir") {
        return [{ name: "leaf.ts", path: "/p/dir/subdir/leaf.ts", is_dir: false, size: 0 }];
      }
      return [];
    });
    const entries = [{ name: "dir", path: "/p/dir", is_dir: true, size: 0 }];
    const { rerender } = render(
      <FileTree entries={entries} onReloadRoot={() => {}} expandSignal={0} />,
    );

    rerender(
      <FileTree entries={entries} onReloadRoot={() => {}} expandSignal={1} />,
    );

    expect(await screen.findByText("leaf.ts")).toBeInTheDocument();
  });

  it("does not fsReadDir a file entry's own path when expand-all fires", async () => {
    const { fsReadDir } = await import("./lib/fsBridge");
    vi.mocked(fsReadDir).mockResolvedValue([
      { name: "child.ts", path: "/p/dir/child.ts", is_dir: false, size: 0 },
    ]);
    const entries = [{ name: "dir", path: "/p/dir", is_dir: true, size: 0 }];
    const { rerender } = render(
      <FileTree entries={entries} onReloadRoot={() => {}} expandSignal={0} />,
    );

    rerender(
      <FileTree entries={entries} onReloadRoot={() => {}} expandSignal={1} />,
    );
    await screen.findByText("child.ts");

    expect(fsReadDir).not.toHaveBeenCalledWith("/p/dir/child.ts");
  });

  it("does not re-cascade into a folder's unloaded descendants on a later manual expand", async () => {
    const { fsReadDir } = await import("./lib/fsBridge");
    vi.mocked(fsReadDir).mockImplementation(async (path: string) => {
      if (path === "/p/dir") {
        return [{ name: "subdir", path: "/p/dir/subdir", is_dir: true, size: 0 }];
      }
      if (path === "/p/dir/subdir") {
        return [{ name: "inner", path: "/p/dir/subdir/inner", is_dir: true, size: 0 }];
      }
      if (path === "/p/dir/subdir/inner") {
        return [
          { name: "leaf.ts", path: "/p/dir/subdir/inner/leaf.ts", is_dir: false, size: 0 },
        ];
      }
      return [];
    });
    const entries = [{ name: "dir", path: "/p/dir", is_dir: true, size: 0 }];
    const { rerender } = render(
      <FileTree entries={entries} onReloadRoot={() => {}} expandSignal={0} />,
    );

    // Expand-all cascades all the way down to leaf.ts once.
    rerender(
      <FileTree entries={entries} onReloadRoot={() => {}} expandSignal={1} />,
    );
    expect(await screen.findByText("leaf.ts")).toBeInTheDocument();

    // Manually collapse, then re-expand "subdir". The expandSignal prop is
    // still the same nonzero value it was during expand-all (it never
    // resets), so this must not auto-cascade into "inner" again.
    fireEvent.click(screen.getByText("subdir"));
    expect(screen.queryByText("inner")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("subdir"));
    expect(await screen.findByText("inner")).toBeInTheDocument();

    // "inner" not yet being in the DOM proves nothing on its own: if it were
    // wrongly auto-expanding, that would happen asynchronously (its own
    // effect awaits fsReadDir). Give that a chance to settle before
    // asserting it never happened.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(screen.queryByText("leaf.ts")).not.toBeInTheDocument();
  });

  it("does not auto-cascade into a heavy/generated directory like node_modules", async () => {
    // fs_read_dir has no gitignore awareness (unlike the search palette's
    // fs_list_files), so an unconditional recursive cascade would expand
    // node_modules' entire contents — tens of thousands of DOM nodes for a
    // typical JS project — making the subsequent collapse-all pass visibly
    // slow. Expand-all should skip auto-descending into well-known
    // heavy/generated directories, the way other editors' "expand all" does.
    const { fsReadDir } = await import("./lib/fsBridge");
    vi.mocked(fsReadDir).mockImplementation(async (path: string) => {
      if (path === "/p") {
        return [
          { name: "src", path: "/p/src", is_dir: true, size: 0 },
          { name: "node_modules", path: "/p/node_modules", is_dir: true, size: 0 },
        ];
      }
      if (path === "/p/src") {
        return [{ name: "index.ts", path: "/p/src/index.ts", is_dir: false, size: 0 }];
      }
      if (path === "/p/node_modules") {
        return [
          { name: "some-pkg", path: "/p/node_modules/some-pkg", is_dir: true, size: 0 },
        ];
      }
      return [];
    });
    const entries = [
      { name: "src", path: "/p/src", is_dir: true, size: 0 },
      { name: "node_modules", path: "/p/node_modules", is_dir: true, size: 0 },
    ];
    render(<FileTree entries={entries} onReloadRoot={() => {}} expandSignal={1} />);

    expect(await screen.findByText("index.ts")).toBeInTheDocument();
    expect(fsReadDir).not.toHaveBeenCalledWith("/p/node_modules");
    expect(screen.queryByText("some-pkg")).not.toBeInTheDocument();

    // Manually clicking node_modules must still work — only the automatic
    // cascade skips it, not the user's own explicit choice to look inside.
    fireEvent.click(screen.getByText("node_modules"));
    expect(await screen.findByText("some-pkg")).toBeInTheDocument();
  });
});

describe("FileTree context menu: open in new tab", () => {
  beforeEach(() => {
    useTabsStore.setState({ tabs: [], activeId: null, spaces: [], activeSpaceId: null });
  });

  it("always opens a new tab, even when the file is already open in the active tab", () => {
    useTabsStore.getState().openEditorTab("/main.ts");
    const entries = [{ name: "main.ts", path: "/main.ts", is_dir: false, size: 0 }];
    render(<FileTree entries={entries} onReloadRoot={() => {}} />);

    fireEvent.contextMenu(screen.getByText("main.ts"));
    fireEvent.click(screen.getByText("menu.openInNewTab"));

    expect(useTabsStore.getState().tabs).toHaveLength(2);
  });
});

describe("FileTree rename", () => {
  // fsRename is a shared mock across both tests below; vitest does not clear
  // call history between tests in the same file (no clearMocks/restoreMocks
  // configured), so without this reset the second test would see the first
  // test's call and fail its `not.toHaveBeenCalled()` assertion.
  beforeEach(async () => {
    const { fsRename } = await import("./lib/fsBridge");
    vi.mocked(fsRename).mockClear();
  });

  it("renames an entry in place and reloads the parent", async () => {
    const { fsRename } = await import("./lib/fsBridge");
    vi.mocked(fsRename).mockResolvedValue(undefined);
    const onReloadRoot = vi.fn();
    const entries = [{ name: "old.ts", path: "/p/old.ts", is_dir: false, size: 0 }];
    render(<FileTree entries={entries} onReloadRoot={onReloadRoot} />);

    fireEvent.contextMenu(screen.getByText("old.ts"));
    fireEvent.click(screen.getByText("menu.rename"));
    const input = screen.getByDisplayValue("old.ts");
    fireEvent.change(input, { target: { value: "new.ts" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await vi.waitFor(() => expect(fsRename).toHaveBeenCalledWith("/p/old.ts", "/p/new.ts"));
    expect(onReloadRoot).toHaveBeenCalled();
  });

  it("does nothing when the name is unchanged", async () => {
    const { fsRename } = await import("./lib/fsBridge");
    const entries = [{ name: "same.ts", path: "/p/same.ts", is_dir: false, size: 0 }];
    render(<FileTree entries={entries} onReloadRoot={() => {}} />);

    fireEvent.contextMenu(screen.getByText("same.ts"));
    fireEvent.click(screen.getByText("menu.rename"));
    const input = screen.getByDisplayValue("same.ts");
    fireEvent.keyDown(input, { key: "Enter" });

    await Promise.resolve();
    expect(fsRename).not.toHaveBeenCalled();
  });

  it("ignores an IME composition-commit Enter (keyCode 229) but still confirms on a plain Enter", async () => {
    const { fsRename } = await import("./lib/fsBridge");
    vi.mocked(fsRename).mockResolvedValue(undefined);
    const entries = [{ name: "old.ts", path: "/p/old.ts", is_dir: false, size: 0 }];
    render(<FileTree entries={entries} onReloadRoot={() => {}} />);

    fireEvent.contextMenu(screen.getByText("old.ts"));
    fireEvent.click(screen.getByText("menu.rename"));
    const input = screen.getByDisplayValue("old.ts");

    fireEvent.change(input, { target: { value: "new.ts" } });
    // Simulates an IME candidate-commit Enter: must not confirm the rename.
    fireEvent.keyDown(input, { key: "Enter", keyCode: 229 });

    expect(fsRename).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue("new.ts")).toBeInTheDocument();

    // A genuine Enter afterwards still confirms normally.
    fireEvent.keyDown(input, { key: "Enter" });

    await vi.waitFor(() =>
      expect(fsRename).toHaveBeenCalledWith("/p/old.ts", "/p/new.ts"),
    );
  });
});

describe("FileTree delete", () => {
  beforeEach(async () => {
    const { fsDelete } = await import("./lib/fsBridge");
    vi.mocked(fsDelete).mockClear();
  });

  it("gates a remote delete behind a confirm dialog and only calls fsDelete on confirm", async () => {
    const { fsDelete } = await import("./lib/fsBridge");
    vi.mocked(fsDelete).mockResolvedValue(undefined);
    const entries = [
      { name: "x.txt", path: "ssh://c1/home/me/x.txt", is_dir: false, size: 0 },
    ];
    render(<FileTree entries={entries} onReloadRoot={() => {}} />);

    fireEvent.contextMenu(screen.getByText("x.txt"));
    fireEvent.click(screen.getByText("menu.delete"));

    expect(fsDelete).not.toHaveBeenCalled();
    expect(screen.getByText("menu.deleteRemoteConfirm")).toBeInTheDocument();

    // The dialog's title also reads "menu.delete", so disambiguate by role
    // to click its confirm button specifically.
    fireEvent.click(screen.getByRole("button", { name: "menu.delete" }));

    await vi.waitFor(() =>
      expect(fsDelete).toHaveBeenCalledWith("ssh://c1/home/me/x.txt", false),
    );
  });

  it("cancels a remote delete without ever calling fsDelete", async () => {
    const { fsDelete } = await import("./lib/fsBridge");
    const entries = [
      { name: "x.txt", path: "ssh://c1/home/me/x.txt", is_dir: false, size: 0 },
    ];
    render(<FileTree entries={entries} onReloadRoot={() => {}} />);

    fireEvent.contextMenu(screen.getByText("x.txt"));
    fireEvent.click(screen.getByText("menu.delete"));
    fireEvent.click(screen.getByText("actions.cancel"));

    expect(screen.queryByText("menu.deleteRemoteConfirm")).not.toBeInTheDocument();
    expect(fsDelete).not.toHaveBeenCalled();
  });

  it("deletes a local entry immediately, with no confirm dialog", async () => {
    const { fsDelete } = await import("./lib/fsBridge");
    vi.mocked(fsDelete).mockResolvedValue(undefined);
    const entries = [{ name: "local.txt", path: "/p/local.txt", is_dir: false, size: 0 }];
    render(<FileTree entries={entries} onReloadRoot={() => {}} />);

    fireEvent.contextMenu(screen.getByText("local.txt"));
    fireEvent.click(screen.getByText("menu.delete"));

    await vi.waitFor(() =>
      expect(fsDelete).toHaveBeenCalledWith("/p/local.txt", false),
    );
    expect(screen.queryByText("menu.deleteRemoteConfirm")).not.toBeInTheDocument();
  });
});
