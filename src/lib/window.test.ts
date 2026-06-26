import { afterEach, describe, expect, it, vi } from "vitest";

const { getCurrentWindow } = vi.hoisted(() => ({ getCurrentWindow: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow }));

import {
  closeWindow,
  isMainWindow,
  isWindowMaximized,
  minimizeWindow,
  onWindowResized,
  perWindowStorage,
  toggleMaximizeWindow,
} from "./window";

afterEach(() => {
  getCurrentWindow.mockReset();
  localStorage.clear();
});

describe("isMainWindow", () => {
  it("is true for the main window label", () => {
    getCurrentWindow.mockReturnValue({ label: "main" });
    expect(isMainWindow()).toBe(true);
  });

  it("is false for any other window label", () => {
    getCurrentWindow.mockReturnValue({ label: "win-1" });
    expect(isMainWindow()).toBe(false);
  });

  it("falls back to true when there is no Tauri runtime", () => {
    getCurrentWindow.mockImplementation(() => {
      throw new Error("no __TAURI_INTERNALS__");
    });
    expect(isMainWindow()).toBe(true);
  });
});

describe("perWindowStorage", () => {
  it("uses localStorage in the main window", () => {
    getCurrentWindow.mockReturnValue({ label: "main" });
    const storage = perWindowStorage();
    storage.setItem("k", "v");
    expect(localStorage.getItem("k")).toBe("v");
  });

  it("uses private in-memory storage in a secondary window", () => {
    getCurrentWindow.mockReturnValue({ label: "win-1" });
    const storage = perWindowStorage();
    storage.setItem("k", "v");
    expect(localStorage.getItem("k")).toBeNull();
    expect(storage.getItem("k")).toBe("v");
    storage.removeItem("k");
    expect(storage.getItem("k")).toBeNull();
  });
});

describe("window controls", () => {
  it("minimizeWindow calls the current window's minimize", async () => {
    const minimize = vi.fn().mockResolvedValue(undefined);
    getCurrentWindow.mockReturnValue({ minimize });
    await minimizeWindow();
    expect(minimize).toHaveBeenCalledOnce();
  });

  it("toggleMaximizeWindow calls the current window's toggleMaximize", async () => {
    const toggleMaximize = vi.fn().mockResolvedValue(undefined);
    getCurrentWindow.mockReturnValue({ toggleMaximize });
    await toggleMaximizeWindow();
    expect(toggleMaximize).toHaveBeenCalledOnce();
  });

  it("closeWindow calls the current window's close", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    getCurrentWindow.mockReturnValue({ close });
    await closeWindow();
    expect(close).toHaveBeenCalledOnce();
  });

  it("isWindowMaximized reports the current window's maximized state", async () => {
    const isMaximized = vi.fn().mockResolvedValue(true);
    getCurrentWindow.mockReturnValue({ isMaximized });
    await expect(isWindowMaximized()).resolves.toBe(true);
    expect(isMaximized).toHaveBeenCalledOnce();
  });

  it("onWindowResized subscribes to the window's resize events", async () => {
    const unlisten = vi.fn();
    const onResized = vi.fn().mockResolvedValue(unlisten);
    getCurrentWindow.mockReturnValue({ onResized });
    const handler = vi.fn();
    const off = await onWindowResized(handler);
    expect(onResized).toHaveBeenCalledOnce();
    // The wrapper forwards the event to the bare handler.
    onResized.mock.calls[0][0]();
    expect(handler).toHaveBeenCalledOnce();
    expect(off).toBe(unlisten);
  });
});
