import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

const invokeMock = vi.fn().mockResolvedValue(undefined);
const listenMock = vi.fn().mockResolvedValue(() => {});
let focusHandler: ((event: { payload: boolean }) => void) | undefined;
const onFocusChangedMock = vi.fn(async (handler: (event: { payload: boolean }) => void) => {
  focusHandler = handler;
  return () => {};
});

vi.mock("@/lib/platform", () => ({ IS_MAC: true, IS_WINDOWS: false }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  isTauri: () => true,
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    label: "main",
    isFocused: async () => true,
    onFocusChanged: onFocusChangedMock,
  }),
}));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ listen: listenMock }),
}));
vi.mock("@/lib/window", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/window")>()),
  isWindowMaximized: async () => false,
  onWindowResized: async () => () => {},
  emitWindowMenuEvent: vi.fn(),
}));

import { useMacNativeMenu } from "@/lib/useMacNativeMenu";
import { useUiStore } from "@/stores/uiStore";
import { emitWindowMenuEvent } from "@/lib/window";

const flush = () => act(async () => {});

describe("useMacNativeMenu", () => {
  beforeEach(() => {
    invokeMock.mockClear();
    listenMock.mockClear();
    vi.mocked(emitWindowMenuEvent).mockClear();
  });

  it("pushes the model once on mount", async () => {
    renderHook(() => useMacNativeMenu());
    await flush();
    expect(invokeMock).toHaveBeenCalledWith("set_native_menu", {
      model: expect.objectContaining({ menus: expect.any(Array) }),
    });
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it("skips the push when the model is unchanged", async () => {
    renderHook(() => useMacNativeMenu());
    await flush();
    act(() => {
      // 任何不影響模型的 store 變化
      useUiStore.setState({ ...useUiStore.getState() });
    });
    await flush();
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it("re-pushes when a model-relevant store slice changes", async () => {
    renderHook(() => useMacNativeMenu());
    await flush();
    const left = [...useUiStore.getState().panelOrder.left];
    act(() => {
      useUiStore.setState({
        panelOrder: {
          ...useUiStore.getState().panelOrder,
          left: [left[1], left[0], ...left.slice(2)],
        },
      });
    });
    await flush();
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });

  it("re-pushes on focus regained even when the model is unchanged", async () => {
    renderHook(() => useMacNativeMenu());
    await flush();
    act(() => focusHandler?.({ payload: false }));
    act(() => focusHandler?.({ payload: true }));
    await flush();
    // 另一個視窗可能推過自己的模型，focus 回來必須強制重推
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });

  it("stops pushing after unmount", async () => {
    const { unmount } = renderHook(() => useMacNativeMenu());
    await flush();
    const callsAfterMount = invokeMock.mock.calls.length;
    unmount();
    // A model-relevant change after unmount must not reach set_native_menu:
    // the store subscriptions were released synchronously by the cleanup, and
    // the disposed guard blocks any push already sitting in the microtask queue.
    const left = [...useUiStore.getState().panelOrder.left];
    act(() => {
      useUiStore.setState({
        panelOrder: {
          ...useUiStore.getState().panelOrder,
          left: [left[1], left[0], ...left.slice(2)],
        },
      });
    });
    await flush();
    expect(invokeMock.mock.calls.length).toBe(callsAfterMount);
  });

  it("routes native-menu-click through executeMenuAction", async () => {
    renderHook(() => useMacNativeMenu());
    await flush();
    const clickHandler = listenMock.mock.calls.find(
      ([event]) => event === "native-menu-click",
    )?.[1] as (event: { payload: string }) => void;
    expect(clickHandler).toBeDefined();
    act(() => clickHandler({ payload: "new-tab" }));
    expect(vi.mocked(emitWindowMenuEvent)).toHaveBeenCalledWith("menu:new-tab", undefined);
  });
});
