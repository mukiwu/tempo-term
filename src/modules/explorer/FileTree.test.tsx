import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { fireEvent, screen } from "@testing-library/react";
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
