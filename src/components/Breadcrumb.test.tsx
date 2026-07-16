import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Breadcrumb } from "./Breadcrumb";

const crumbs = [
  { label: "tempo-term", path: "/w/tempo-term" },
  { label: "src", path: "/w/tempo-term/src" },
];

describe("Breadcrumb", () => {
  it("opens a sibling menu on segment click and reports the chosen path", async () => {
    const loadSiblings = vi.fn().mockResolvedValue([
      { label: "src", path: "/w/tempo-term/src" },
      { label: "docs", path: "/w/tempo-term/docs" },
    ]);
    const onSelect = vi.fn();
    render(<Breadcrumb crumbs={crumbs} loadSiblings={loadSiblings} onSelect={onSelect} />);

    fireEvent.click(screen.getByRole("button", { name: "src" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "docs" }));

    expect(loadSiblings).toHaveBeenCalledWith(crumbs[1]);
    expect(onSelect).toHaveBeenCalledWith("/w/tempo-term/docs");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("only offers the last segment when clickable is \"last\"", () => {
    const loadSiblings = vi.fn().mockResolvedValue([]);
    render(
      <Breadcrumb
        crumbs={crumbs}
        loadSiblings={loadSiblings}
        onSelect={vi.fn()}
        clickable="last"
      />,
    );

    expect(screen.queryByRole("button", { name: "tempo-term" })).toBeNull();
    expect(screen.getByRole("button", { name: "src" })).toBeInTheDocument();
  });
});
