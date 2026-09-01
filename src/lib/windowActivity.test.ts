import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";

import { isWindowVisible, useWindowVisible } from "./windowActivity";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.resolve()) }));

afterEach(() => {
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  vi.restoreAllMocks();
});

describe("windowActivity", () => {
  it("stays visible when another window takes focus", () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
    const { result } = renderHook(() => useWindowVisible());

    expect(invoke).toHaveBeenCalledWith("pty_set_window_active", { active: true });
    expect(invoke).toHaveBeenCalledWith("ssh_set_window_active", { active: true });

    act(() => window.dispatchEvent(new Event("blur")));

    expect(result.current).toBe(true);
  });

  it("publishes one state transition per visibility change", () => {
    const visibility = vi.spyOn(document, "visibilityState", "get");
    visibility.mockReturnValue("visible");
    let renders = 0;
    const { result } = renderHook(() => {
      renders += 1;
      return useWindowVisible();
    });

    expect(result.current).toBe(true);
    visibility.mockReturnValue("hidden");
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(result.current).toBe(false);
    expect(isWindowVisible()).toBe(false);
    const afterHidden = renders;

    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(renders).toBe(afterHidden);

    visibility.mockReturnValue("visible");
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(result.current).toBe(true);
  });
});
