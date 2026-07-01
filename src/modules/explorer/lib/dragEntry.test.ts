import { describe, expect, it } from "vitest";
import {
  consumeDragClick,
  fileUrl,
  getDraggedEntry,
  isOverTabBar,
  markdownLink,
  pointerToPaneAreaPct,
  setDraggedEntry,
  shellQuotePath,
} from "./dragEntry";

describe("shellQuotePath", () => {
  it("leaves simple paths unquoted", () => {
    expect(shellQuotePath("/Users/me/proj/App.tsx")).toBe("/Users/me/proj/App.tsx");
  });

  it("quotes paths containing spaces", () => {
    expect(shellQuotePath("/Users/me/My Project/a.md")).toBe(
      "'/Users/me/My Project/a.md'",
    );
  });

  it("escapes embedded single quotes", () => {
    expect(shellQuotePath("/a/it's/b")).toBe("'/a/it'\\''s/b'");
  });
});

describe("markdownLink", () => {
  it("builds a markdown link", () => {
    expect(markdownLink("App.tsx", "/x/App.tsx")).toBe("[App.tsx](/x/App.tsx)");
  });
});

describe("fileUrl", () => {
  it("prefixes file://", () => {
    expect(fileUrl("/x/index.html")).toBe("file:///x/index.html");
  });
});

describe("getDraggedEntry / setDraggedEntry", () => {
  it("round-trips the dragged entry and clears to null", () => {
    expect(getDraggedEntry()).toBeNull();
    const entry = { path: "/a/b.ts", name: "b.ts", isDir: false };
    setDraggedEntry(entry);
    expect(getDraggedEntry()).toEqual(entry);
    setDraggedEntry(null);
    expect(getDraggedEntry()).toBeNull();
  });
});

describe("consumeDragClick", () => {
  it("is false when no drag has just finished", () => {
    expect(consumeDragClick()).toBe(false);
  });
});

describe("pointerToPaneAreaPct", () => {
  it("converts a client point to a 0-100 percentage of the given container rect", () => {
    const containerRect = { left: 100, top: 50, width: 400, height: 200 } as DOMRect;
    expect(pointerToPaneAreaPct(containerRect, 300, 150)).toEqual({ xPct: 50, yPct: 50 });
  });

  it("clamps to 0-100 when the point is outside the container (fast pointer movement)", () => {
    const containerRect = { left: 0, top: 0, width: 100, height: 100 } as DOMRect;
    expect(pointerToPaneAreaPct(containerRect, -20, 250)).toEqual({ xPct: 0, yPct: 100 });
  });
});

describe("tab-bar drop priority", () => {
  it("isOverTabBar resolves true when the element is inside a data-tab-bar container", () => {
    const outer = document.createElement("div");
    outer.dataset.tabBar = "";
    const inner = document.createElement("div");
    outer.appendChild(inner);
    expect(isOverTabBar(inner)).toBe(true);
  });

  it("isOverTabBar resolves false otherwise", () => {
    expect(isOverTabBar(document.createElement("div"))).toBe(false);
  });
});
