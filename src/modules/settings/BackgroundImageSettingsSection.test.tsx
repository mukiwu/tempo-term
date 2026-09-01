import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSettingsStore } from "@/stores/settingsStore";
import { useBackgroundImageDraftStore } from "@/stores/backgroundImageDraftStore";
import { listenToNativeDragDrop } from "@/lib/nativeDragCoordinates";
import { BackgroundImageSettingsSection } from "./BackgroundImageSettingsSection";

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

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: openMock }));

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

describe("BackgroundImageSettingsSection", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    openMock.mockReset();
    dragDropState.handler = null;
    dragDropState.unlisten.mockReset();
    useBackgroundImageDraftStore.getState().cancel();
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
    render(<BackgroundImageSettingsSection />);

    fireEvent.click(screen.getByRole("button", { name: "background.dropZoneLabel" }));

    await waitFor(() => expect(openMock).toHaveBeenCalledTimes(1));
    expect(invokeMock).not.toHaveBeenCalled();
    expect(useSettingsStore.getState().backgroundImagePath).toBeNull();
  });

  it("keeps a new image and all controls in a draft until apply", async () => {
    openMock.mockResolvedValue("/pictures/夜景.png");
    invokeMock.mockResolvedValue("/app-data/appearance/background-1.png");
    render(<BackgroundImageSettingsSection />);

    fireEvent.click(screen.getByRole("button", { name: "background.dropZoneLabel" }));

    expect(await screen.findByRole("img", { name: "background.previewAlt" })).toHaveAttribute(
      "src",
      "/pictures/夜景.png",
    );
    expect(screen.getByLabelText("background.opacity")).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "background.scope.window" }));
    fireEvent.change(screen.getByLabelText("background.opacity"), {
      target: { value: "61" },
    });
    fireEvent.change(screen.getByLabelText("background.terminalOpacity"), {
      target: { value: "48" },
    });
    expect(useSettingsStore.getState()).toMatchObject({
      backgroundImagePath: null,
      backgroundImageOpacity: 20,
      terminalBackgroundImageOpacity: 35,
      backgroundImageScope: "workspace",
    });
    expect(invokeMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "background.applyChanges" }));

    await waitFor(() =>
      expect(useSettingsStore.getState()).toMatchObject({
        backgroundImagePath: "/app-data/appearance/background-1.png",
        backgroundImageOpacity: 61,
        terminalBackgroundImageOpacity: 48,
        backgroundImageScope: "window",
      }),
    );
    expect(invokeMock).toHaveBeenCalledWith("appearance_save_background_image", {
      sourcePath: "/pictures/夜景.png",
    });
  });

  it("enters live preview without changing persisted settings", async () => {
    openMock.mockResolvedValue("/pictures/preview.webp");
    render(<BackgroundImageSettingsSection />);

    fireEvent.click(screen.getByRole("button", { name: "background.dropZoneLabel" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "background.previewActual" }),
    );

    expect(useBackgroundImageDraftStore.getState().previewActive).toBe(true);
    expect(useSettingsStore.getState().backgroundImagePath).toBeNull();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("prioritises one native image drop over the terminal handler", async () => {
    const terminalDropHandler = vi.fn(() => true);
    const stopTerminalListener = listenToNativeDragDrop(terminalDropHandler);
    useSettingsStore.setState({
      backgroundImagePath: "/app-data/appearance/current.png",
    });
    render(<BackgroundImageSettingsSection />);

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
          type: "drop",
          paths: ["/pictures/replacement.webp"],
          position: { x: 100, y: 100 },
        },
      });
    });

    expect(screen.getByRole("img", { name: "background.previewAlt" })).toHaveAttribute(
      "src",
      "/pictures/replacement.webp",
    );
    expect(terminalDropHandler).not.toHaveBeenCalled();
    expect(useSettingsStore.getState().backgroundImagePath).toBe(
      "/app-data/appearance/current.png",
    );
    stopTerminalListener();
  });

  it("rejects a multi-file drop without replacing the draft", async () => {
    useSettingsStore.setState({
      backgroundImagePath: "/app-data/appearance/current.png",
    });
    render(<BackgroundImageSettingsSection />);
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

    expect(screen.getByRole("alert")).toHaveTextContent("background.dropSingleError");
    expect(useBackgroundImageDraftStore.getState().draft?.path).toBe(
      "/app-data/appearance/current.png",
    );
  });

  it("stages removal and calls the backend only after apply", async () => {
    useSettingsStore.setState({
      backgroundImagePath: "/app-data/appearance/background.png",
    });
    invokeMock.mockResolvedValue(undefined);
    render(<BackgroundImageSettingsSection />);

    fireEvent.click(screen.getByRole("button", { name: "background.remove" }));
    expect(screen.getByText("background.removalPreview")).toBeInTheDocument();
    expect(useSettingsStore.getState().backgroundImagePath).toBe(
      "/app-data/appearance/background.png",
    );
    expect(invokeMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "background.applyChanges" }));
    await waitFor(() => expect(useSettingsStore.getState().backgroundImagePath).toBeNull());
    expect(invokeMock).toHaveBeenCalledWith("appearance_remove_background_image");
  });

  it("discards every draft control change together", () => {
    useSettingsStore.setState({
      backgroundImagePath: "/app-data/appearance/current.png",
      backgroundImageOpacity: 20,
      backgroundImageScope: "workspace",
    });
    render(<BackgroundImageSettingsSection />);

    fireEvent.click(screen.getByRole("button", { name: "background.scope.window" }));
    fireEvent.change(screen.getByLabelText("background.opacity"), {
      target: { value: "72" },
    });
    fireEvent.click(screen.getByRole("button", { name: "background.cancelChanges" }));

    expect(useBackgroundImageDraftStore.getState().draft).toMatchObject({
      path: "/app-data/appearance/current.png",
      opacity: 20,
      scope: "workspace",
    });
    expect(useSettingsStore.getState()).toMatchObject({
      backgroundImagePath: "/app-data/appearance/current.png",
      backgroundImageOpacity: 20,
      backgroundImageScope: "workspace",
    });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("keeps formal settings intact when image import fails", async () => {
    useSettingsStore.setState({
      backgroundImagePath: "/app-data/appearance/current.png",
    });
    openMock.mockResolvedValue("/pictures/too-large.png");
    invokeMock.mockRejectedValue("fileTooLarge");
    render(<BackgroundImageSettingsSection />);

    fireEvent.click(screen.getByRole("button", { name: "background.replace" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "background.applyChanges" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "background.fileTooLargeError",
    );
    expect(useSettingsStore.getState().backgroundImagePath).toBe(
      "/app-data/appearance/current.png",
    );
  });

  it("reports a source load error without clearing formal settings", () => {
    useSettingsStore.setState({
      backgroundImagePath: "/app-data/appearance/current.png",
    });
    render(<BackgroundImageSettingsSection />);

    fireEvent.error(screen.getByRole("img", { name: "background.previewAlt" }));

    expect(screen.getByRole("alert")).toHaveTextContent("background.loadError");
    expect(screen.getByText("background.previewUnavailable")).toBeInTheDocument();
    expect(useSettingsStore.getState().backgroundImagePath).toBe(
      "/app-data/appearance/current.png",
    );
  });
});
