import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { FileFinder } from "./FileFinder";
import { useTabsStore } from "@/stores/tabsStore";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("./lib/fsBridge", () => ({
  fsListFiles: vi.fn(() => Promise.resolve(["/p/main.ts", "/p/util.ts"])),
}));

describe("FileFinder opening a file", () => {
  beforeEach(() => {
    useTabsStore.setState({ tabs: [], activeId: null, spaces: [], activeSpaceId: null });
  });

  it("opens the selected file via openFromSidebar instead of openEditorTab", async () => {
    render(<FileFinder root="/p" onClose={() => {}} />);
    await waitFor(() => screen.getByText("main.ts"));

    fireEvent.click(screen.getByText("main.ts"));

    const tabs = useTabsStore.getState().tabs;
    expect(tabs).toHaveLength(1);
    const pane = tabs[0].paneTree;
    expect(pane.kind === "leaf" && pane.pane).toMatchObject({
      kind: "editor",
      path: "/p/main.ts",
    });
  });

  it("splits into the active tab when a file is already open, instead of opening a second tab", async () => {
    useTabsStore.getState().openEditorTab("/p/main.ts");
    render(<FileFinder root="/p" onClose={() => {}} />);
    await waitFor(() => screen.getByText("util.ts"));

    fireEvent.click(screen.getByText("util.ts"));

    expect(useTabsStore.getState().tabs).toHaveLength(1);
    const tab = useTabsStore.getState().tabs[0];
    expect(tab.paneTree.kind).toBe("split");
  });
});

describe("FileFinder at pane capacity", () => {
  beforeEach(() => {
    useTabsStore.setState({ tabs: [], activeId: null, spaces: [], activeSpaceId: null });
  });

  it("shows an InfoDialog instead of opening a 9th pane", async () => {
    useTabsStore.getState().openEditorTab("/0.ts");
    for (let i = 1; i < 8; i++) {
      useTabsStore.getState().openFromSidebar({ kind: "editor", path: `/${i}.ts` });
    }
    render(<FileFinder root="/p" onClose={() => {}} />);
    await waitFor(() => screen.getByText("main.ts"));

    fireEvent.click(screen.getByText("main.ts"));

    expect(screen.getByText("paneCapacityAlert")).toBeInTheDocument();
  });
});
