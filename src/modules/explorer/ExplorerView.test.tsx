import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@/i18n";

vi.mock("./lib/fsBridge", () => ({ fsReadDir: vi.fn().mockResolvedValue([]) }));

import { ExplorerView } from "./ExplorerView";
import { useWorkspaceStore } from "@/stores/workspaceStore";

beforeEach(() => {
  useWorkspaceStore.setState({ rootPath: null });
});

describe("ExplorerView remote root", () => {
  it("hides the open-folder button and shows the remote path", () => {
    useWorkspaceStore.setState({ rootPath: "ssh://c1/home/me" });
    render(<ExplorerView />);
    expect(screen.queryByLabelText("Open folder")).toBeNull();
    expect(screen.getByText("/home/me")).toBeInTheDocument();
  });

  it("keeps the open-folder button for a local root", () => {
    useWorkspaceStore.setState({ rootPath: "/home/me" });
    render(<ExplorerView />);
    expect(screen.getByLabelText("Open folder")).toBeInTheDocument();
  });

  // The fuzzy file search moved to a global header trigger (Cmd/Ctrl+P) — see
  // TabBar.test.tsx — so it is no longer embedded in this sidebar panel.
  it("no longer renders a Find files button here", () => {
    useWorkspaceStore.setState({ rootPath: "/home/me" });
    render(<ExplorerView />);
    expect(screen.queryByLabelText("Find files")).toBeNull();
  });
});

describe("ExplorerView expand/collapse toggle", () => {
  it("shows a single toggle button that flips between Expand All and Collapse All on click", () => {
    useWorkspaceStore.setState({ rootPath: "/home/me" });
    render(<ExplorerView />);

    // Merged into one button: no separate Expand All / Collapse All pair.
    expect(screen.queryAllByLabelText("Expand All")).toHaveLength(1);
    expect(screen.queryAllByLabelText("Collapse All")).toHaveLength(0);

    fireEvent.click(screen.getByLabelText("Expand All"));

    expect(screen.getByLabelText("Collapse All")).toBeInTheDocument();
    expect(screen.queryByLabelText("Expand All")).toBeNull();

    fireEvent.click(screen.getByLabelText("Collapse All"));

    expect(screen.getByLabelText("Expand All")).toBeInTheDocument();
    expect(screen.queryByLabelText("Collapse All")).toBeNull();
  });

  it("does not auto-expand a newly opened root that inherits a stale expandSignal", async () => {
    const { fsReadDir } = await import("./lib/fsBridge");
    vi.mocked(fsReadDir).mockImplementation(async (path: string) => {
      if (path === "/root-a") {
        return [{ name: "a-dir", path: "/root-a/a-dir", is_dir: true, size: 0 }];
      }
      if (path === "/root-b") {
        return [{ name: "b-dir", path: "/root-b/b-dir", is_dir: true, size: 0 }];
      }
      if (path === "/root-b/b-dir") {
        return [{ name: "leaf.ts", path: "/root-b/b-dir/leaf.ts", is_dir: false, size: 0 }];
      }
      return [];
    });

    useWorkspaceStore.setState({ rootPath: "/root-a" });
    render(<ExplorerView />);
    await screen.findByText("a-dir");

    // Expand-all on root A leaves expandSignal at a nonzero value.
    fireEvent.click(screen.getByLabelText("Expand All"));

    // Switch to a brand new root (e.g. the user opens a different folder).
    await act(async () => {
      useWorkspaceStore.setState({ rootPath: "/root-b" });
    });
    await screen.findByText("b-dir");

    // "b-dir" must render collapsed: it never received an explicit Expand
    // All click of its own, so it shouldn't auto-cascade just because root
    // A's expandSignal was already nonzero when it mounted.
    await waitFor(() => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(screen.queryByText("leaf.ts")).not.toBeInTheDocument();
  });
});

describe("ExplorerView refresh", () => {
  it("re-fetches the root listing when the refresh button is clicked", async () => {
    const { fsReadDir } = await import("./lib/fsBridge");
    vi.mocked(fsReadDir).mockReset().mockResolvedValue([]);

    useWorkspaceStore.setState({ rootPath: "/home/me" });
    render(<ExplorerView />);

    await waitFor(() => expect(vi.mocked(fsReadDir)).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByLabelText("Refresh"));

    await waitFor(() => expect(vi.mocked(fsReadDir)).toHaveBeenCalledTimes(2));
    expect(vi.mocked(fsReadDir)).toHaveBeenLastCalledWith("/home/me");
  });

  it("discards cached expanded children on refresh, rendering the tree collapsed again", async () => {
    const { fsReadDir } = await import("./lib/fsBridge");
    vi.mocked(fsReadDir).mockImplementation(async (path: string) => {
      if (path === "/home/me") {
        return [{ name: "a-dir", path: "/home/me/a-dir", is_dir: true, size: 0 }];
      }
      if (path === "/home/me/a-dir") {
        return [{ name: "leaf.ts", path: "/home/me/a-dir/leaf.ts", is_dir: false, size: 0 }];
      }
      return [];
    });

    useWorkspaceStore.setState({ rootPath: "/home/me" });
    render(<ExplorerView />);
    await screen.findByText("a-dir");

    // Expand everything so "a-dir" caches its child listing.
    fireEvent.click(screen.getByLabelText("Expand All"));
    await screen.findByText("leaf.ts");

    fireEvent.click(screen.getByLabelText("Refresh"));

    // A fresh tree renders fully collapsed again: the cached child is gone.
    await screen.findByText("a-dir");
    expect(screen.queryByText("leaf.ts")).not.toBeInTheDocument();
  });
});
