import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWorktreeStore } from "./worktreeStore";
import { gitWorktreeInfo, type WorktreeInfo } from "./worktreeBridge";

vi.mock("./worktreeBridge", () => ({
  gitWorktreeInfo: vi.fn(),
}));

const mockInfo: WorktreeInfo = {
  branch: "main",
  cwd: "/a",
  isWorktree: false,
  mainBranch: null,
  mainPath: null,
};

beforeEach(() => {
  useWorktreeStore.setState({ infos: {} });
  vi.mocked(gitWorktreeInfo).mockReset();
});

describe("worktreeStore", () => {
  it("caches fetched worktree info by cwd", async () => {
    vi.mocked(gitWorktreeInfo).mockResolvedValue(mockInfo);
    await useWorktreeStore.getState().refresh(["/a"]);
    expect(useWorktreeStore.getState().infos["/a"]).toEqual(mockInfo);
  });

  it("leaves the cache untouched when a fetch fails", async () => {
    useWorktreeStore.setState({ infos: { "/a": mockInfo } });
    vi.mocked(gitWorktreeInfo).mockRejectedValue(new Error("not a repo"));
    await useWorktreeStore.getState().refresh(["/a"]);
    expect(useWorktreeStore.getState().infos["/a"]).toEqual(mockInfo);
  });
});
