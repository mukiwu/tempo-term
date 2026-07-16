import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts?.name ? `${key}:${opts.name}` : key,
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

import { Breadcrumb } from "./Breadcrumb";

const crumbs = [
  { label: "tempo-term", path: "/w/tempo-term" },
  { label: "src", path: "/w/tempo-term/src" },
];

describe("Breadcrumb tree menu (terminal)", () => {
  function renderTree(loadChildren: (path: string) => Promise<{ label: string; path: string }[]>) {
    const onSelect = vi.fn();
    render(
      <Breadcrumb
        crumbs={crumbs}
        onSelect={onSelect}
        menu={{ kind: "tree", loadChildren }}
      />,
    );
    return onSelect;
  }

  it("lists the clicked segment first, then its child directories", async () => {
    const loadChildren = vi.fn().mockResolvedValue([
      { label: "components", path: "/w/tempo-term/src/components" },
      { label: "modules", path: "/w/tempo-term/src/modules" },
    ]);
    renderTree(loadChildren);

    fireEvent.click(screen.getByRole("button", { name: "src" }));
    expect(await screen.findByRole("menuitem", { name: "components" })).toBeInTheDocument();
    expect(loadChildren).toHaveBeenCalledWith("/w/tempo-term/src");
    // The segment itself heads the menu, so cd-ing back to an ancestor works.
    expect(screen.getAllByRole("menuitem")[0]).toHaveTextContent("src");
  });

  it("cds when a directory's name is clicked", async () => {
    const loadChildren = vi.fn().mockResolvedValue([
      { label: "modules", path: "/w/tempo-term/src/modules" },
    ]);
    const onSelect = renderTree(loadChildren);

    fireEvent.click(screen.getByRole("button", { name: "src" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "modules" }));

    expect(onSelect).toHaveBeenCalledWith("/w/tempo-term/src/modules");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("expands a directory in place when its + is clicked, without cd-ing", async () => {
    const loadChildren = vi
      .fn()
      .mockImplementation((path: string) =>
        path === "/w/tempo-term/src"
          ? Promise.resolve([{ label: "modules", path: "/w/tempo-term/src/modules" }])
          : Promise.resolve([{ label: "terminal", path: "/w/tempo-term/src/modules/terminal" }]),
      );
    const onSelect = renderTree(loadChildren);

    fireEvent.click(screen.getByRole("button", { name: "src" }));
    await screen.findByRole("menuitem", { name: "modules" });
    fireEvent.click(screen.getByRole("button", { name: "breadcrumb.expand:modules" }));

    const grandchild = await screen.findByRole("menuitem", { name: "terminal" });
    expect(grandchild).toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();

    // The expanded child cds like any other row.
    fireEvent.click(grandchild);
    expect(onSelect).toHaveBeenCalledWith("/w/tempo-term/src/modules/terminal");
  });

  it("collapses an expanded directory when its toggle is clicked again", async () => {
    const loadChildren = vi
      .fn()
      .mockImplementation((path: string) =>
        path === "/w/tempo-term/src"
          ? Promise.resolve([{ label: "modules", path: "/w/tempo-term/src/modules" }])
          : Promise.resolve([{ label: "terminal", path: "/w/tempo-term/src/modules/terminal" }]),
      );
    renderTree(loadChildren);

    fireEvent.click(screen.getByRole("button", { name: "src" }));
    await screen.findByRole("menuitem", { name: "modules" });
    fireEvent.click(screen.getByRole("button", { name: "breadcrumb.expand:modules" }));
    await screen.findByRole("menuitem", { name: "terminal" });

    fireEvent.click(screen.getByRole("button", { name: "breadcrumb.collapse:modules" }));
    expect(screen.queryByRole("menuitem", { name: "terminal" })).toBeNull();
  });
});

describe("Breadcrumb flat list menu (editor)", () => {
  it("lists the provided items flat and reports the chosen path", async () => {
    const loadItems = vi.fn().mockResolvedValue([
      { label: "App.tsx", path: "/w/src/App.tsx" },
      { label: "main.tsx", path: "/w/src/main.tsx" },
    ]);
    const onSelect = vi.fn();
    render(
      <Breadcrumb
        crumbs={[{ label: "App.tsx", path: "/w/src/App.tsx" }]}
        onSelect={onSelect}
        clickable="last"
        menu={{ kind: "list", loadItems }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "App.tsx" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "main.tsx" }));

    expect(loadItems).toHaveBeenCalledWith({ label: "App.tsx", path: "/w/src/App.tsx" });
    expect(onSelect).toHaveBeenCalledWith("/w/src/main.tsx");
    // A flat list never grows expand toggles.
    expect(screen.queryByRole("button", { name: "breadcrumb.expand:main.tsx" })).toBeNull();
  });

  it("only offers the last segment when clickable is \"last\"", () => {
    render(
      <Breadcrumb
        crumbs={crumbs}
        onSelect={vi.fn()}
        clickable="last"
        menu={{ kind: "list", loadItems: vi.fn().mockResolvedValue([]) }}
      />,
    );

    expect(screen.queryByRole("button", { name: "tempo-term" })).toBeNull();
    expect(screen.getByRole("button", { name: "src" })).toBeInTheDocument();
  });
});
