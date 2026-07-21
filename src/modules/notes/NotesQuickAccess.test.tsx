import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@/i18n";
import { NotesQuickAccess } from "./NotesQuickAccess";
import { useNotesStore } from "@/stores/notesStore";

const busMocks = vi.hoisted(() => ({
  pasteIntoActiveTerminal: vi.fn(),
  runCommandInTerminal: vi.fn(),
}));
vi.mock("@/modules/terminal/lib/terminalBus", () => busMocks);

const CONTENTS: Record<string, string> = {
  "/notes/deploy.md": "```sh\nkubectl get pods\n```",
  "/notes/prompts.md": "```\nSummarize this repo.\n```\n\n```python\nprint('hi')\n```",
};

beforeEach(() => {
  vi.clearAllMocks();
  useNotesStore.setState({
    rootPath: "/notes",
    tree: [
      { kind: "note", name: "deploy.md", title: "deploy", path: "/notes/deploy.md", isConflict: false },
      { kind: "note", name: "prompts.md", title: "prompts", path: "/notes/prompts.md", isConflict: false },
    ],
    readNote: (path: string) => Promise.resolve(CONTENTS[path]),
  });
});

describe("NotesQuickAccess", () => {
  it("renders nothing when no notes folder is configured", () => {
    useNotesStore.setState({ rootPath: null });
    render(<NotesQuickAccess />);
    expect(screen.queryByLabelText("Quick commands")).toBeNull();
  });

  it("lists blocks grouped by note when opened", async () => {
    render(<NotesQuickAccess />);
    fireEvent.click(screen.getByLabelText("Quick commands"));
    await waitFor(() => expect(screen.getByText("deploy")).toBeInTheDocument());
    expect(screen.getByText("prompts")).toBeInTheDocument();
    expect(screen.getByText("kubectl get pods")).toBeInTheDocument();
    expect(screen.getByText("Summarize this repo.")).toBeInTheDocument();
  });

  it("pastes a block on row click and closes the panel", async () => {
    render(<NotesQuickAccess />);
    fireEvent.click(screen.getByLabelText("Quick commands"));
    await waitFor(() => expect(screen.getByText("kubectl get pods")).toBeInTheDocument());
    fireEvent.click(screen.getByText("kubectl get pods"));
    expect(busMocks.pasteIntoActiveTerminal).toHaveBeenCalledWith("kubectl get pods");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("offers paste-and-run only for shell blocks", async () => {
    render(<NotesQuickAccess />);
    fireEvent.click(screen.getByLabelText("Quick commands"));
    await waitFor(() => expect(screen.getByText("kubectl get pods")).toBeInTheDocument());
    // Two shell-runnable blocks: the sh one and the language-less prompt.
    // The python block must not offer run.
    expect(screen.getAllByLabelText("Run in terminal")).toHaveLength(2);
    fireEvent.click(screen.getAllByLabelText("Run in terminal")[0]);
    expect(busMocks.runCommandInTerminal).toHaveBeenCalledWith("kubectl get pods");
  });

  it("filters rows by search text", async () => {
    render(<NotesQuickAccess />);
    fireEvent.click(screen.getByLabelText("Quick commands"));
    await waitFor(() => expect(screen.getByText("kubectl get pods")).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText("Search commands and prompts…"), {
      target: { value: "summarize" },
    });
    expect(screen.queryByText("kubectl get pods")).toBeNull();
    expect(screen.getByText("Summarize this repo.")).toBeInTheDocument();
  });

  it("closes on Escape", async () => {
    render(<NotesQuickAccess />);
    fireEvent.click(screen.getByLabelText("Quick commands"));
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
