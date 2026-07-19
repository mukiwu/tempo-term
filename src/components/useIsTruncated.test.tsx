import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useIsTruncated } from "./useIsTruncated";

function Probe({ text }: { text: string }) {
  const [ref, truncated] = useIsTruncated(text);
  return (
    <span ref={ref} data-testid="probe" data-truncated={truncated}>
      {text}
    </span>
  );
}

describe("useIsTruncated", () => {
  // jsdom does no layout, so fake the overflow measurements the hook reads.
  let scrollWidth = 0;
  let clientWidth = 0;
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, "scrollWidth", {
      configurable: true,
      get: () => scrollWidth,
    });
    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get: () => clientWidth,
    });
  });
  afterEach(() => {
    delete (HTMLElement.prototype as { scrollWidth?: number }).scrollWidth;
    delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
  });

  it("is true when the content overflows the element", () => {
    scrollWidth = 200;
    clientWidth = 100;
    render(<Probe text="long title" />);
    expect(screen.getByTestId("probe")).toHaveAttribute("data-truncated", "true");
  });

  it("is false when the content fits", () => {
    scrollWidth = 100;
    clientWidth = 100;
    render(<Probe text="short" />);
    expect(screen.getByTestId("probe")).toHaveAttribute("data-truncated", "false");
  });

  it("re-measures when the text changes", () => {
    scrollWidth = 100;
    clientWidth = 100;
    const { rerender } = render(<Probe text="short" />);
    expect(screen.getByTestId("probe")).toHaveAttribute("data-truncated", "false");

    scrollWidth = 300;
    rerender(<Probe text="a much longer title" />);
    expect(screen.getByTestId("probe")).toHaveAttribute("data-truncated", "true");
  });
});
