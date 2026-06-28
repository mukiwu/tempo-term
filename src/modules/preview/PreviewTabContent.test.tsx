// Tests that PreviewTabContent reloads its iframe when the previewed local
// file changes on disk. The `reloadKey` state is internal, so we expose it
// observably via a `data-reload` attribute on the iframe and assert that it
// increments on a matching file-change event and stays put on a non-matching one.
import { render, screen } from "@testing-library/react";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
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

import { PreviewTabContent } from "./PreviewTabContent";

describe("PreviewTabContent auto-reload", () => {
  it("reloads the iframe when the previewed local file changes", async () => {
    render(<PreviewTabContent url="file:///proj/index.html" />);
    const getIframe = () => screen.getByTitle(/preview/i) as HTMLIFrameElement;
    const initialReloadKey = Number(getIframe().dataset.reload);
    // wait a microtask so the mocked listen promise resolves and sets the handler
    await act(async () => {});
    await act(async () => {
      changeHandler?.("/proj/index.html");
    });
    // The iframe is remounted via key bump; assert the reload counter incremented.
    expect(Number(getIframe().dataset.reload)).toBe(initialReloadKey + 1);
    // The subscription is still alive after the reload (effect deps didn't change).
    expect(changeHandler).not.toBeNull();
  });

  it("ignores changes to a different file", async () => {
    render(<PreviewTabContent url="file:///proj/index.html" />);
    const getIframe = () => screen.getByTitle(/preview/i) as HTMLIFrameElement;
    const initialReloadKey = Number(getIframe().dataset.reload);
    await act(async () => {});
    await act(async () => {
      changeHandler?.("/proj/other.html");
    });
    // A different file must not trigger a reload.
    expect(Number(getIframe().dataset.reload)).toBe(initialReloadKey);
  });
});
