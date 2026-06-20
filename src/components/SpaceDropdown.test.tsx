import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import "@/i18n";
import { SpaceDropdown } from "./SpaceDropdown";
import { useTabsStore } from "@/stores/tabsStore";

beforeEach(() => {
  useTabsStore.setState({
    spaces: [
      { id: "s1", name: "Salon" },
      { id: "s2", name: "Studio" },
    ],
    activeSpaceId: "s1",
    activeId: null,
    tabs: [],
  });
});

describe("SpaceDropdown switcher", () => {
  it("switches the active workspace when a space is picked", () => {
    render(<SpaceDropdown />);
    fireEvent.click(screen.getByRole("button", { name: "Salon" }));
    fireEvent.click(screen.getByRole("button", { name: "Studio" }));
    expect(useTabsStore.getState().activeSpaceId).toBe("s2");
  });

  it("no longer exposes create, rename, or delete controls", () => {
    render(<SpaceDropdown />);
    fireEvent.click(screen.getByRole("button", { name: "Salon" }));
    expect(screen.queryByRole("button", { name: "New space" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Rename space" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete space" })).toBeNull();
  });
});
