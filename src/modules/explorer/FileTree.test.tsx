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
