import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useSettingsStore } from "@/stores/settingsStore";
import { BackgroundImageLayer } from "./BackgroundImageLayer";
import { useBackgroundImageDraftStore } from "@/stores/backgroundImageDraftStore";

describe("BackgroundImageLayer", () => {
  beforeEach(() => {
    useBackgroundImageDraftStore.getState().cancel();
    useSettingsStore.setState({
      backgroundImagePath: null,
      backgroundImageOpacity: 20,
      backgroundImageScope: "workspace",
    });
  });

  it("renders an opaque source only in the configured scope", () => {
    useSettingsStore.setState({
      backgroundImagePath: "/app-data/appearance/background.png",
      backgroundImageOpacity: 37,
      backgroundImageScope: "workspace",
    });

    render(
      <>
        <BackgroundImageLayer scope="workspace" />
        <BackgroundImageLayer scope="window" />
      </>,
    );

    const image = screen.getByTestId("background-image-workspace");
    expect(image).toHaveAttribute("src", "/app-data/appearance/background.png");
    expect(image).not.toHaveAttribute("style");
    expect(screen.queryByTestId("background-image-window")).toBeNull();
  });

  it("publishes where the image landed so the gutter can pin the same copy", () => {
    useSettingsStore.setState({
      backgroundImagePath: "/app-data/appearance/background.png",
      backgroundImageOpacity: 20,
      backgroundImageScope: "workspace",
    });
    const { unmount } = render(<BackgroundImageLayer scope="workspace" />);
    const image = screen.getByTestId("background-image-workspace");
    Object.defineProperty(image, "naturalWidth", { value: 200, configurable: true });
    Object.defineProperty(image, "naturalHeight", { value: 100, configurable: true });
    image.getBoundingClientRect = () =>
      ({ left: 40, top: 20, width: 400, height: 400 }) as DOMRect;

    act(() => {
      image.dispatchEvent(new Event("load"));
    });

    // cover on a 400x400 box scales the 200x100 source by 4, so it overflows
    // 200px to each side of a box that itself starts 40px into the viewport.
    const root = document.documentElement.style;
    expect(root.getPropertyValue("--wallpaper-fixed-size")).toBe("800px 400px");
    expect(root.getPropertyValue("--wallpaper-fixed-pos")).toBe("-160px 20px");
    expect(root.getPropertyValue("--wallpaper-image")).toBe(
      'url("/app-data/appearance/background.png")',
    );

    unmount();
    expect(root.getPropertyValue("--wallpaper-image")).toBe("");
    expect(root.getPropertyValue("--wallpaper-fixed-size")).toBe("");
    expect(root.getPropertyValue("--wallpaper-fixed-pos")).toBe("");
  });

  it("does not mount an invisible or unconfigured image", () => {
    const { rerender } = render(<BackgroundImageLayer scope="workspace" />);
    expect(screen.queryByRole("img", { hidden: true })).toBeNull();

    act(() => {
      useSettingsStore.setState({
        backgroundImagePath: "/app-data/appearance/background.png",
        backgroundImageOpacity: 0,
      });
    });
    rerender(<BackgroundImageLayer scope="workspace" />);
    expect(screen.queryByTestId("background-image-workspace")).toBeNull();
  });

  it("clears a persisted path when the managed image cannot load", () => {
    useSettingsStore.setState({
      backgroundImagePath: "/app-data/appearance/missing.png",
      backgroundImageOpacity: 20,
      backgroundImageScope: "workspace",
    });
    render(<BackgroundImageLayer scope="workspace" />);

    act(() => {
      screen.getByTestId("background-image-workspace").dispatchEvent(new Event("error"));
    });

    expect(useSettingsStore.getState().backgroundImagePath).toBeNull();
  });

  it("renders the draft only during live preview without mutating formal settings", () => {
    useSettingsStore.setState({
      backgroundImagePath: "/app-data/appearance/current.png",
      backgroundImageScope: "workspace",
    });
    useBackgroundImageDraftStore.getState().begin({
      path: "/app-data/appearance/current.png",
      opacity: 20,
      terminalOpacity: 35,
      scope: "workspace",
      textColor: null,
    });
    useBackgroundImageDraftStore.getState().stageImage("/pictures/draft.png");
    useBackgroundImageDraftStore.getState().update({ scope: "window" });
    useBackgroundImageDraftStore.getState().enterPreview();

    render(
      <>
        <BackgroundImageLayer scope="workspace" />
        <BackgroundImageLayer scope="window" />
      </>,
    );

    expect(screen.queryByTestId("background-image-workspace")).toBeNull();
    expect(screen.getByTestId("background-image-window")).toHaveAttribute(
      "src",
      "/pictures/draft.png",
    );
    expect(useSettingsStore.getState().backgroundImagePath).toBe(
      "/app-data/appearance/current.png",
    );
  });

  it("marks a broken draft without clearing the formal image", () => {
    useSettingsStore.setState({
      backgroundImagePath: "/app-data/appearance/current.png",
      backgroundImageScope: "workspace",
    });
    useBackgroundImageDraftStore.getState().begin({
      path: "/app-data/appearance/current.png",
      opacity: 20,
      terminalOpacity: 35,
      scope: "workspace",
      textColor: null,
    });
    useBackgroundImageDraftStore.getState().stageImage("/pictures/broken.png");
    useBackgroundImageDraftStore.getState().enterPreview();
    render(<BackgroundImageLayer scope="workspace" />);

    act(() => {
      screen.getByTestId("background-image-workspace").dispatchEvent(new Event("error"));
    });

    expect(useBackgroundImageDraftStore.getState().draft?.imageFailed).toBe(true);
    expect(useSettingsStore.getState().backgroundImagePath).toBe(
      "/app-data/appearance/current.png",
    );
  });
});
