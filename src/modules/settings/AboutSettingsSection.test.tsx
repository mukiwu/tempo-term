import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import "@/i18n";
import { AboutSettingsSection } from "./AboutSettingsSection";

// The version is read from the Tauri runtime; stub it so the section can mount
// outside a real app window.
vi.mock("@tauri-apps/api/app", () => ({
  getVersion: vi.fn().mockResolvedValue("0.0.1"),
}));

describe("AboutSettingsSection", () => {
  it("shows the app version reported by the Tauri runtime", async () => {
    render(<AboutSettingsSection />);
    expect(await screen.findByText(/v0\.0\.1/)).toBeInTheDocument();
  });
});
