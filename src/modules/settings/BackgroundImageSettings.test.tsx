import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSettingsStore } from "@/stores/settingsStore";
import { BackgroundImageSettings } from "./BackgroundImageSettings";

const { invokeMock, openMock, dragDropState } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  openMock: vi.fn(),
  dragDropState: {
    handler: null as null | ((event: { payload: Record<string, unknown> }) => void),
    unlisten: vi.fn(),
  },
}));

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => path,
  invoke: invokeMock,
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: openMock,
}));

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: (
      handler: (event: { payload: Record<string, unknown> }) => void,
    ) => {
      dragDropState.handler = handler;
      return Promise.resolve(dragDropState.unlisten);
    },
  }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe("BackgroundImageSettings", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    openMock.mockReset();
    dragDropState.handler = null;
    dragDropState.unlisten.mockReset();
    useSettingsStore.setState({
      backgroundImagePath: null,
      backgroundImageOpacity: 20,
      terminalBackgroundImageOpacity: 35,
      backgroundImageScope: "workspace",
      backgroundImageTextColor: null,
    });
  });

  it("leaves settings unchanged when the file picker is cancelled", async () => {
    openMock.mockResolvedValue(null);
    render(<BackgroundImageSettings />);

    fireEvent.click(screen.getByRole("button", { name: "background.choose" }));

    await waitFor(() => expect(openMock).toHaveBeenCalledTimes(1));
    expect(invokeMock).not.toHaveBeenCalled();
    expect(useSettingsStore.getState().backgroundImagePath).toBeNull();
  });

  it("imports a selected image and shows its preview", async () => {
    openMock.mockResolvedValue("/pictures/夜景.png");
    invokeMock.mockResolvedValue("/app-data/appearance/background-1.png");
    render(<BackgroundImageSettings />);

    fireEvent.click(screen.getByRole("button", { name: "background.choose" }));

    await waitFor(() =>
      expect(useSettingsStore.getState().backgroundImagePath).toBe(
        "/app-data/appearance/background-1.png",
      ),
    );
    expect(invokeMock).toHaveBeenCalledWith("appearance_save_background_image", {
      sourcePath: "/pictures/夜景.png",
    });
    expect(screen.getByRole("img", { name: "background.previewAlt" })).toHaveAttribute(
      "src",
      "/app-data/appearance/background-1.png",
    );
  });

  it("replaces the image when one native file is dropped on the preview", async () => {
    useSettingsStore.setState({
      backgroundImagePath: "/app-data/appearance/current.png",
    });
    invokeMock.mockResolvedValue("/app-data/appearance/replacement.webp");
    render(<BackgroundImageSettings />);

    const preview = screen.getByTestId("background-image-preview");
    vi.spyOn(preview, "getBoundingClientRect").mockReturnValue({
      left: 10,
      top: 20,
      right: 410,
      bottom: 245,
      width: 400,
      height: 225,
      x: 10,
      y: 20,
      toJSON: () => ({}),
    });
    await waitFor(() => expect(dragDropState.handler).not.toBeNull());

    act(() => {
      dragDropState.handler?.({
        payload: {
          type: "enter",
          paths: ["/pictures/replacement.webp"],
          position: { x: 100, y: 100 },
        },
      });
    });
    expect(screen.getByText("background.dropReplace")).toBeVisible();

    act(() => {
      dragDropState.handler?.({
        payload: {
          type: "drop",
          paths: ["/pictures/replacement.webp"],
          position: { x: 100, y: 100 },
        },
      });
    });

    await waitFor(() =>
      expect(useSettingsStore.getState().backgroundImagePath).toBe(
        "/app-data/appearance/replacement.webp",
      ),
    );
    expect(invokeMock).toHaveBeenCalledWith("appearance_save_background_image", {
      sourcePath: "/pictures/replacement.webp",
    });
  });

  it("rejects a multi-file drop without replacing the current image", async () => {
    useSettingsStore.setState({
      backgroundImagePath: "/app-data/appearance/current.png",
    });
    render(<BackgroundImageSettings />);

    const preview = screen.getByTestId("background-image-preview");
    vi.spyOn(preview, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      right: 400,
      bottom: 225,
      width: 400,
      height: 225,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    await waitFor(() => expect(dragDropState.handler).not.toBeNull());

    act(() => {
      dragDropState.handler?.({
        payload: {
          type: "drop",
          paths: ["/pictures/one.png", "/pictures/two.jpg"],
          position: { x: 100, y: 100 },
        },
      });
    });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "background.dropSingleError",
    );
    expect(invokeMock).not.toHaveBeenCalled();
    expect(useSettingsStore.getState().backgroundImagePath).toBe(
      "/app-data/appearance/current.png",
    );
  });

  it("updates scope and opacity through accessible controls", () => {
    useSettingsStore.setState({
      backgroundImagePath: "/app-data/appearance/background.png",
    });
    render(<BackgroundImageSettings />);

    fireEvent.click(screen.getByRole("button", { name: "background.scope.window" }));
    fireEvent.change(screen.getByLabelText("background.opacity"), {
      target: { value: "61" },
    });
    fireEvent.change(screen.getByLabelText("background.terminalOpacity"), {
      target: { value: "48" },
    });

    expect(useSettingsStore.getState().backgroundImageScope).toBe("window");
    expect(useSettingsStore.getState().backgroundImageOpacity).toBe(61);
    expect(useSettingsStore.getState().terminalBackgroundImageOpacity).toBe(48);
    expect(screen.getByText("61%")).toBeInTheDocument();
    expect(screen.getByText("48%")).toBeInTheDocument();
  });

  it("sets and resets a background-specific text colour", () => {
    useSettingsStore.setState({
      backgroundImagePath: "/app-data/appearance/background.png",
    });
    render(<BackgroundImageSettings />);

    fireEvent.change(screen.getByLabelText("background.textColor"), {
      target: { value: "#f4f7ff" },
    });
    expect(useSettingsStore.getState().backgroundImageTextColor).toBe("#f4f7ff");

    fireEvent.click(screen.getByRole("button", { name: "background.textColorReset" }));
    expect(useSettingsStore.getState().backgroundImageTextColor).toBeNull();
  });

  it("removes only after the backend succeeds", async () => {
    useSettingsStore.setState({
      backgroundImagePath: "/app-data/appearance/background.png",
    });
    invokeMock.mockResolvedValue(undefined);
    render(<BackgroundImageSettings />);

    fireEvent.click(screen.getByRole("button", { name: "background.remove" }));

    await waitFor(() => expect(useSettingsStore.getState().backgroundImagePath).toBeNull());
    expect(invokeMock).toHaveBeenCalledWith("appearance_remove_background_image");
  });

  it("keeps the current image and reports an inline error when replacement fails", async () => {
    useSettingsStore.setState({
      backgroundImagePath: "/app-data/appearance/current.png",
    });
    openMock.mockResolvedValue("/pictures/too-large.png");
    invokeMock.mockRejectedValue(new Error("too large"));
    render(<BackgroundImageSettings />);

    fireEvent.click(screen.getByRole("button", { name: "background.replace" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("background.saveError");
    expect(useSettingsStore.getState().backgroundImagePath).toBe(
      "/app-data/appearance/current.png",
    );
  });

  it("surfaces a load error instead of leaving a blank preview", () => {
    useSettingsStore.setState({
      backgroundImagePath: "/app-data/appearance/broken.png",
    });
    render(<BackgroundImageSettings />);

    fireEvent.error(screen.getByRole("img", { name: "background.previewAlt" }));

    expect(screen.getByRole("alert")).toHaveTextContent("background.loadError");
    expect(screen.getByText("background.previewUnavailable")).toBeInTheDocument();
  });
});
