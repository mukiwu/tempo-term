import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@/i18n";

// IS_WINDOWS is a module-load const; expose it through a getter so each test can
// flip the platform without re-importing the module.
const platformMock = vi.hoisted(() => ({ isWindows: true }));
vi.mock("@/lib/platform", () => ({
  get IS_WINDOWS() {
    return platformMock.isWindows;
  },
}));

const { minimizeWindow, toggleMaximizeWindow, closeWindow } = vi.hoisted(() => ({
  minimizeWindow: vi.fn(),
  toggleMaximizeWindow: vi.fn(),
  closeWindow: vi.fn(),
}));
vi.mock("@/lib/window", () => ({ minimizeWindow, toggleMaximizeWindow, closeWindow }));

import { TitleBar } from "./TitleBar";

beforeEach(() => {
  platformMock.isWindows = true;
  minimizeWindow.mockReset();
  toggleMaximizeWindow.mockReset();
  closeWindow.mockReset();
});

describe("TitleBar", () => {
  it("renders nothing on non-Windows platforms", () => {
    platformMock.isWindows = false;
    const { container } = render(<TitleBar />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders minimize, maximize and close controls on Windows", () => {
    render(<TitleBar />);
    expect(screen.getByLabelText("Minimize")).toBeInTheDocument();
    expect(screen.getByLabelText("Maximize")).toBeInTheDocument();
    expect(screen.getByLabelText("Close")).toBeInTheDocument();
  });

  it("drives the window controls when the buttons are clicked", () => {
    render(<TitleBar />);
    fireEvent.click(screen.getByLabelText("Minimize"));
    fireEvent.click(screen.getByLabelText("Maximize"));
    fireEvent.click(screen.getByLabelText("Close"));
    expect(minimizeWindow).toHaveBeenCalledOnce();
    expect(toggleMaximizeWindow).toHaveBeenCalledOnce();
    expect(closeWindow).toHaveBeenCalledOnce();
  });
});
