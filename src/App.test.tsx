import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import App from "./App";
import "./i18n";
import { useSettingsStore } from "@/stores/settingsStore";
import { useUiStore } from "@/stores/uiStore";

describe("App shell", () => {
  beforeEach(() => {
    useSettingsStore.setState({ language: "en", themeId: "vitesse-dark" });
    // Open the settings modal so the language picker is on screen; keep the
    // sidebar and terminal closed to keep this render light in jsdom.
    useUiStore.setState({
      sidebarVisible: false,
      terminalOpen: false,
      settingsOpen: true,
      sidebarView: "explorer",
      fileFinderOpen: false,
    });
  });

  it("renders activity rail and settings labels in English by default", () => {
    render(<App />);
    expect(screen.getByLabelText("Explorer")).toBeInTheDocument();
    expect(screen.getByText("Display language")).toBeInTheDocument();
  });

  it("switches the whole UI to Traditional Chinese when the language changes", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "正體中文" }));
    expect(await screen.findByLabelText("檔案總管")).toBeInTheDocument();
    expect(screen.getByText("顯示語言")).toBeInTheDocument();
  });
});
