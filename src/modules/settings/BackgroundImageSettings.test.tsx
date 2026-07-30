import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSettingsStore } from "@/stores/settingsStore";
import { BackgroundImageSettings } from "./BackgroundImageSettings";

const { invokeMock, openMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  openMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => path,
  invoke: invokeMock,
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: openMock,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe("BackgroundImageSettings", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    openMock.mockReset();
    useSettingsStore.setState({
      backgroundImagePath: null,
      backgroundImageOpacity: 20,
      backgroundImageScope: "workspace",
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

  it("updates scope and opacity through accessible controls", () => {
    useSettingsStore.setState({
      backgroundImagePath: "/app-data/appearance/background.png",
    });
    render(<BackgroundImageSettings />);

    fireEvent.click(screen.getByRole("button", { name: "background.scope.window" }));
    fireEvent.change(screen.getByLabelText("background.opacity"), {
      target: { value: "61" },
    });

    expect(useSettingsStore.getState().backgroundImageScope).toBe("window");
    expect(useSettingsStore.getState().backgroundImageOpacity).toBe(61);
    expect(screen.getByText("61%")).toBeInTheDocument();
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
