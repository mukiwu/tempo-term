import { createEvent, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RefChipStrip } from "./RefChipStrip";
import type { RefChipOptions } from "./lib/refChips";
import type { CommitRef } from "./types";

const LABELS = { refHint: "{{name}}", moreRefs: "{{count}} more" };
const OPTIONS: RefChipOptions = {
  mergeLocalRemote: true,
  hideOriginHead: true,
  collapseAfter: 3,
};

function ref(kind: string, name: string): CommitRef {
  return { kind, name };
}

describe("RefChipStrip", () => {
  function chipOf(text: string): HTMLElement {
    return screen.getByText(text).closest("span.rounded.border") as HTMLElement;
  }

  it("paints one chip for a branch and its remotes, and drops origin/HEAD", () => {
    render(
      <RefChipStrip
        refs={[ref("head", "master"), ref("remote", "origin/master"), ref("remote", "origin/HEAD")]}
        options={OPTIONS}
        labels={LABELS}
      />,
    );

    // One chip, two blocks: the branch and the remote that carries it.
    const chip = chipOf("master");
    expect(chip.textContent).toBe("masterorigin");
    expect(chipOf("origin")).toBe(chip);
    expect(screen.queryByText("origin/HEAD")).toBeNull();
  });

  it("hands the merged remotes to the context-menu handler, not just the local ref", () => {
    const onRefContextMenu = vi.fn();
    render(
      <RefChipStrip
        refs={[ref("head", "master"), ref("remote", "origin/master")]}
        options={OPTIONS}
        labels={LABELS}
        onRefContextMenu={onRefContextMenu}
      />,
    );

    fireEvent.contextMenu(chipOf("origin"), { clientX: 5, clientY: 7 });
    expect(onRefContextMenu).toHaveBeenCalledWith(
      { kind: "head", name: "master" },
      [{ kind: "remote", name: "origin/master" }],
      5,
      7,
    );
  });

  it("keeps the row short with a +N chip that lists the rest on click", () => {
    render(
      <RefChipStrip
        refs={[
          ref("head", "master"),
          ref("branch", "a"),
          ref("branch", "b"),
          ref("branch", "c"),
          ref("tag", "v1"),
        ]}
        options={OPTIONS}
        labels={LABELS}
      />,
    );

    expect(screen.queryByText("c")).toBeNull();
    const more = screen.getByRole("button", { name: "+2" });
    fireEvent.click(more);

    expect(screen.getByText("c")).toBeTruthy();
    expect(screen.getByText("v1")).toBeTruthy();
  });

  it("right-clicking an overflow chip opens its menu and leaves the list up", () => {
    const onRefContextMenu = vi.fn();
    render(
      <RefChipStrip
        refs={[ref("branch", "a"), ref("branch", "b"), ref("branch", "c"), ref("branch", "d")]}
        options={OPTIONS}
        labels={LABELS}
        onRefContextMenu={onRefContextMenu}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "+1" }));
    fireEvent.contextMenu(screen.getByText("d"), { clientX: 1, clientY: 2 });

    expect(onRefContextMenu).toHaveBeenCalledWith({ kind: "branch", name: "d" }, [], 1, 2);
    // The other refs stay a right-click away instead of vanishing under the menu.
    expect(screen.getByText("d")).toBeTruthy();
  });

  it("opens the list on a right-click too, rather than dead-ending there", () => {
    const onRefContextMenu = vi.fn();
    render(
      <RefChipStrip
        refs={[ref("branch", "a"), ref("branch", "b"), ref("branch", "c"), ref("branch", "d")]}
        options={OPTIONS}
        labels={LABELS}
        onRefContextMenu={onRefContextMenu}
      />,
    );

    const more = screen.getByRole("button", { name: "+1" });
    const event = createEvent.contextMenu(more);
    fireEvent(more, event);

    expect(event.defaultPrevented).toBe(true);
    expect(screen.getByText("d")).toBeTruthy();
    // It is not a ref, so it never opens a ref menu of its own.
    expect(onRefContextMenu).not.toHaveBeenCalled();
  });

  it("keeps the list under the tooltip layer so its chips' tooltips stay visible", () => {
    render(
      <RefChipStrip
        refs={[ref("branch", "a"), ref("branch", "b"), ref("branch", "c"), ref("branch", "d")]}
        options={OPTIONS}
        labels={LABELS}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "+1" }));
    const list = screen.getByText("d").closest("div[class*='z-']") as HTMLElement;
    // Tooltip renders at z-100, the ref context menu at z-200.
    expect(list.className).toContain("z-[95]");
  });

  it("gives the chips with a menu a hover state, and read-only ones none", () => {
    render(
      <RefChipStrip
        refs={[ref("branch", "a"), ref("unknown", "refs/notes/commits")]}
        options={OPTIONS}
        labels={LABELS}
      />,
    );

    expect(chipOf("a").className).toContain("hover:");
    // Lighting up would promise a right-click menu this ref does not have.
    expect(chipOf("refs/notes/commits").className).not.toContain("hover:");
  });

  it("leaves every ref on the row when the user turns the options off", () => {
    render(
      <RefChipStrip
        refs={[ref("head", "master"), ref("remote", "origin/master"), ref("remote", "origin/HEAD")]}
        options={{ mergeLocalRemote: false, hideOriginHead: false, collapseAfter: null }}
        labels={LABELS}
      />,
    );

    expect(screen.getByText("master")).toBeTruthy();
    expect(screen.getByText("origin/master")).toBeTruthy();
    expect(screen.getByText("origin/HEAD")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
