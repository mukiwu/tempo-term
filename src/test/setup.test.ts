import { describe, expect, it } from "vitest";

describe("test setup", () => {
  it("exposes jsdom localStorage on the test global", () => {
    const testDom = (globalThis as typeof globalThis & {
      jsdom: { window: Window };
    }).jsdom;

    expect(globalThis.localStorage).toBe(testDom.window.localStorage);
  });
});
