import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useSettingsStore } from "@/stores/settingsStore";
import { BackgroundImageLayer } from "./BackgroundImageLayer";

describe("BackgroundImageLayer", () => {
  beforeEach(() => {
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
});
