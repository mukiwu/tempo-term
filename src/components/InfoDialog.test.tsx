import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { InfoDialog } from "./InfoDialog";

describe("InfoDialog", () => {
  it("renders the title and message", () => {
    render(
      <InfoDialog title="Heads up" message="Something happened" confirmLabel="OK" onConfirm={() => {}} />,
    );
    expect(screen.getByText("Heads up")).toBeInTheDocument();
    expect(screen.getByText("Something happened")).toBeInTheDocument();
  });

  it("calls onConfirm when the confirm button is clicked", () => {
    const onConfirm = vi.fn();
    render(
      <InfoDialog title="Heads up" message="Something happened" confirmLabel="OK" onConfirm={onConfirm} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("calls onConfirm when Escape or Enter is pressed", () => {
    const onConfirm = vi.fn();
    render(
      <InfoDialog title="Heads up" message="Something happened" confirmLabel="OK" onConfirm={onConfirm} />,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onConfirm).toHaveBeenCalledTimes(2);
  });
});
