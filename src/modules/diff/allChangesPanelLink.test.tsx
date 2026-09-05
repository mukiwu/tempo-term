import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@/i18n";

vi.mock("@/modules/source-control/lib/gitBridge", () => ({
  gitResolveRepo: vi.fn().mockResolvedValue("/repo"),
  gitStatus: vi.fn(),
  gitDiff: vi.fn().mockResolvedValue(""),
  gitLog: vi.fn().mockResolvedValue([]),
  gitFileAtRev: vi.fn().mockResolvedValue(""),
  gitStage: vi.fn().mockResolvedValue(undefined),
  gitUnstage: vi.fn().mockResolvedValue(undefined),
  gitCommit: vi.fn().mockResolvedValue(undefined),
  gitPush: vi.fn().mockResolvedValue(undefined),
  gitRestoreFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/modules/source-control/lib/aiCommit", () => ({
  generateCommitMessage: vi.fn().mockResolvedValue(""),
}));

vi.mock("@/modules/explorer/lib/fsBridge", () => ({
  fsReadFile: vi.fn().mockResolvedValue(""),
}));

vi.mock("@/modules/terminal/lib/terminalBus", () => ({
  pasteToTerminal: vi.fn(),
}));

import { gitDiff, gitStatus } from "@/modules/source-control/lib/gitBridge";
import { SourceControlView } from "@/modules/source-control/SourceControlView";
import { AllChangesTabContent } from "./AllChangesTabContent";
import { useAllChangesLinkStore } from "./lib/allChangesLinkStore";
import { useTabsStore } from "@/stores/tabsStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";

const FILES = ["src/a.ts", "src/b.ts", "src/c.ts"];

function diffFor(path: string) {
  return [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    "@@ -1,2 +1,3 @@",
    " keep",
    "-gone",
    "+one",
    "+two",
    "",
  ].join("\n");
}

/**
 * jsdom lays nothing out, so the page's reading of "which file is at the top"
 * would always come back the same. Each section is given a position of its
 * own, a hundred pixels apart, and the page is given a scroll position that
 * moves through them.
 */
function layOut(root: HTMLElement) {
  let scrollTop = 0;
  Object.defineProperty(root, "scrollTop", {
    configurable: true,
    get: () => scrollTop,
    set: (value: number) => {
      scrollTop = value;
    },
  });
  root.getBoundingClientRect = () => ({ top: 0, bottom: 500, height: 500 }) as DOMRect;
  const sections = Array.from(root.querySelectorAll<HTMLElement>("[data-diff-file]"));
  sections.forEach((section, index) => {
    section.getBoundingClientRect = () =>
      ({ top: index * 100 - scrollTop, bottom: index * 100 - scrollTop + 100 }) as DOMRect;
  });
  return {
    scrollTo(value: number) {
      scrollTop = value;
      fireEvent.scroll(root);
    },
  };
}

/**
 * The tree shows a file by its own name, the flat list by its whole path, and
 * the name can appear more than once (the row and its tooltip), so this takes
 * the first one that sits in a row.
 */
const rowFor = (path: string, mode: string) => {
  const label = mode === "flat" ? path : (path.split("/").pop() ?? path);
  const rows = screen
    .getAllByText(label)
    .map((element) => element.closest("li"))
    .filter((row): row is HTMLLIElement => row !== null);
  return rows[0];
};

describe("the Source Control panel beside the all-changes page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useWorkspaceStore.getState().setRoot("/repo");
    useTabsStore.setState({ tabs: [], activeId: null, spaces: [], activeSpaceId: null });
    useAllChangesLinkStore.setState({ file: null, showing: null, rescan: 0 });
    vi.mocked(gitStatus).mockResolvedValue({
      branch: "main",
      staged: [],
      unstaged: FILES.map((path) => ({ path, staged: false, status: "M" })),
    });
    vi.mocked(gitDiff).mockImplementation(async (_repo, staged) =>
      staged ? "" : FILES.map(diffFor).join(""),
    );
  });

  it.each([
    ["flat", "flat"],
    ["folder", "folder"],
  ])("marks the row of the file the page has scrolled to (%s view)", async (_label, mode) => {
    // The panel remembers its own view mode, and the tree renders its rows
    // through a different path from the flat list.
    localStorage.setItem("tempoterm-sourcecontrol-view-mode", mode);
    const { container } = render(
      <>
        <SourceControlView />
        <AllChangesTabContent />
      </>,
    );

    // The page has the pane in front, which is what puts the panel in this
    // mode at all.
    useTabsStore.getState().openAllChangesTab();

    await waitFor(() => expect(container.querySelectorAll("[data-diff-file]").length).toBe(3));
    const page = container.querySelector<HTMLElement>(".overflow-auto");
    const view = layOut(page!);

    // At the top of the page, the first file is the one being read.
    view.scrollTo(0);
    await waitFor(() => expect(rowFor("src/a.ts", mode)).toHaveAttribute("aria-current", "true"));
    expect(rowFor("src/b.ts", mode)).not.toHaveAttribute("aria-current");

    // Scrolling past the first section hands the mark to the second.
    view.scrollTo(150);
    await waitFor(() => expect(rowFor("src/b.ts", mode)).toHaveAttribute("aria-current", "true"));
    expect(rowFor("src/a.ts", mode)).not.toHaveAttribute("aria-current");

    view.scrollTo(250);
    await waitFor(() => expect(rowFor("src/c.ts", mode)).toHaveAttribute("aria-current", "true"));
  });

  it("marks the folder instead when the file inside it is shut away", async () => {
    localStorage.setItem("tempoterm-sourcecontrol-view-mode", "folder");
    const { container } = render(
      <>
        <SourceControlView />
        <AllChangesTabContent />
      </>,
    );
    useTabsStore.getState().openAllChangesTab();
    await waitFor(() => expect(container.querySelectorAll("[data-diff-file]").length).toBe(3));

    // Shut the folder the files live in. Its rows leave the DOM with it, so
    // there is nothing left for the page to mark.
    fireEvent.click(await screen.findByRole("button", { name: "Collapse src" }));
    // (the page renders the name in its own headers too, so this asks the
    // panel specifically: no row, no `li`.)
    expect(rowFor("src/a.ts", "folder")).toBeUndefined();

    const page = container.querySelector<HTMLElement>(".overflow-auto");
    const view = layOut(page!);
    view.scrollTo(0);

    // The folder takes the mark on their behalf: the tree still says where the
    // reader is, at the granularity that is actually on screen.
    // The page shows the directory in its own headers, so the folder row is
    // found by its toggle rather than by the text.
    const folder = screen.getByRole("button", { name: "Expand src" }).closest("li");
    await waitFor(() => expect(folder).toHaveAttribute("aria-current", "true"));

    // Opening it hands the mark back to the file, rather than marking both.
    fireEvent.click(screen.getByRole("button", { name: "Expand src" }));
    await waitFor(() => expect(rowFor("src/b.ts", "folder")).toBeTruthy());
    view.scrollTo(150);
    await waitFor(() =>
      expect(rowFor("src/b.ts", "folder")).toHaveAttribute("aria-current", "true"),
    );
    expect(
      screen.getByRole("button", { name: "Collapse src" }).closest("li"),
    ).not.toHaveAttribute("aria-current");
  });
});
