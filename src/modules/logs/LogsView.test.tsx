import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const strings: Record<string, string> = {
        "logs.title": "Logs",
        "logs.empty": "No log files yet",
        "logs.selectHint": "Select a log on the left",
        "logs.raw": "Raw (ANSI)",
        "logs.copy": "Copy",
        "logs.saveAs": "Save As…",
        "logs.loading": "Loading…",
        "logs.refresh": "Refresh",
        "logs.openFolder": "Open logs folder",
      };
      return strings[key] ?? key;
    },
  }),
}));

vi.mock("./lib/sessionLog", () => ({
  listSessionLogs: vi.fn(),
  readSessionLog: vi.fn(),
  openSessionLogsDir: vi.fn(() => Promise.resolve()),
  enforceLogRetention: vi.fn(() => Promise.resolve()),
  saveTextAs: vi.fn(() => Promise.resolve(null)),
}));
vi.mock("./lib/renderLog", () => ({
  renderLogToText: vi.fn(() => Promise.resolve("rendered clean text")),
  collapseBlankRuns: (x: string[]) => x,
}));

import { LogsView } from "./LogsView";
import { listSessionLogs, readSessionLog } from "./lib/sessionLog";

describe("LogsView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists logs and shows rendered content when one is selected", async () => {
    (listSessionLogs as ReturnType<typeof vi.fn>).mockResolvedValue([
      { name: "20260507_143343_zsh.log", size: 1024, modified_unix_ms: 1_700_000_000_000 },
    ]);
    (readSessionLog as ReturnType<typeof vi.fn>).mockResolvedValue(new Uint8Array([104, 105]));

    render(<LogsView />);

    const item = await screen.findByText("20260507_143343_zsh.log");
    fireEvent.click(item);

    await waitFor(() => expect(screen.getByText("rendered clean text")).toBeInTheDocument());
    expect(readSessionLog).toHaveBeenCalledWith("20260507_143343_zsh.log");
  });

  it("shows an empty state when there are no logs", async () => {
    (listSessionLogs as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    render(<LogsView />);
    expect(await screen.findByText(/no log files/i)).toBeInTheDocument();
  });
});
