import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { act, useLayoutEffect } from "react";
import { TerminalView } from "./TerminalView";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts?.name ? `${key}:${opts.name}` : key,
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

// TerminalView calls getCurrentWebview() on mount to listen for native OS file
// drags — no Tauri runtime exists in jsdom.
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: () => Promise.resolve(() => {}),
  }),
}));

// Non-Windows platform: the terminal menu must work here too (the point of the
// cross-platform context-menu unification), so pin IS_WINDOWS to false.
vi.mock("@/lib/platform", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/platform")>();
  return { ...actual, IS_WINDOWS: false };
});

// Real xterm renders no measurable grid in jsdom, and the menu tests need to
// observe calls like term.clear/selectAll, so replace createTerminal with a
// spy-only handle. `current` always holds the most recently created handle.
const fakeTerminal = vi.hoisted(() => {
  function makeHandle() {
    const disposable = () => ({ dispose: vi.fn() });
    return {
      term: {
        open: vi.fn(),
        element: null,
        options: {} as Record<string, unknown>,
        parser: { registerOscHandler: vi.fn(() => disposable()) },
        attachCustomKeyEventHandler: vi.fn(),
        registerLinkProvider: vi.fn(() => disposable()),
        onData: vi.fn(() => disposable()),
        onWriteParsed: vi.fn(() => disposable()),
        write: vi.fn(),
        paste: vi.fn(),
        focus: vi.fn(),
        dispose: vi.fn(),
        clear: vi.fn(),
        selectAll: vi.fn(),
        clearSelection: vi.fn(),
        hasSelection: vi.fn(() => false),
        getSelection: vi.fn(() => ""),
        cols: 80,
        rows: 24,
      },
      fit: { fit: vi.fn() },
      search: {
        findNext: vi.fn(() => false),
        findPrevious: vi.fn(() => false),
        clearDecorations: vi.fn(),
      },
    };
  }
  return { makeHandle, current: null as ReturnType<typeof makeHandle> | null };
});

vi.mock("./lib/createTerminal", () => ({
  createTerminal: () => {
    fakeTerminal.current = fakeTerminal.makeHandle();
    return fakeTerminal.current;
  },
}));

// The paste tests need a live session (handleTerminalPaste no-ops without one),
// and openPty cannot reach the Rust backend in jsdom.
const fakeSession = vi.hoisted(() => {
  function makeSession() {
    return {
      id: 1,
      write: vi.fn(() => Promise.resolve()),
      resize: vi.fn(() => Promise.resolve()),
      close: vi.fn(() => Promise.resolve()),
      cwd: vi.fn(() => Promise.resolve<string | null>(null)),
      foregroundCommand: vi.fn(() => Promise.resolve<string | null>(null)),
    };
  }
  return { makeSession, current: null as ReturnType<typeof makeSession> | null };
});

vi.mock("./lib/pty-bridge", () => ({
  openPty: () => {
    fakeSession.current = fakeSession.makeSession();
    return Promise.resolve(fakeSession.current);
  },
}));

// The Tauri clipboard probes are invoke-based; expose them as controllable
// stubs while keeping resolvePasteAction/formatPathsForTerminal real, so the
// paste tests exercise the genuine decision chain.
const clipboardProbes = vi.hoisted(() => ({
  text: "",
  paths: [] as string[],
  images: [] as string[],
}));

vi.mock("./lib/terminalClipboard", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lib/terminalClipboard")>();
  return {
    ...actual,
    terminalClipboardText: () => Promise.resolve(clipboardProbes.text),
    terminalClipboardPaths: () => Promise.resolve(clipboardProbes.paths),
    terminalClipboardImagePaths: () => Promise.resolve(clipboardProbes.images),
  };
});

const readTextMock = vi.fn<() => Promise<string>>();

function renderTerminal() {
  const view = render(<TerminalView active />);
  const terminal = view.container.firstElementChild as HTMLElement;
  return { view, terminal };
}

/** Dispatches a native contextmenu event; returns true when NOT prevented. */
function rightClick(target: Element): boolean {
  let notPrevented = true;
  act(() => {
    notPrevented = target.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 40, clientY: 40 }),
    );
  });
  return notPrevented;
}

function clickMenuItem(name: string) {
  fireEvent.click(screen.getByRole("menuitem", { name }));
}

/** Waits for the mocked PTY session to be wired up (term.onData registered). */
async function waitForSession() {
  await waitFor(() => expect(fakeTerminal.current!.term.onData).toHaveBeenCalled());
}

/** Runs before TerminalView's passive mount effect creates the handle. */
function LayoutProbe({ run }: { run: () => void }) {
  useLayoutEffect(() => {
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

beforeEach(() => {
  fakeTerminal.current = null;
  fakeSession.current = null;
  clipboardProbes.text = "";
  clipboardProbes.paths = [];
  clipboardProbes.images = [];
  readTextMock.mockReset();
  readTextMock.mockResolvedValue("");
  // jsdom ships no navigator.clipboard; the paste fallback reads it.
  Object.defineProperty(navigator, "clipboard", {
    value: { readText: readTextMock, writeText: vi.fn(() => Promise.resolve()) },
    configurable: true,
  });
});

describe("TerminalView context menu on non-Windows platforms", () => {
  it("opens the five-item menu on right-click", () => {
    const { terminal } = renderTerminal();

    const notPrevented = rightClick(terminal);

    expect(notPrevented).toBe(false);
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getAllByRole("menuitem").map((el) => el.textContent)).toEqual([
      "terminalCopy",
      "terminalPaste",
      "terminalSelectAll",
      "terminalClear",
      "terminalSearch.label",
    ]);
  });

  it("greys out Copy without a selection and enables it with one", () => {
    const { terminal } = renderTerminal();

    rightClick(terminal);
    expect(screen.getByRole("menuitem", { name: "terminalCopy" })).toBeDisabled();

    fireEvent.keyDown(document, { key: "Escape" }); // close the menu
    fakeTerminal.current!.term.hasSelection.mockReturnValue(true);
    rightClick(terminal);
    expect(screen.getByRole("menuitem", { name: "terminalCopy" })).toBeEnabled();
  });

  it("Clear calls term.clear", () => {
    const { terminal } = renderTerminal();

    rightClick(terminal);
    clickMenuItem("terminalClear");

    expect(fakeTerminal.current!.term.clear).toHaveBeenCalledTimes(1);
  });

  it("Select All calls term.selectAll", () => {
    const { terminal } = renderTerminal();

    rightClick(terminal);
    clickMenuItem("terminalSelectAll");

    expect(fakeTerminal.current!.term.selectAll).toHaveBeenCalledTimes(1);
  });

  it("Search opens the search bar", () => {
    const { terminal } = renderTerminal();

    rightClick(terminal);
    clickMenuItem("terminalSearch.label");

    expect(screen.getByPlaceholderText("terminalSearch.placeholder")).toBeInTheDocument();
  });

  it("Search refocuses and selects the input when the bar is already open", () => {
    const { terminal } = renderTerminal();
    rightClick(terminal);
    clickMenuItem("terminalSearch.label");
    const input = screen.getByPlaceholderText("terminalSearch.placeholder") as HTMLInputElement;
    expect(input).toHaveFocus();
    fireEvent.change(input, { target: { value: "abc" } });
    act(() => input.blur());
    expect(input).not.toHaveFocus();

    rightClick(terminal);
    clickMenuItem("terminalSearch.label");

    expect(input).toHaveFocus();
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(3);
  });

  it("leaves a text field inside the pane to the input context menu", () => {
    const { terminal } = renderTerminal();
    rightClick(terminal);
    clickMenuItem("terminalSearch.label");
    const input = screen.getByPlaceholderText("terminalSearch.placeholder");

    const notPrevented = rightClick(input);

    expect(notPrevented).toBe(true);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("leaves overlay chrome (buttons and other widgets) to the window-level handler", () => {
    // The search bar's close button, the action card and future overlays all
    // float above the xterm mount; the terminal menu's Paste writes into the
    // pty, so only the terminal surface itself may open it.
    const { terminal } = renderTerminal();
    const chrome = document.createElement("button");
    terminal.appendChild(chrome);

    const notPrevented = rightClick(chrome);

    expect(notPrevented).toBe(true);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("keeps the terminal menu for xterm's own hidden helper textarea", () => {
    const { terminal } = renderTerminal();
    // The mocked createTerminal renders no DOM, so fabricate the structure the
    // real xterm produces: a .xterm wrapper with the hidden helper textarea.
    const xtermHost = document.createElement("div");
    xtermHost.className = "xterm";
    const helper = document.createElement("textarea");
    xtermHost.appendChild(helper);
    terminal.appendChild(xtermHost);

    const notPrevented = rightClick(helper);

    expect(notPrevented).toBe(false);
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  it("shows no menu and does not preventDefault before the terminal handle exists", () => {
    let notPrevented: boolean | null = null;
    render(
      <>
        <TerminalView active />
        <LayoutProbe
          run={() => {
            // Layout effects run before TerminalView's passive mount effect,
            // so the terminal handle has not been created yet at this point.
            const container = document.querySelector("div.relative.h-full.w-full");
            notPrevented = container!.dispatchEvent(
              new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
            );
          }}
        />
      </>,
    );

    expect(notPrevented).toBe(true);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});

describe("TerminalView menu paste clipboard fallback", () => {
  it("falls back to the web clipboard when every native probe is empty (Linux stub)", async () => {
    readTextMock.mockResolvedValue("web clipboard text");
    const { terminal } = renderTerminal();
    await waitForSession();

    rightClick(terminal);
    clickMenuItem("terminalPaste");

    await waitFor(() =>
      expect(fakeTerminal.current!.term.paste).toHaveBeenCalledWith("web clipboard text"),
    );
  });

  it("lets copied file paths win without consulting the web clipboard", async () => {
    clipboardProbes.paths = ["/tmp/report.txt"];
    readTextMock.mockResolvedValue("must not be used");
    const { terminal } = renderTerminal();
    await waitForSession();

    rightClick(terminal);
    clickMenuItem("terminalPaste");

    await waitFor(() =>
      expect(fakeTerminal.current!.term.paste).toHaveBeenCalledWith("/tmp/report.txt "),
    );
    expect(readTextMock).not.toHaveBeenCalled();
  });
});
