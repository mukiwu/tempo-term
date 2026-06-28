import { afterEach, describe, expect, it } from "vitest";
import { createTerminal, enableWebglRenderer } from "./createTerminal";

describe("createTerminal search", () => {
  it("exposes a search addon that finds text already in the buffer", async () => {
    const { term, search } = createTerminal();
    const container = document.createElement("div");
    document.body.appendChild(container);
    term.open(container);

    await new Promise<void>((resolve) => term.write("the quick brown fox\r\n", resolve));

    expect(search.findNext("brown")).toBe(true);
    expect(search.findNext("zebra")).toBe(false);

    term.dispose();
    container.remove();
  });
});

describe("enableWebglRenderer", () => {
  const containers: HTMLDivElement[] = [];

  afterEach(() => {
    for (const el of containers) el.remove();
    containers.length = 0;
  });

  function openTerminal() {
    const { term } = createTerminal();
    const container = document.createElement("div");
    document.body.appendChild(container);
    containers.push(container);
    term.open(container);
    return term;
  }

  it("falls back without throwing when the environment has no WebGL context", () => {
    const term = openTerminal();

    // jsdom provides no real WebGL2 context, so the GPU renderer cannot start.
    // The terminal must stay usable rather than crash the whole pane.
    expect(() => enableWebglRenderer(term)).not.toThrow();
    expect(enableWebglRenderer(term)).toBeNull();
    expect(() => term.write("hello")).not.toThrow();

    term.dispose();
  });
});
