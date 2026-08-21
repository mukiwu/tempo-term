import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getCurrentWindow } = vi.hoisted(() => ({ getCurrentWindow: vi.fn() }));
const platform = vi.hoisted(() => ({ IS_WINDOWS: true }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow }));
vi.mock("@/lib/platform", () => ({
  get IS_WINDOWS() {
    return platform.IS_WINDOWS;
  },
}));

import { restoreFocusOnWindowRefocus } from "./windowLifecycle";

// restoreFocusOnWindowRefocus attaches a real document-level `focusin` listener;
// collect each call's unlisten so afterEach removes it and listeners can't leak
// across tests in this file.
const cleanups: Array<() => void> = [];

afterEach(() => {
  cleanups.splice(0).forEach((fn) => fn());
  getCurrentWindow.mockReset();
  platform.IS_WINDOWS = true;
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

/** restoreFocusOnWindowRefocus with its focusin listener auto-torn-down in afterEach. */
async function register() {
  const unlisten = await restoreFocusOnWindowRefocus();
  if (unlisten) {
    cleanups.push(unlisten);
  }
  return unlisten;
}

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
    await register();

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

  it("restores the most recently focused element, not an earlier one", async () => {
    const win = mockFocusWindow();
    await register();

    const first = document.createElement("textarea");
    const second = document.createElement("input");
    document.body.append(first, second);
    first.focus();
    second.focus();
    second.blur();
    expect(document.activeElement).toBe(document.body);

    win.focus();
    // The focusin listener keeps updating, so the last element focused before we
    // left is what comes back — not `first`.
    expect(document.activeElement).toBe(second);
  });

  it("restores nothing when no element was ever focused", async () => {
    const win = mockFocusWindow();
    await register();

    // Nothing was focused, so there is nothing to restore and no error.
    expect(() => win.focus()).not.toThrow();
    expect(document.activeElement).toBe(document.body);
  });

  it("does not steal focus if another element grabbed it while away", async () => {
    const win = mockFocusWindow();
    await register();

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
    await register();

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
    await register();

    const terminal = document.createElement("textarea");
    document.body.appendChild(terminal);
    terminal.focus();

    win.blur();
    // Its tab closed while the window was in the background.
    terminal.remove();

    win.focus();
    expect(document.activeElement).toBe(document.body);
  });

  it("removes the exact focusin listener it added if registration fails", async () => {
    const onFocusChanged = vi.fn().mockRejectedValue(new Error("ipc failed"));
    getCurrentWindow.mockReturnValue({ onFocusChanged });
    const addSpy = vi.spyOn(document, "addEventListener");
    const removeSpy = vi.spyOn(document, "removeEventListener");

    await expect(restoreFocusOnWindowRefocus()).rejects.toThrow("ipc failed");

    // The listener removed on failure must be the same reference that was added,
    // otherwise the real one would still leak.
    const added = addSpy.mock.calls.find(([type]) => type === "focusin")?.[1];
    expect(added).toBeDefined();
    expect(removeSpy).toHaveBeenCalledWith("focusin", added);
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
