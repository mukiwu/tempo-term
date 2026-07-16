import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DiffTabContent } from "./DiffTabContent";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/modules/source-control/lib/gitBridge", () => ({
  gitResolveRepo: vi.fn(),
  gitFileAtRev: vi.fn(),
}));

vi.mock("@/modules/explorer/lib/fsBridge", () => ({
  fsReadFile: vi.fn(),
}));

import { gitFileAtRev, gitResolveRepo } from "@/modules/source-control/lib/gitBridge";
import { fsReadFile } from "@/modules/explorer/lib/fsBridge";

describe("DiffTabContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(gitResolveRepo).mockResolvedValue("/repo");
  });

  it("compares index vs working tree for an unstaged diff", async () => {
    vi.mocked(gitFileAtRev).mockResolvedValue("old\n");
    vi.mocked(fsReadFile).mockResolvedValue("new\n");

    render(<DiffTabContent path="/repo/src/a.ts" staged={false} />);

    await waitFor(() =>
      expect(gitFileAtRev).toHaveBeenCalledWith("/repo", ":", "src/a.ts"),
    );
    expect(fsReadFile).toHaveBeenCalledWith("/repo/src/a.ts");
    expect(screen.getByText("diffUnstaged")).toBeInTheDocument();
  });

  it("compares HEAD vs index for a staged diff", async () => {
    vi.mocked(gitFileAtRev).mockResolvedValue("x\n");

    render(<DiffTabContent path="/repo/a.ts" staged={true} />);

    await waitFor(() => expect(gitFileAtRev).toHaveBeenCalledTimes(2));
    expect(gitFileAtRev).toHaveBeenCalledWith("/repo", "HEAD", "a.ts");
    expect(gitFileAtRev).toHaveBeenCalledWith("/repo", ":", "a.ts");
    expect(fsReadFile).not.toHaveBeenCalled();
    expect(screen.getByText("diffStaged")).toBeInTheDocument();
  });

  it("treats an unreadable working file as empty (deleted file)", async () => {
    vi.mocked(gitFileAtRev).mockResolvedValue("was here\n");
    vi.mocked(fsReadFile).mockRejectedValue(new Error("gone"));

    render(<DiffTabContent path="/repo/a.ts" staged={false} />);

    await waitFor(() => expect(fsReadFile).toHaveBeenCalled());
    // No error surface — the diff simply renders against an empty right side.
    expect(screen.queryByText("diffLoadError")).not.toBeInTheDocument();
  });

  it("folds the pane close button into the header row", async () => {
    vi.mocked(gitFileAtRev).mockResolvedValue("x\n");
    vi.mocked(fsReadFile).mockResolvedValue("y\n");
    const onClose = vi.fn();
    render(<DiffTabContent path="/repo/a.ts" staged={false} showClose onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: "workspace.closePane" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
