import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { FileIcon } from "./FileIcon";

describe("FileIcon", () => {
  it("renders an svg for a known file type", () => {
    const { container } = render(<FileIcon name="main.ts" isDir={false} />);
    expect(container.querySelector("svg")).toBeTruthy();
  });

  it("renders a folder svg when isDir", () => {
    const { container } = render(<FileIcon name="src" isDir open={false} />);
    expect(container.querySelector("svg")).toBeTruthy();
  });

  it("renders a fallback svg for unknown file types", () => {
    const { container } = render(<FileIcon name="x.zzz" isDir={false} />);
    expect(container.querySelector("svg")).toBeTruthy();
  });
});
