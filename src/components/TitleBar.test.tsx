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

const {
  minimizeWindow,
  toggleMaximizeWindow,
  closeWindow,
  isWindowMaximized,
  onWindowResized,
  emitWindowMenuEvent,
} = vi.hoisted(() => ({
  minimizeWindow: vi.fn(),
  toggleMaximizeWindow: vi.fn(),
  closeWindow: vi.fn(),
  isWindowMaximized: vi.fn(),
  onWindowResized: vi.fn(),
  emitWindowMenuEvent: vi.fn(),
}));
vi.mock("@/lib/window", () => ({
  minimizeWindow,
  toggleMaximizeWindow,
  closeWindow,
  isWindowMaximized,
  onWindowResized,
  emitWindowMenuEvent,
}));

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import { TitleBar } from "./TitleBar";

beforeEach(() => {
  platformMock.isWindows = true;
  minimizeWindow.mockReset();
  toggleMaximizeWindow.mockReset();
  closeWindow.mockReset();
  isWindowMaximized.mockReset().mockResolvedValue(false);
  onWindowResized.mockReset().mockResolvedValue(() => {});
  emitWindowMenuEvent.mockReset().mockResolvedValue(undefined);
  invoke.mockReset().mockResolvedValue(undefined);
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

  it("shows the restore control once the window reports it is maximized", async () => {
    isWindowMaximized.mockResolvedValue(true);
    render(<TitleBar />);
    expect(await screen.findByLabelText("Restore")).toBeInTheDocument();
    expect(screen.queryByLabelText("Maximize")).toBeNull();
  });

  it("opens the File menu and runs each action through the shared handlers", () => {
    render(<TitleBar />);
    fireEvent.click(screen.getByRole("button", { name: "File" }));

    fireEvent.click(screen.getByRole("menuitem", { name: /New Window/ }));
    expect(invoke).toHaveBeenCalledWith("open_new_window");

    fireEvent.click(screen.getByRole("button", { name: "File" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Close Tab/ }));
    expect(emitWindowMenuEvent).toHaveBeenCalledWith("menu:close-tab");
  });

  it("selecting an item closes the menu", () => {
    render(<TitleBar />);
    fireEvent.click(screen.getByRole("button", { name: "Window" }));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: /Close Window/ }));
    expect(closeWindow).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("clicking the open menu button toggles it shut", () => {
    render(<TitleBar />);
    const fileButton = screen.getByRole("button", { name: "File" });
    fireEvent.click(fileButton);
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.click(fileButton);
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
