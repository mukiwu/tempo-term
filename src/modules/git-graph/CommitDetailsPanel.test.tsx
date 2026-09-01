import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@/i18n";
import { CommitDetailsPanel } from "./CommitDetailsPanel";
import {
  gitCommitDetails,
  gitCommitFileDiff,
  gitCommitRangeFiles,
  gitCommitRangeFileDiff,
} from "./lib/gitGraphBridge";
import type { CommitNode } from "./types";

vi.mock("./lib/gitGraphBridge", () => ({
  gitCommitDetails: vi.fn(),
  gitCommitFileDiff: vi.fn().mockResolvedValue(""),
  gitCommitRangeFiles: vi.fn(),
  gitCommitRangeFileDiff: vi.fn().mockResolvedValue(""),
}));

const LABELS = {
  author: "Author",
  date: "Date",
  changedFiles: "Changed Files",
  noChanges: "No changes",
  noDiff: "No diff",
  noFileSelected: "Select a file",
  close: "Close",
  compareBadge: "Comparing",
  diffTab: "Diff",
  aiTab: "AI Explain",
  aiGenerate: "Explain",
  aiExplaining: "...",
  aiRegenerate: "Regen",
  aiNeedKey: "No key",
  aiEmpty: "Empty",
  viewFolder: "Group by folder",
  viewFlat: "Flat view",
  expandFolder: (name: string) => `Expand ${name}`,
  collapseFolder: (name: string) => `Collapse ${name}`,
};

const COMMIT: CommitNode = {
  hash: "abc1234",
  parents: [],
  author: "a",
  date: "today",
  message: "feat: x",
  refs: [],
};

describe("CommitDetailsPanel changed-files tree", () => {
  // The flat/folder toggle is remembered, so one test's choice must not
  // leak into the next.
  beforeEach(() => localStorage.clear());

  it("nests dist/aaa and dist/bbb under one dist folder in tree mode", async () => {
    vi.mocked(gitCommitDetails).mockResolvedValue({
      message: "feat: x",
      files: [
        { status: "M", path: "dist/aaa/x.ts" },
        { status: "M", path: "dist/bbb/y.ts" },
      ],
    });
    render(
      <CommitDetailsPanel
        repo="/repo"
        selection={{ mode: "single", commit: COMMIT }}
        onClose={() => {}}
        labels={LABELS}
      />,
    );
    await screen.findByText("dist/aaa/x.ts");

    fireEvent.click(screen.getByRole("button", { name: "Group by folder" }));

    await waitFor(() => expect(screen.getAllByText("dist")).toHaveLength(1));
    expect(screen.getByText("aaa")).toBeInTheDocument();
    expect(screen.getByText("x.ts")).toBeInTheDocument();
  });

  it("remembers the flat/folder view mode across remounts", async () => {
    vi.mocked(gitCommitDetails).mockResolvedValue({
      message: "feat: x",
      files: [{ status: "M", path: "dist/aaa/x.ts" }],
    });
    const panel = () => (
      <CommitDetailsPanel
        repo="/repo"
        selection={{ mode: "single", commit: COMMIT }}
        onClose={() => {}}
        labels={LABELS}
      />
    );
    const first = render(panel());
    await screen.findByText("dist/aaa/x.ts");
    fireEvent.click(screen.getByRole("button", { name: "Group by folder" }));
    await screen.findByText("x.ts");
    first.unmount();

    render(panel());

    expect(await screen.findByText("x.ts")).toBeInTheDocument();
    expect(screen.queryByText("dist/aaa/x.ts")).not.toBeInTheDocument();
  });

  it("collapsing a folder in tree mode hides its files", async () => {
    vi.mocked(gitCommitDetails).mockResolvedValue({
      message: "feat: x",
      files: [{ status: "M", path: "dist/aaa/x.ts" }],
    });
    render(
      <CommitDetailsPanel
        repo="/repo"
        selection={{ mode: "single", commit: COMMIT }}
        onClose={() => {}}
        labels={LABELS}
      />,
    );
    await screen.findByText("dist/aaa/x.ts");
    fireEvent.click(screen.getByRole("button", { name: "Group by folder" }));
    await screen.findByText("dist");

    fireEvent.click(screen.getByRole("button", { name: "Collapse dist" }));

    expect(screen.queryByText("x.ts")).not.toBeInTheDocument();
  });

  it("clicking a nested file in tree mode loads its diff", async () => {
    vi.mocked(gitCommitDetails).mockResolvedValue({
      message: "feat: x",
      files: [{ status: "M", path: "dist/aaa/x.ts" }],
    });
    render(
      <CommitDetailsPanel
        repo="/repo"
        selection={{ mode: "single", commit: COMMIT }}
        onClose={() => {}}
        labels={LABELS}
      />,
    );
    await screen.findByText("dist/aaa/x.ts");
    fireEvent.click(screen.getByRole("button", { name: "Group by folder" }));
    await screen.findByText("x.ts");

    fireEvent.click(screen.getByText("x.ts"));

    await waitFor(() =>
      expect(gitCommitFileDiff).toHaveBeenCalledWith("/repo", "abc1234", "dist/aaa/x.ts"),
    );
  });
});

describe("CommitDetailsPanel compare mode", () => {
  // The flat/folder toggle is remembered, so one test's choice must not
  // leak into the next.
  beforeEach(() => localStorage.clear());

  const OTHER: CommitNode = {
    hash: "def5678",
    parents: [],
    author: "b",
    date: "yesterday",
    message: "fix: y",
    refs: [],
  };

  it("shows both hashes in the header and fetches the range diff", async () => {
    vi.mocked(gitCommitRangeFiles).mockResolvedValue([{ status: "M", path: "a.ts" }]);
    render(
      <CommitDetailsPanel
        repo="/repo"
        selection={{ mode: "compare", from: OTHER, to: COMMIT }}
        onClose={() => {}}
        labels={LABELS}
      />,
    );

    expect(await screen.findByText("def5678 .. abc1234")).toBeInTheDocument();
    expect(screen.getByText("Comparing")).toBeInTheDocument();
    await waitFor(() =>
      expect(gitCommitRangeFileDiff).toHaveBeenCalledWith("/repo", "def5678", "abc1234", "a.ts"),
    );
  });

  it("does not show the compare badge in single-commit mode", async () => {
    vi.mocked(gitCommitDetails).mockResolvedValue({ message: "feat: x", files: [] });
    render(
      <CommitDetailsPanel
        repo="/repo"
        selection={{ mode: "single", commit: COMMIT }}
        onClose={() => {}}
        labels={LABELS}
      />,
    );
    await screen.findByText("abc1234");
    expect(screen.queryByText("Comparing")).not.toBeInTheDocument();
  });

  it("hides the AI tab in compare mode", async () => {
    vi.mocked(gitCommitRangeFiles).mockResolvedValue([{ status: "M", path: "a.ts" }]);
    render(
      <CommitDetailsPanel
        repo="/repo"
        selection={{ mode: "compare", from: OTHER, to: COMMIT }}
        onClose={() => {}}
        labels={LABELS}
      />,
    );
    await screen.findByText("a.ts");
    expect(screen.queryByRole("button", { name: "AI Explain" })).not.toBeInTheDocument();
  });

  it("does not crash when the selection flips to compare mode while the AI tab is active", async () => {
    vi.mocked(gitCommitDetails).mockResolvedValue({
      message: "feat: x",
      files: [{ status: "M", path: "a.ts" }],
    });
    vi.mocked(gitCommitRangeFiles).mockResolvedValue([{ status: "M", path: "a.ts" }]);

    const { rerender } = render(
      <CommitDetailsPanel
        repo="/repo"
        selection={{ mode: "single", commit: COMMIT }}
        onClose={() => {}}
        labels={LABELS}
      />,
    );
    await screen.findByText("a.ts");
    fireEvent.click(screen.getByRole("button", { name: "AI Explain" }));
    await screen.findByText("Empty");

    rerender(
      <CommitDetailsPanel
        repo="/repo"
        selection={{ mode: "compare", from: OTHER, to: COMMIT }}
        onClose={() => {}}
        labels={LABELS}
      />,
    );

    expect(await screen.findByText("No diff")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "AI Explain" })).not.toBeInTheDocument();
  });
});
