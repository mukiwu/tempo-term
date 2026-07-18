import { act, render, screen, waitFor } from "@testing-library/react";
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
});
