import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const strings: Record<string, string> = {
        "logs.title": "Logs",
        "logs.empty": "No log files yet",
        "logs.refresh": "Refresh",
        "logs.openFolder": "Open logs folder",
      };
      return strings[key] ?? key;
    },
  }),
}));

vi.mock("./lib/sessionLog", () => ({
  listSessionLogs: vi.fn(),
  openSessionLogsDir: vi.fn(() => Promise.resolve()),
  enforceLogRetention: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/stores/tabsStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/stores/tabsStore")>();
  return {
    ...actual,
    useTabsStore: Object.assign(
      vi.fn((selector: (s: { openLogTab: (n: string) => string }) => unknown) =>
        selector({ openLogTab: vi.fn(() => "mock-tab-id") }),
      ),
      {
        getState: vi.fn(() => ({
          openLogTab: openLogTabSpy,
        })),
      },
    ),
  };
});

const openLogTabSpy = vi.fn(() => "mock-tab-id");

import { LogsView } from "./LogsView";
import { listSessionLogs } from "./lib/sessionLog";

describe("LogsView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    openLogTabSpy.mockReturnValue("mock-tab-id");
  });

  it("calls openLogTab when a log row is clicked", async () => {
    (listSessionLogs as ReturnType<typeof vi.fn>).mockResolvedValue([
      { name: "20260507_143343_zsh.log", size: 1024, modified_unix_ms: 1_700_000_000_000 },
    ]);

    render(<LogsView />);

    const item = await screen.findByText("20260507_143343_zsh.log");
    fireEvent.click(item);

    expect(openLogTabSpy).toHaveBeenCalledWith("20260507_143343_zsh.log");
  });

  it("shows an empty state when there are no logs", async () => {
    (listSessionLogs as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    render(<LogsView />);
    expect(await screen.findByText(/no log files/i)).toBeInTheDocument();
  });
});
