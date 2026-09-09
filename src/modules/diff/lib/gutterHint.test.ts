import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withGutterHint } from "./gutterHint";

function icon() {
  const el = document.createElement("span");
  document.body.appendChild(el);
  return withGutterHint(el, "Add Comment");
}

const hints = () => document.querySelectorAll(".cm-gutter-hint");

describe("withGutterHint", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = "";
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the label while the pointer is on the icon", () => {
    const el = icon();

    el.dispatchEvent(new MouseEvent("mouseenter"));
    expect(hints().length).toBe(1);
    expect(document.querySelector(".cm-gutter-hint")?.textContent).toBe("Add Comment");

    el.dispatchEvent(new MouseEvent("mouseleave"));
    expect(hints().length).toBe(0);
  });

  it("takes the hint down when the icon is destroyed under the pointer", () => {
    const el = icon();
    el.dispatchEvent(new MouseEvent("mouseenter"));
    expect(hints().length).toBe(1);

    // What the all-changes view does when a file scrolls out of its mounted
    // window: the whole editor goes, so mouseleave never fires.
    el.remove();
    expect(hints().length).toBe(1);

    vi.advanceTimersByTime(300);
    expect(hints().length).toBe(0);
  });

  it("stops checking once the hint is down", () => {
    const el = icon();
    el.dispatchEvent(new MouseEvent("mouseenter"));
    el.dispatchEvent(new MouseEvent("mouseleave"));

    expect(vi.getTimerCount()).toBe(0);
  });
});
