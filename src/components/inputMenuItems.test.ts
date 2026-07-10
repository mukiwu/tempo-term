import { describe, it, expect } from "vitest";
import {
  isPlainTextField,
  isRichEditable,
  isEditorSurface,
  readFieldContext,
  inputMenuSpecs,
  replaceRange,
  getSelectionRange,
  type FieldContext,
} from "@/components/inputMenuItems";

function ctx(overrides: Partial<FieldContext> = {}): FieldContext {
  return { hasSelection: false, hasValue: false, readOnly: false, sensitive: false, ...overrides };
}

describe("isPlainTextField", () => {
  it("accepts a text input and a textarea", () => {
    const input = document.createElement("input");
    input.type = "text";
    expect(isPlainTextField(input)).toBe(true);
    expect(isPlainTextField(document.createElement("textarea"))).toBe(true);
  });

  it("accepts selection-capable text inputs but not checkbox/range", () => {
    for (const type of ["search", "url", "tel", "password"]) {
      const el = document.createElement("input");
      el.type = type;
      expect(isPlainTextField(el)).toBe(true);
    }
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    expect(isPlainTextField(checkbox)).toBe(false);
  });

  it("rejects number/email inputs (they don't support the selection APIs)", () => {
    for (const type of ["number", "email"]) {
      const el = document.createElement("input");
      el.type = type;
      expect(isPlainTextField(el)).toBe(false);
    }
  });

  it("rejects fields inside rich editors and the terminal", () => {
    for (const cls of ["monaco-editor", "ProseMirror", "xterm"]) {
      const host = document.createElement("div");
      host.className = cls;
      const input = document.createElement("input");
      input.type = "text";
      host.appendChild(input);
      expect(isPlainTextField(input)).toBe(false);
    }
  });

  it("rejects non-elements and non-fields", () => {
    expect(isPlainTextField(null)).toBe(false);
    expect(isPlainTextField(document.createElement("div"))).toBe(false);
  });
});

describe("isRichEditable", () => {
  it("is true only for contentEditable elements", () => {
    const editable = document.createElement("div");
    editable.contentEditable = "true";
    // jsdom does not compute isContentEditable from the attribute; force it.
    Object.defineProperty(editable, "isContentEditable", { value: true });
    expect(isRichEditable(editable)).toBe(true);
    expect(isRichEditable(document.createElement("input"))).toBe(false);
    expect(isRichEditable(null)).toBe(false);
  });
});

describe("isEditorSurface", () => {
  it("is true inside a read-only CodeMirror editor (contenteditable false)", () => {
    // The diff view sets EditorView.editable.of(false), which renders
    // cm-content with contenteditable="false" — isRichEditable misses it.
    const editor = document.createElement("div");
    editor.className = "cm-editor";
    const content = document.createElement("div");
    content.setAttribute("contenteditable", "false");
    editor.appendChild(content);
    expect(isEditorSurface(content)).toBe(true);
  });

  it("is true inside Monaco and ProseMirror surfaces", () => {
    for (const cls of ["monaco-editor", "ProseMirror"]) {
      const host = document.createElement("div");
      host.className = cls;
      const child = document.createElement("span");
      host.appendChild(child);
      expect(isEditorSurface(child)).toBe(true);
    }
  });

  it("is false for plain fields, blank elements, and non-elements", () => {
    const input = document.createElement("input");
    input.type = "text";
    expect(isEditorSurface(input)).toBe(false);
    expect(isEditorSurface(document.createElement("div"))).toBe(false);
    expect(isEditorSurface(null)).toBe(false);
  });

  it("is true for SVG decorations inside an editor (fold arrows, lint markers)", () => {
    // SVG elements are Element but not HTMLElement; the check must not lose
    // them or the editor's native menu dies on icon right-clicks in prod.
    const editor = document.createElement("div");
    editor.className = "cm-editor";
    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    editor.appendChild(icon);
    expect(isEditorSurface(icon)).toBe(true);
  });
});

describe("readFieldContext", () => {
  it("reports selection, value, readOnly and sensitivity", () => {
    const input = document.createElement("input");
    input.type = "text";
    input.value = "hello";
    document.body.appendChild(input);
    input.setSelectionRange(1, 4);
    const c = readFieldContext(input);
    expect(c).toEqual({ hasSelection: true, hasValue: true, readOnly: false, sensitive: false });
    input.remove();
  });

  it("treats readOnly and disabled as non-mutable, and flags password as sensitive", () => {
    const ro = document.createElement("textarea");
    ro.readOnly = true;
    expect(readFieldContext(ro).readOnly).toBe(true);

    const disabled = document.createElement("textarea");
    disabled.disabled = true;
    expect(readFieldContext(disabled).readOnly).toBe(true);

    const pw = document.createElement("input");
    pw.type = "password";
    expect(readFieldContext(pw).sensitive).toBe(true);
  });
});

describe("getSelectionRange", () => {
  it("returns the live selection for a text field", () => {
    const input = document.createElement("input");
    input.type = "text";
    input.value = "abcdef";
    document.body.appendChild(input);
    input.setSelectionRange(2, 5);
    expect(getSelectionRange(input)).toEqual({ start: 2, end: 5 });
    input.remove();
  });

  it("does not throw on input types without selection support (number)", () => {
    const input = document.createElement("input");
    input.type = "number";
    input.value = "123";
    document.body.appendChild(input);
    expect(() => getSelectionRange(input)).not.toThrow();
    // readFieldContext builds on it, so it must stay crash-free too.
    expect(() => readFieldContext(input)).not.toThrow();
    expect(readFieldContext(input).hasSelection).toBe(false);
    input.remove();
  });
});

describe("inputMenuSpecs", () => {
  it("enables cut/copy only with a selection, and cut needs a writable field", () => {
    const specs = inputMenuSpecs(ctx({ hasSelection: true }));
    expect(specs.find((s) => s.action === "cut")?.enabled).toBe(true);
    expect(specs.find((s) => s.action === "copy")?.enabled).toBe(true);

    const noSel = inputMenuSpecs(ctx({ hasSelection: false }));
    expect(noSel.find((s) => s.action === "cut")?.enabled).toBe(false);
    expect(noSel.find((s) => s.action === "copy")?.enabled).toBe(false);

    const readOnly = inputMenuSpecs(ctx({ hasSelection: true, readOnly: true }));
    expect(readOnly.find((s) => s.action === "cut")?.enabled).toBe(false);
    // Copy stays available on a read-only field with a selection.
    expect(readOnly.find((s) => s.action === "copy")?.enabled).toBe(true);
  });

  it("disables paste on a read-only field and select-all on an empty one", () => {
    const readOnly = inputMenuSpecs(ctx({ readOnly: true }));
    expect(readOnly.find((s) => s.action === "paste")?.enabled).toBe(false);

    const empty = inputMenuSpecs(ctx({ hasValue: false }));
    expect(empty.find((s) => s.action === "selectAll")?.enabled).toBe(false);
    expect(inputMenuSpecs(ctx({ hasValue: true })).find((s) => s.action === "selectAll")?.enabled).toBe(true);
  });

  it("omits cut and copy for sensitive (password) fields", () => {
    const specs = inputMenuSpecs(ctx({ hasSelection: true, hasValue: true, sensitive: true }));
    expect(specs.map((s) => s.action)).toEqual(["paste", "selectAll"]);
  });
});

describe("replaceRange", () => {
  it("inserts at the caret, moves the caret past it, and fires an input event", () => {
    const input = document.createElement("input");
    input.type = "text";
    input.value = "abcd";
    document.body.appendChild(input);
    let inputEvents = 0;
    input.addEventListener("input", () => inputEvents++);

    // Paste "XY" over the selection [1, 3) → a[XY]d
    replaceRange(input, 1, 3, "XY");
    expect(input.value).toBe("aXYd");
    expect(input.selectionStart).toBe(3);
    expect(input.selectionEnd).toBe(3);
    expect(inputEvents).toBe(1);
    input.remove();
  });

  it("deletes a selection when replacing with the empty string (cut)", () => {
    const area = document.createElement("textarea");
    area.value = "hello world";
    document.body.appendChild(area);
    replaceRange(area, 5, 11, "");
    expect(area.value).toBe("hello");
    expect(area.selectionStart).toBe(5);
    area.remove();
  });
});
