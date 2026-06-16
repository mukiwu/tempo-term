import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import App from "./App";
import "./i18n";
import { useSettingsStore } from "@/stores/settingsStore";
import { useUiStore } from "@/stores/uiStore";

describe("App shell", () => {
  beforeEach(() => {
    useSettingsStore.setState({ language: "en", themeId: "vitesse-dark" });
    // Show the sidebar (with its Explorer/Git/Notes tabs) and the settings
    // modal (with the language picker); keep it light for jsdom.
    useUiStore.setState({
      sidebarVisible: true,
      settingsOpen: true,
      sidebarView: "explorer",
      fileFinderOpen: false,
    });
  });

  it("renders the sidebar tabs and settings labels in English by default", () => {
    render(<App />);
    expect(screen.getByRole("button", { name: "Explorer" })).toBeInTheDocument();
    expect(screen.getByText("Display language")).toBeInTheDocument();
  });

  it("switches the whole UI to Traditional Chinese when the language changes", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "正體中文" }));
    expect(await screen.findByRole("button", { name: "檔案總管" })).toBeInTheDocument();
    expect(screen.getByText("顯示語言")).toBeInTheDocument();
  });
});
