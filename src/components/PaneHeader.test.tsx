import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

import { PaneHeader } from "./PaneHeader";

describe("PaneHeader", () => {
  it("renders the left content and actions, and closes on the close button", () => {
    const onClose = vi.fn();
    render(
      <PaneHeader
        left={<span>somewhere</span>}
        actions={<button type="button">act</button>}
        showClose
        onClose={onClose}
      />,
    );

    expect(screen.getByText("somewhere")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "act" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "workspace.closePane" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("hides the close button when showClose is false (single pane)", () => {
    render(<PaneHeader showClose={false} onClose={vi.fn()} />);

    expect(screen.queryByRole("button", { name: "workspace.closePane" })).toBeNull();
  });
});
