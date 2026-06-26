import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ActionCard } from "./ActionCard";
import "../../i18n";

describe("ActionCard", () => {
  it("runs a safe action immediately when its button is clicked", () => {
    const onRun = vi.fn();
    render(
      <ActionCard
        actions={[{ labelKey: "actionLinks.ping", command: "ping 1.2.3.4" }]}
        onRun={onRun}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /ping 1\.2\.3\.4/ }));

    expect(onRun).toHaveBeenCalledWith("ping 1.2.3.4");
  });

  it("asks for confirmation before running a dangerous command", () => {
    const onRun = vi.fn();
    render(
      <ActionCard
        actions={[{ labelKey: "actionLinks.extract", command: "rm -rf /tmp/x" }]}
        onRun={onRun}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /rm -rf/ }));
    expect(onRun).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /run anyway/i }));
    expect(onRun).toHaveBeenCalledWith("rm -rf /tmp/x");
  });

  it("does not run a dangerous command when the confirmation is cancelled", () => {
    const onRun = vi.fn();
    render(
      <ActionCard
        actions={[{ labelKey: "actionLinks.extract", command: "rm -rf /tmp/x" }]}
        onRun={onRun}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /rm -rf/ }));
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(onRun).not.toHaveBeenCalled();
  });
});
