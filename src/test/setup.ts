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
