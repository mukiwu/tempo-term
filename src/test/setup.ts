import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// Node 26 exposes a disabled localStorage accessor by default. Vitest 3 sees
// that accessor and skips copying jsdom's Storage instance onto the test global,
// leaving localStorage undefined. Restore jsdom's browser-faithful storage.
const testDom = (globalThis as typeof globalThis & {
  jsdom?: { window: Window };
}).jsdom;

if (testDom) {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: testDom.window.localStorage,
  });
}

// The Tauri IPC bridge is injected by the webview at runtime, so in jsdom
// `window.__TAURI_INTERNALS__` is simply absent and every `invoke`/`listen`
// reaching it throws. A component that fires one on mount then rejects *after*
// its test has finished, which vitest reports as an unhandled error and fails
// the whole run on — with every test still passing, so the summary reads green
// while the exit code says otherwise. That is why `pnpm test` has never exited
// 0, and why nothing could gate on it.
//
// Tests that care about a command mock `@tauri-apps/api` themselves; this is the
// floor for the ones that only need a component to mount without exploding, so
// it rejects rather than resolving — an unmocked command has no answer to give,
// and a silent `undefined` would be a worse lie than a caught rejection.
if (!("__TAURI_INTERNALS__" in globalThis)) {
  Object.defineProperty(globalThis, "__TAURI_INTERNALS__", {
    configurable: true,
    value: {
      invoke: (cmd: string) => Promise.reject(new Error(`no Tauri backend in tests: ${cmd}`)),
      transformCallback: (callback: unknown) => {
        void callback;
        return 0;
      },
      unregisterCallback: () => {},
      convertFileSrc: (path: string) => path,
    },
  });
}

// jsdom ships without a canvas implementation, a ResizeObserver or matchMedia.
// xterm.js touches all three at import/render time, so provide light stubs to
// keep the test console clean and let terminal-adjacent components mount.

if (!HTMLCanvasElement.prototype.getContext) {
  HTMLCanvasElement.prototype.getContext = () => null as never;
} else {
  const noopContext = {
    fillRect: () => {},
    clearRect: () => {},
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
    putImageData: () => {},
    createImageData: () => ({ data: new Uint8ClampedArray(4) }),
    measureText: () => ({ width: 0 }),
    fillText: () => {},
    setTransform: () => {},
    drawImage: () => {},
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    stroke: () => {},
    fill: () => {},
  };
  HTMLCanvasElement.prototype.getContext = (() => noopContext) as never;
}

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
}

if (typeof HTMLElement.prototype.scrollIntoView === "undefined") {
  HTMLElement.prototype.scrollIntoView = () => {};
}

// jsdom performs no layout, so offsetWidth/offsetHeight are always 0.
// @tanstack/react-virtual (the sessions history list) reads its scroll
// element's viewport from offsetHeight on mount and, seeing 0, renders zero
// rows — seeded rows then never appear under test. Report a fixed non-zero
// viewport so the virtualizer has a window to fill. Row heights come from the
// virtualizer's fixed estimate (it does not measure individual rows), so a
// uniform stub here does not distort them.
Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
  configurable: true,
  get() {
    return 800;
  },
});
Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
  configurable: true,
  get() {
    return 300;
  },
});

if (typeof window.matchMedia === "undefined") {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
}
