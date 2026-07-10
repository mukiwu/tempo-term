import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
// Menu labels come from i18next; the side-effect import boots the real
// translations (same convention as SettingsView.test.tsx). jsdom reports
// navigator.language as en-US, so labels resolve to English.
import "@/i18n";
import { InputContextMenu } from "@/components/InputContextMenu";

// Non-Windows platform: the menu must now work here too (the whole point of
// the unification), so pin IS_WINDOWS to false.
vi.mock("@/lib/platform", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/platform")>();
  return { ...actual, IS_WINDOWS: false };
});

// The fast Tauri clipboard path is not available in jsdom.
vi.mock("@/modules/terminal/lib/terminalClipboard", () => ({
  terminalClipboardText: () => Promise.resolve(""),
}));

// isDevBuild is flipped per test; the real impl reads import.meta.env.DEV
// which is always true under Vitest and would mask the prod branch.
const devMock = vi.hoisted(() => ({ dev: false }));
vi.mock("@/components/inputMenuItems", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/inputMenuItems")>();
  return { ...actual, isDevBuild: () => devMock.dev };
});

function rightClick(target: Element): boolean {
  let notPrevented = true;
  act(() => {
    notPrevented = target.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 40, clientY: 40 }),
    );
  });
  return notPrevented;
}

describe("InputContextMenu on non-Windows platforms", () => {
  beforeEach(() => {
    devMock.dev = false;
    document.body.innerHTML = "";
  });

  it("opens the custom menu on a plain text input", () => {
    render(<InputContextMenu />);
    const input = document.createElement("input");
    input.type = "text";
    input.value = "hello";
    document.body.appendChild(input);

    const notPrevented = rightClick(input);

    expect(notPrevented).toBe(false);
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Paste" })).toBeInTheDocument();
  });

  it("keeps the native menu on contentEditable (Tiptap/CodeMirror)", () => {
    render(<InputContextMenu />);
    const editor = document.createElement("div");
    Object.defineProperty(editor, "isContentEditable", { value: true });
    document.body.appendChild(editor);

    expect(rightClick(editor)).toBe(true);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("suppresses the browser menu on blank areas in prod builds", () => {
    render(<InputContextMenu />);
    const blank = document.createElement("div");
    document.body.appendChild(blank);

    expect(rightClick(blank)).toBe(false);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("keeps the native menu on blank areas in dev builds (Inspect stays reachable)", () => {
    devMock.dev = true;
    render(<InputContextMenu />);
    const blank = document.createElement("div");
    document.body.appendChild(blank);

    expect(rightClick(blank)).toBe(true);
  });

  it("defers to a menu another component already showed", () => {
    render(<InputContextMenu />);
    const host = document.createElement("div");
    host.addEventListener("contextmenu", (e) => e.preventDefault());
    document.body.appendChild(host);

    rightClick(host);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});
