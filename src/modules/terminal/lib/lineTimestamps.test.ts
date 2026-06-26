import { describe, expect, it } from "vitest";
import { createLineTimestamps } from "./lineTimestamps";

describe("createLineTimestamps", () => {
  it("stamps every line in the written range with the write time", () => {
    const stamps = createLineTimestamps();

    stamps.stamp(0, 2, 1000);

    expect(stamps.get(0)).toBe(1000);
    expect(stamps.get(1)).toBe(1000);
    expect(stamps.get(2)).toBe(1000);
    expect(stamps.get(3)).toBeUndefined();
  });

  it("keeps the first write time for a line (does not overwrite)", () => {
    const stamps = createLineTimestamps();

    stamps.stamp(0, 0, 1000);
    stamps.stamp(0, 0, 2000);

    expect(stamps.get(0)).toBe(1000);
  });

  it("prunes the oldest entries once it exceeds max", () => {
    const stamps = createLineTimestamps({ max: 2 });

    stamps.stamp(0, 0, 1);
    stamps.stamp(1, 1, 2);
    stamps.stamp(2, 2, 3);

    expect(stamps.size).toBe(2);
    expect(stamps.get(0)).toBeUndefined();
    expect(stamps.get(1)).toBe(2);
    expect(stamps.get(2)).toBe(3);
  });
});
