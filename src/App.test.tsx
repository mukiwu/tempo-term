import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import App from "./App";
import "./i18n";
import { useSettingsStore } from "@/stores/settingsStore";
import { useUiStore } from "@/stores/uiStore";

describe("App shell", () => {
  beforeEach(() => {
    useSettingsStore.setState({ language: "en", theme: "dark" });
    useUiStore.setState({ activeView: "settings" });
  });

  it("renders navigation labels in English by default", () => {
    render(<App />);
    expect(screen.getByLabelText("Terminal")).toBeInTheDocument();
    expect(screen.getByText("Display language")).toBeInTheDocument();
  });

  it("switches the whole UI to Traditional Chinese when the language changes", async () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "正體中文" }));

    // Activity bar (common namespace) and settings panel (settings namespace)
    // both follow the new language.
    expect(await screen.findByLabelText("終端機")).toBeInTheDocument();
    expect(screen.getByText("顯示語言")).toBeInTheDocument();
  });
});
