import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Editor } from "@tiptap/react";
import { describe, expect, it, vi } from "vitest";
import { NoteEditor } from "./NoteEditor";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

async function renderEditorAtEnd(content: string): Promise<Editor> {
  let editor: Editor | null = null;
  render(
    <NoteEditor
      content={content}
      onChange={() => {}}
      onEditorReady={(nextEditor) => {
        editor = nextEditor;
      }}
    />,
  );
  await waitFor(() => expect(editor).not.toBeNull());
  await act(async () => {
    editor!.commands.setTextSelection(content.length + 1);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return editor!;
}

describe("note slash command", () => {
  it("does not show an empty popup when the cursor enters an existing slash word", async () => {
    await renderEditorAtEnd("/stickers");

    // Suggestion resolves its filtered items asynchronously before rendering.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(screen.queryByText("slash.empty")).not.toBeInTheDocument();
  });

  it("still shows block choices for a bare slash", async () => {
    await renderEditorAtEnd("/");

    expect(await screen.findByText("slash.text")).toBeInTheDocument();
    expect(screen.getByText("slash.code")).toBeInTheDocument();
  });

  it("shows the existing block command menu when note text is selected", async () => {
    const editor = await renderEditorAtEnd("plain text");

    act(() => {
      editor.commands.setTextSelection({ from: 1, to: 6 });
    });

    expect(await screen.findByText("slash.text")).toBeInTheDocument();
    expect(screen.getByText("slash.quote")).toBeInTheDocument();
  });

  it("formats selected text as bold from the same command panel", async () => {
    const editor = await renderEditorAtEnd("plain text");
    act(() => {
      editor.commands.setTextSelection({ from: 1, to: 6 });
    });

    fireEvent.click(await screen.findByRole("button", { name: "format.bold" }));

    expect(editor.getHTML()).toBe("<p><strong>plain</strong> text</p>");
    expect(screen.getByRole("button", { name: "slash.text" })).toBeInTheDocument();
  });

  it("formats selected text as italic from the same command panel", async () => {
    const editor = await renderEditorAtEnd("plain text");
    act(() => {
      editor.commands.setTextSelection({ from: 1, to: 6 });
    });

    fireEvent.click(await screen.findByRole("button", { name: "format.italic" }));

    expect(editor.getHTML()).toBe("<p><em>plain</em> text</p>");
  });

  it("formats selected text with strikethrough from the same command panel", async () => {
    const editor = await renderEditorAtEnd("plain text");
    act(() => {
      editor.commands.setTextSelection({ from: 1, to: 6 });
    });

    fireEvent.click(await screen.findByRole("button", { name: "format.strike" }));

    expect(editor.getHTML()).toBe("<p><s>plain</s> text</p>");
  });

  it("formats selected text as inline code from the same command panel", async () => {
    const editor = await renderEditorAtEnd("plain text");
    act(() => {
      editor.commands.setTextSelection({ from: 1, to: 6 });
    });

    fireEvent.click(await screen.findByRole("button", { name: "format.code" }));

    expect(editor.getHTML()).toBe("<p><code>plain</code> text</p>");
  });

  it("adds a link to selected text from the same command panel", async () => {
    const editor = await renderEditorAtEnd("plain text");
    act(() => {
      editor.commands.setTextSelection({ from: 1, to: 6 });
    });

    fireEvent.click(await screen.findByRole("button", { name: "format.link" }));
    const input = await screen.findByRole("textbox", { name: "format.linkUrl" });
    fireEvent.change(input, { target: { value: "https://example.com" } });
    fireEvent.keyDown(input, { key: "Enter" });

    const link = editor.view.dom.querySelector("a");
    expect(link).toHaveAttribute("href", "https://example.com");
    expect(link).toHaveTextContent("plain");
    expect(editor.getText()).toBe("plain text");
  });

  it("cancels link editing with Escape without closing the command panel", async () => {
    const editor = await renderEditorAtEnd("plain text");
    act(() => {
      editor.commands.setTextSelection({ from: 1, to: 6 });
    });

    fireEvent.click(await screen.findByRole("button", { name: "format.link" }));
    const input = await screen.findByRole("textbox", { name: "format.linkUrl" });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(screen.queryByRole("textbox", { name: "format.linkUrl" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "slash.text" })).toBeInTheDocument();
    expect(editor.state.selection.empty).toBe(false);
  });

  it("removes a link from selected text without deleting the text", async () => {
    const editor = await renderEditorAtEnd("plain text");
    act(() => {
      editor.commands.setTextSelection({ from: 1, to: 6 });
      editor.commands.setLink({ href: "https://example.com" });
    });

    fireEvent.click(await screen.findByRole("button", { name: "format.link" }));
    fireEvent.click(await screen.findByRole("button", { name: "format.removeLink" }));

    expect(editor.view.dom.querySelector("a")).toBeNull();
    expect(editor.getText()).toBe("plain text");
  });

  it("changes the selected block style without deleting its text", async () => {
    const editor = await renderEditorAtEnd("plain text");
    act(() => {
      editor.commands.setTextSelection({ from: 1, to: 6 });
    });

    fireEvent.click(await screen.findByRole("button", { name: "slash.h1" }));

    expect(editor.getText()).toBe("plain text");
    expect(editor.getHTML()).toBe("<h1>plain text</h1>");
    expect(screen.queryByRole("button", { name: "slash.h1" })).not.toBeInTheDocument();
  });

  it("closes the selection command menu with Escape", async () => {
    const editor = await renderEditorAtEnd("plain text");
    act(() => {
      editor.commands.setTextSelection({ from: 1, to: 6 });
    });
    await screen.findByRole("button", { name: "slash.text" });

    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.queryByRole("button", { name: "slash.text" })).not.toBeInTheDocument();
    expect(editor.state.selection.empty).toBe(true);
  });

  it("keeps deleting the slash trigger when a typed slash command runs", async () => {
    const editor = await renderEditorAtEnd("/");

    fireEvent.click(await screen.findByRole("button", { name: "slash.h2" }));

    expect(editor.getText()).toBe("");
    expect(editor.getHTML()).toBe("<h2></h2>");
  });

  it("preserves selected text when inserting a divider from the selection menu", async () => {
    const editor = await renderEditorAtEnd("plain text");
    act(() => {
      editor.commands.setTextSelection({ from: 1, to: 6 });
    });

    fireEvent.click(await screen.findByRole("button", { name: "slash.divider" }));

    expect(editor.getText()).toContain("plain text");
    expect(editor.getHTML()).toContain("<hr>");
  });
});
