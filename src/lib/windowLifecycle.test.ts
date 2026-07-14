import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getCurrentWindow } = vi.hoisted(() => ({ getCurrentWindow: vi.fn() }));
const { closeLocalSessions } = vi.hoisted(() => ({ closeLocalSessions: vi.fn() }));
const platform = vi.hoisted(() => ({ IS_WINDOWS: true }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow }));
vi.mock("@/modules/terminal/lib/pty-bridge", () => ({ closeLocalSessions }));
vi.mock("@/lib/platform", () => ({
  get IS_WINDOWS() {
    return platform.IS_WINDOWS;
  },
}));

import { registerSecondaryWindowCleanup, restoreFocusOnWindowRefocus } from "./windowLifecycle";

afterEach(() => {
  getCurrentWindow.mockReset();
  closeLocalSessions.mockReset();
  platform.IS_WINDOWS = true;
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

/** Mock getCurrentWindow so onFocusChanged hands its callback back to the test. */
function mockFocusWindow() {
  let cb: (e: { payload: boolean }) => void = () => {};
  const onFocusChanged = vi.fn(async (fn) => {
    cb = fn;
    return () => {
      cb = () => {};
    };
  });
  getCurrentWindow.mockReturnValue({ onFocusChanged });
  return {
    onFocusChanged,
    blur: () => cb({ payload: false }),
    focus: () => cb({ payload: true }),
  };
}

describe("registerSecondaryWindowCleanup", () => {
  it("registers nothing in the main window", async () => {
    const onCloseRequested = vi.fn();
    getCurrentWindow.mockReturnValue({ label: "main", onCloseRequested });
    const unlisten = await registerSecondaryWindowCleanup();
    expect(unlisten).toBeNull();
    expect(onCloseRequested).not.toHaveBeenCalled();
  });

  it("closes local sessions then destroys the window on close", async () => {
    let handler: (e: { preventDefault: () => void }) => Promise<void> = async () => {};
    const onCloseRequested = vi.fn(async (h) => {
      handler = h;
      return () => {};
    });
    const destroy = vi.fn().mockResolvedValue(undefined);
    closeLocalSessions.mockResolvedValue(undefined);
    getCurrentWindow.mockReturnValue({ label: "win-1", onCloseRequested, destroy });

    await registerSecondaryWindowCleanup();
    expect(onCloseRequested).toHaveBeenCalledTimes(1);

    const preventDefault = vi.fn();
    await handler({ preventDefault });

    expect(preventDefault).toHaveBeenCalled();
    expect(closeLocalSessions).toHaveBeenCalled();
    expect(destroy).toHaveBeenCalled();
  });
});

describe("restoreFocusOnWindowRefocus", () => {
  // This webview holds OS focus by default; the sibling-webview case overrides it.
  beforeEach(() => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
  });

  it("registers nothing off Windows", async () => {
    platform.IS_WINDOWS = false;
    const win = mockFocusWindow();
    const unlisten = await restoreFocusOnWindowRefocus();
    expect(unlisten).toBeNull();
    expect(win.onFocusChanged).not.toHaveBeenCalled();
  });

  it("restores focus to the last-focused element when the window regains focus", async () => {
    const win = mockFocusWindow();
    await restoreFocusOnWindowRefocus();

    const input = document.createElement("textarea");
    document.body.appendChild(input);
    input.focus();
    expect(document.activeElement).toBe(input);

    win.blur();
    // Simulate WebView2 dropping DOM focus while the window is in the background.
    input.blur();
    expect(document.activeElement).toBe(document.body);

    win.focus();
    expect(document.activeElement).toBe(input);
  });

  it("does not steal focus if another element grabbed it while away", async () => {
    const win = mockFocusWindow();
    await restoreFocusOnWindowRefocus();

    const terminal = document.createElement("textarea");
    const dialogInput = document.createElement("input");
    document.body.append(terminal, dialogInput);
    terminal.focus();

    win.blur();
    // A dialog opened while away and took focus; we must not yank it back.
    dialogInput.focus();

    win.focus();
    expect(document.activeElement).toBe(dialogInput);
  });

  it("does not restore focus when a sibling webview holds it (e.g. native preview)", async () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    const win = mockFocusWindow();
    await restoreFocusOnWindowRefocus();

    const terminal = document.createElement("textarea");
    document.body.appendChild(terminal);
    terminal.focus();

    win.blur();
    terminal.blur();
    // The OS window regained focus, but a sibling child webview holds it, not us.
    win.focus();
    expect(document.activeElement).toBe(document.body);
  });

  it("does not restore focus to an element detached while away", async () => {
    const win = mockFocusWindow();
    await restoreFocusOnWindowRefocus();

    const terminal = document.createElement("textarea");
    document.body.appendChild(terminal);
    terminal.focus();

    win.blur();
    // Its tab closed while the window was in the background.
    terminal.remove();

    win.focus();
    expect(document.activeElement).toBe(document.body);
  });

  it("removes the focusin listener if registration fails", async () => {
    const onFocusChanged = vi.fn().mockRejectedValue(new Error("ipc failed"));
    getCurrentWindow.mockReturnValue({ onFocusChanged });
    const removeSpy = vi.spyOn(document, "removeEventListener");

    await expect(restoreFocusOnWindowRefocus()).rejects.toThrow("ipc failed");
    expect(removeSpy).toHaveBeenCalledWith("focusin", expect.any(Function));
  });

  it("stops tracking focus after the returned unlisten is called", async () => {
    const win = mockFocusWindow();
    const unlisten = await restoreFocusOnWindowRefocus();

    const input = document.createElement("textarea");
    document.body.appendChild(input);
    input.focus();

    unlisten?.();
    input.blur();
    win.focus();
    // Tracking is torn down, so nothing is restored.
    expect(document.activeElement).toBe(document.body);
  });
});
