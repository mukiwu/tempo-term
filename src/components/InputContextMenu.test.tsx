import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, fireEvent, waitFor } from "@testing-library/react";
// Menu labels come from i18next; the side-effect import boots the real
// translations (same convention as SettingsView.test.tsx). jsdom reports
// navigator.language as en-US, so labels resolve to English.
import "@/i18n";
import { InputContextMenu } from "@/components/InputContextMenu";

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

// The component is platform-independent by design (no platform checks), so a
// single suite covers every OS.
describe("InputContextMenu", () => {
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

  it("keeps the native menu inside a read-only CodeMirror editor", () => {
    render(<InputContextMenu />);
    // The diff view (EditorView.editable.of(false)) renders cm-content with
    // contenteditable="false", so isRichEditable alone would not catch it and
    // the blanket prod suppression would leave the diff view without any menu.
    const editor = document.createElement("div");
    editor.className = "cm-editor";
    const content = document.createElement("div");
    content.setAttribute("contenteditable", "false");
    editor.appendChild(content);
    document.body.appendChild(editor);

    expect(rightClick(content)).toBe(true);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("keeps the native menu on a field during IME composition, custom again after", () => {
    render(<InputContextMenu />);
    const input = document.createElement("input");
    input.type = "text";
    input.value = "こんにちは";
    document.body.appendChild(input);

    // Mid-composition the native menu must appear: it commits the composition
    // correctly, while our replaceRange actions would corrupt the composed text.
    act(() => {
      input.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    });
    expect(rightClick(input)).toBe(true);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    act(() => {
      input.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    });
    expect(rightClick(input)).toBe(false);
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  it("pastes from the web clipboard when the fast path resolves empty (Linux stub)", async () => {
    // On Linux the Rust clipboard command is a stub that RESOLVES with ""
    // instead of rejecting, so paste must still fall through to the web
    // clipboard rather than silently doing nothing.
    const readText = vi.fn().mockResolvedValue("from web clipboard");
    Object.defineProperty(navigator, "clipboard", {
      value: { readText },
      configurable: true,
    });
    render(<InputContextMenu />);
    const input = document.createElement("input");
    input.type = "text";
    document.body.appendChild(input);

    rightClick(input);
    fireEvent.click(screen.getByRole("menuitem", { name: "Paste" }));

    await waitFor(() => expect(input.value).toBe("from web clipboard"));
    expect(readText).toHaveBeenCalledTimes(1);
  });
});
