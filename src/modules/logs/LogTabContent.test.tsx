import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const strings: Record<string, string> = {
        "logs.raw": "Raw (ANSI)",
        "logs.copy": "Copy",
        "logs.saveAs": "Save As…",
        "logs.loading": "Loading…",
        "logs.error": "Error",
      };
      return strings[key] ?? key;
    },
  }),
}));

vi.mock("./lib/sessionLog", () => ({
  readSessionLog: vi.fn(),
  saveTextAs: vi.fn(() => Promise.resolve(null)),
}));
vi.mock("./lib/renderLog", () => ({
  renderLogToText: vi.fn(() => Promise.resolve("rendered clean text")),
}));

import { LogTabContent } from "./LogTabContent";
import { readSessionLog } from "./lib/sessionLog";
import { renderLogToText } from "./lib/renderLog";

describe("LogTabContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads and renders clean text for a logName", async () => {
    (readSessionLog as ReturnType<typeof vi.fn>).mockResolvedValue(new Uint8Array([104, 105]));
    render(<LogTabContent logName="session.log" />);
    await waitFor(() => expect(screen.getByText("rendered clean text")).toBeInTheDocument());
    expect(readSessionLog).toHaveBeenCalledWith("session.log");
  });

  it("reloads content when logName prop changes", async () => {
    (readSessionLog as ReturnType<typeof vi.fn>).mockResolvedValue(new Uint8Array([1]));
    (renderLogToText as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce("first log text")
      .mockResolvedValueOnce("second log text");

    const { rerender } = render(<LogTabContent logName="first.log" />);
    await waitFor(() => expect(screen.getByText("first log text")).toBeInTheDocument());

    rerender(<LogTabContent logName="second.log" />);
    await waitFor(() => expect(screen.getByText("second log text")).toBeInTheDocument());
    expect(readSessionLog).toHaveBeenCalledWith("second.log");
  });

  it("switches to raw ANSI text when Raw toggle is checked", async () => {
    const rawBytes = new TextEncoder().encode("raw ansi text");
    (readSessionLog as ReturnType<typeof vi.fn>).mockResolvedValue(rawBytes);
    render(<LogTabContent logName="session.log" />);
    await waitFor(() => expect(screen.getByText("rendered clean text")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("checkbox"));
    await waitFor(() => expect(screen.getByText("raw ansi text")).toBeInTheDocument());
    expect(renderLogToText).toHaveBeenCalledTimes(1); // not called again on raw toggle
  });

  it("shows loading state while fetching", async () => {
    let resolveRead!: (v: Uint8Array) => void;
    (readSessionLog as ReturnType<typeof vi.fn>).mockReturnValue(
      new Promise<Uint8Array>((r) => {
        resolveRead = r;
      }),
    );
    render(<LogTabContent logName="pending.log" />);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    resolveRead(new Uint8Array([1]));
    await waitFor(() => expect(screen.queryByText("Loading…")).not.toBeInTheDocument());
  });

  it("handles a missing or unreadable log gracefully", async () => {
    (readSessionLog as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("file not found"));
    render(<LogTabContent logName="gone.log" />);
    await waitFor(() => expect(screen.getByText(/file not found/i)).toBeInTheDocument());
  });
});
