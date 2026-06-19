import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { FileTree } from "./FileTree";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("./lib/fsBridge", () => ({
  fsReadDir: vi.fn(),
  fsCreateDir: vi.fn(),
  fsCreateFile: vi.fn(),
  fsDelete: vi.fn(),
  fsReveal: vi.fn(),
}));

describe("FileTree icons", () => {
  it("renders a catppuccin type icon (not the generic lucide glyph) for a file", () => {
    const entries = [
      { name: "main.ts", path: "/p/main.ts", is_dir: false, size: 0 },
    ];
    const { container } = render(
      <FileTree entries={entries} onReloadRoot={() => {}} />,
    );
    // The vendored TypeScript icon colours its stroke with var(--vscode-ctp-*),
    // which the lucide File glyph never contains.
    expect(container.innerHTML).toContain("vscode-ctp");
  });
});
