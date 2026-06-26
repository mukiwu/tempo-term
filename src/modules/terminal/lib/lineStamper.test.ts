import { describe, expect, it } from "vitest";
import { createTerminal } from "./createTerminal";
import { createLineTimestamps } from "./lineTimestamps";
import { attachLineStamper } from "./lineStamper";
import { computeVisibleStamps } from "./gutterLines";
import type { Terminal } from "@xterm/xterm";

function writeAsync(term: Terminal, data: string): Promise<void> {
  return new Promise((resolve) => term.write(data, resolve));
}

describe("attachLineStamper", () => {
  it("stamps every line of multi-line output once armed", async () => {
    const { term } = createTerminal();
    const container = document.createElement("div");
    document.body.appendChild(container);
    term.open(container);

    const stamps = createLineTimestamps();
    const stamper = attachLineStamper(term, stamps);
    stamper.arm();

    await writeAsync(term, "alpha\r\n");
    await writeAsync(term, "beta\r\ngamma\r\ndelta\r\n");

    expect(stamps.get(0)).toBeDefined(); // alpha
    expect(stamps.get(1)).toBeDefined(); // beta
    expect(stamps.get(2)).toBeDefined(); // gamma
    expect(stamps.get(3)).toBeDefined(); // delta

    stamper.dispose();
    term.dispose();
    container.remove();
  });

  it("keeps stamping past one screenful, and the gutter read path sees the visible rows", async () => {
    const { term } = createTerminal();
    const container = document.createElement("div");
    document.body.appendChild(container);
    term.open(container);

    const stamps = createLineTimestamps();
    const stamper = attachLineStamper(term, stamps);
    stamper.arm();

    for (let i = 0; i < 60; i += 1) {
      await writeAsync(term, `line ${i}\r\n`);
    }

    const buffer = term.buffer.active;
    const visible = computeVisibleStamps({
      rows: term.rows,
      viewportY: buffer.viewportY,
      getStamp: (line) => stamps.get(line),
      isWrapped: (line) => buffer.getLine(line)?.isWrapped ?? false,
    });
    // Every visible row that holds written content should resolve to a stamp;
    // only the trailing empty cursor row may be blank.
    const stamped = visible.filter((v) => v.ts !== null);
    expect(stamped.length).toBeGreaterThanOrEqual(term.rows - 1);

    stamper.dispose();
    term.dispose();
    container.remove();
  });
});
