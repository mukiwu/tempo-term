import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceStore } from "@/stores/workspaceStore";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

const { fsHomeDir, fsReadDir } = vi.hoisted(() => ({
  fsHomeDir: vi.fn(),
  fsReadDir: vi.fn(),
}));

vi.mock("@/modules/explorer/lib/fsBridge", () => ({ fsHomeDir, fsReadDir }));

import { EditorPaneHeader } from "./EditorPaneHeader";

function renderToolbar(overrides: Partial<Parameters<typeof EditorPaneHeader>[0]> = {}) {
  return render(
    <EditorPaneHeader
      path="/Users/muki/w/tempo-term/src/App.tsx"
      wordWrap={false}
      onToggleWordWrap={vi.fn()}
      onRefresh={vi.fn()}
      mode="edit"
      onSetMode={vi.fn()}
      onSwitchFile={vi.fn()}
      showClose={false}
      onClose={vi.fn()}
      {...overrides}
    />,
  );
}

describe("EditorPaneHeader breadcrumb", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fsHomeDir.mockResolvedValue("/Users/muki");
    useWorkspaceStore.setState({ rootPath: "/Users/muki/w/tempo-term" });
  });

  it("shows the file's trail with only the filename segment clickable", () => {
    renderToolbar();

    expect(screen.getByRole("button", { name: "App.tsx" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "src" })).toBeNull();
    expect(screen.getByText("src")).toBeInTheDocument();
  });

  it("lists only sibling files and switches this pane to the chosen one", async () => {
    fsReadDir.mockResolvedValue([
      { name: "App.tsx", path: "/Users/muki/w/tempo-term/src/App.tsx", is_dir: false, size: 1 },
      { name: "main.tsx", path: "/Users/muki/w/tempo-term/src/main.tsx", is_dir: false, size: 1 },
      { name: "modules", path: "/Users/muki/w/tempo-term/src/modules", is_dir: true, size: 0 },
    ]);
    const onSwitchFile = vi.fn();
    renderToolbar({ onSwitchFile });

    fireEvent.click(screen.getByRole("button", { name: "App.tsx" }));
    const sibling = await screen.findByRole("menuitem", { name: "main.tsx" });
    expect(fsReadDir).toHaveBeenCalledWith("/Users/muki/w/tempo-term/src");
    expect(screen.queryByRole("menuitem", { name: "modules" })).toBeNull();

    fireEvent.click(sibling);
    expect(onSwitchFile).toHaveBeenCalledWith("/Users/muki/w/tempo-term/src/main.tsx");
  });

  it("folds the pane close button into the toolbar", () => {
    const onClose = vi.fn();
    renderToolbar({ showClose: true, onClose });

    fireEvent.click(screen.getByRole("button", { name: "workspace.closePane" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
