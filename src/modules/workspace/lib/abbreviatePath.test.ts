import { describe, expect, it } from "vitest";
import { abbreviateHome } from "./abbreviatePath";

describe("abbreviateHome", () => {
  it("collapses a macOS home prefix to ~", () => {
    expect(abbreviateHome("/Users/muki/Documents/proj")).toBe("~/Documents/proj");
  });

  it("collapses a Linux home prefix to ~", () => {
    expect(abbreviateHome("/home/muki/dev")).toBe("~/dev");
  });

  it("collapses a bare home directory to ~", () => {
    expect(abbreviateHome("/Users/muki")).toBe("~");
  });

  it("leaves Windows drive paths untouched", () => {
    expect(abbreviateHome("C:\\Users\\muki\\dev")).toBe("C:\\Users\\muki\\dev");
  });

  it("leaves paths outside a home directory untouched", () => {
    expect(abbreviateHome("/opt/data")).toBe("/opt/data");
  });

  it("does not treat a deeper segment as a home prefix", () => {
    expect(abbreviateHome("/opt/Users/muki/dev")).toBe("/opt/Users/muki/dev");
  });
});
