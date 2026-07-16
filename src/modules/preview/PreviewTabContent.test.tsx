// Tests that PreviewTabContent reloads the native preview webview when the
// previewed local file changes on disk. The webview lifecycle lives in
// useNativePreviewWebview (which touches Tauri APIs unavailable under jsdom), so
// it is stubbed here and its reload() is captured to assert the file watcher
// triggers a reload on a matching change and stays put on a non-matching one.
import { fireEvent, render } from "@testing-library/react";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@/i18n";

// Capture the change handler so the test can fire a file-change event.
let changeHandler: ((path: string) => void) | null = null;
vi.mock("@/modules/editor/lib/editorWatch", () => ({
  onEditorFileChanged: (h: (p: string) => void) => {
    changeHandler = h;
    return Promise.resolve(() => {
      changeHandler = null;
    });
  },
}));

// Stub the native webview hook and expose its reload() for assertions. back and
// forward are stable module-level fns so the controls-registration effect does
// not re-run every render.
const reload = vi.fn();
const back = vi.fn();
const forward = vi.fn();
vi.mock("./hooks/useNativePreviewWebview", () => ({
  useNativePreviewWebview: () => ({ hostRef: { current: null }, reload, back, forward }),
}));

import { PreviewTabContent } from "./PreviewTabContent";

afterEach(() => {
  reload.mockClear();
  back.mockClear();
  forward.mockClear();
  changeHandler = null;
});

describe("PreviewTabContent auto-reload", () => {
  it("reloads the webview when the previewed local file changes", async () => {
    render(<PreviewTabContent url="file:///proj/index.html" leafId="pane-1" visible />);
    // Wait a microtask so the mocked listen promise resolves and sets the handler.
    await act(async () => {});
    await act(async () => {
      changeHandler?.("/proj/index.html");
    });
    expect(reload).toHaveBeenCalledTimes(1);
    // The subscription is still alive after the reload (effect deps didn't change).
    expect(changeHandler).not.toBeNull();
  });

  it("ignores changes to a different file", async () => {
    render(<PreviewTabContent url="file:///proj/index.html" leafId="pane-2" visible />);
    await act(async () => {});
    await act(async () => {
      changeHandler?.("/proj/other.html");
    });
    expect(reload).not.toHaveBeenCalled();
  });
});

describe("PreviewTabContent navigation", () => {
  it("notifies onNavigate with the trimmed url when the address is submitted", () => {
    const onNavigate = vi.fn();
    const { getByRole } = render(
      <PreviewTabContent
        url="http://localhost:3000"
        leafId="pane-1"
        visible
        onNavigate={onNavigate}
      />,
    );
    const input = getByRole("textbox") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "  https://muki.tw/wp-admin  " } });
    fireEvent.submit(input.closest("form")!);
    expect(onNavigate).toHaveBeenCalledWith("https://muki.tw/wp-admin");
  });

  it("adds a scheme to a bare host before navigating and reflects it in the bar", () => {
    const onNavigate = vi.fn();
    const { getByRole } = render(
      <PreviewTabContent
        url="http://localhost:3000"
        leafId="pane-1"
        visible
        onNavigate={onNavigate}
      />,
    );
    const input = getByRole("textbox") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "google.com.tw" } });
    fireEvent.submit(input.closest("form")!);
    expect(onNavigate).toHaveBeenCalledWith("https://google.com.tw");
    expect(input.value).toBe("https://google.com.tw");
  });
});

describe("PreviewTabContent pane close", () => {
  it("folds the pane close button into the address row", () => {
    const onClose = vi.fn();
    const { getByRole } = render(
      <PreviewTabContent
        url="http://localhost:3000"
        leafId="pane-1"
        visible
        showClose
        onClose={onClose}
      />,
    );
    fireEvent.click(getByRole("button", { name: "Close pane" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("hides the close button on a single-pane tab", () => {
    const { queryByRole } = render(
      <PreviewTabContent url="http://localhost:3000" leafId="pane-1" visible />,
    );
    expect(queryByRole("button", { name: "Close pane" })).toBeNull();
  });
});
