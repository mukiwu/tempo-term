/**
 * Pure helpers for the custom cut/copy/paste menu shown on plain text fields.
 *
 * On Windows the WebView2 native context menu is both visually out of place and
 * slow to paste (~5s — the same reason TerminalView replaces it). We swap it for
 * an app-styled menu backed by the fast Tauri clipboard path. Rich editors
 * (Monaco, Tiptap/ProseMirror) manage their own selection and menu, so they are
 * deliberately excluded and keep their native/own behaviour.
 */

export type EditableField = HTMLInputElement | HTMLTextAreaElement;

/**
 * `<input>` types that support the text-selection APIs (`selectionStart`,
 * `setSelectionRange`, …). Deliberately excludes `email` and `number`: those
 * throw `InvalidStateError` on any selection access in Chromium/WebView2, and
 * without a caret we can't paste at the right spot — so they fall through to
 * plain browser-menu suppression and rely on native Ctrl+V.
 */
const TEXT_INPUT_TYPES = new Set(["", "text", "search", "url", "tel", "password"]);

/**
 * True when the target is a plain text field we own — a text-like `<input>` or a
 * `<textarea>` that is NOT inside a rich editor (Monaco, Tiptap) or the terminal,
 * each of which handles its own context menu.
 */
export function isPlainTextField(target: EventTarget | null): target is EditableField {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.closest(".monaco-editor, .ProseMirror, .xterm")) {
    return false;
  }
  if (target instanceof HTMLTextAreaElement) {
    return true;
  }
  if (target instanceof HTMLInputElement) {
    return TEXT_INPUT_TYPES.has(target.type);
  }
  return false;
}

/**
 * True when the target is editable but NOT a plain text field — a
 * contentEditable region (e.g. the Tiptap notes editor). These keep the native
 * menu, whose spellcheck/copy/paste is worth more than a custom one and which we
 * can't safely drive without fighting the editor's own selection model.
 */
export function isRichEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  // Coerce: the DOM property is always boolean in a browser, but jsdom leaves it
  // undefined on elements that can't be content-editable.
  return target.isContentEditable === true;
}

/**
 * True when the target sits inside a code/rich editor surface (CodeMirror,
 * Monaco, ProseMirror), which must keep its native context menu. Needed on top
 * of `isRichEditable` because a read-only CodeMirror — the diff view uses
 * `EditorView.editable.of(false)` — renders its content with
 * `contenteditable="false"`, so `isContentEditable` is false there even though
 * the element is still an editor surface, and the blanket suppression would
 * otherwise leave it with no menu at all.
 */
export function isEditorSurface(target: EventTarget | null): boolean {
  // Element, not HTMLElement: editors decorate with SVG (fold arrows, lint
  // markers), and those must keep the editor's native menu too.
  if (!(target instanceof Element)) {
    return false;
  }
  return target.closest(".cm-editor, .monaco-editor, .ProseMirror") !== null;
}

export interface FieldContext {
  /** A non-empty selection exists, so Cut/Copy have something to act on. */
  hasSelection: boolean;
  /** The field holds any text, so Select All has something to select. */
  hasValue: boolean;
  /** readOnly or disabled — Cut/Paste (which mutate) must be inert. */
  readOnly: boolean;
  /** A password field — omit Cut/Copy so the secret can't be lifted out. */
  sensitive: boolean;
}

/**
 * Read a field's selection without throwing. Selection access throws
 * `InvalidStateError` on input types that don't support it (number, email) in
 * Chromium/WebView2, so this stays defensive even though `isPlainTextField`
 * already screens those out.
 */
export function getSelectionRange(field: EditableField): { start: number; end: number } {
  try {
    return { start: field.selectionStart ?? 0, end: field.selectionEnd ?? 0 };
  } catch {
    return { start: 0, end: 0 };
  }
}

export function readFieldContext(field: EditableField): FieldContext {
  const { start, end } = getSelectionRange(field);
  const sensitive = field instanceof HTMLInputElement && field.type === "password";
  return {
    hasSelection: end > start,
    hasValue: field.value.length > 0,
    readOnly: field.readOnly || field.disabled,
    sensitive,
  };
}

/**
 * Replace `[start, end)` of a field's value with `text` and place the caret
 * after it, notifying React.
 *
 * We go through the prototype's native `value` setter (not `field.value = …`)
 * so React's internal value tracker sees the change, then dispatch a bubbling
 * `input` event so a controlled component's `onChange` fires. This is the
 * non-deprecated replacement for `document.execCommand("insertText"/"delete")`;
 * the trade-off is that it doesn't feed the browser's native undo stack.
 */
export function replaceRange(
  field: EditableField,
  start: number,
  end: number,
  text: string,
): void {
  const next = field.value.slice(0, start) + text + field.value.slice(end);
  const proto =
    field instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) {
    setter.call(field, next);
  } else {
    field.value = next;
  }
  const caret = start + text.length;
  try {
    field.setSelectionRange(caret, caret);
  } catch {
    // Input types without selection support (number, email) throw here; the
    // value change and the input event below are what matter.
  }
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

export type InputMenuAction = "cut" | "copy" | "paste" | "selectAll";

export interface InputMenuItemSpec {
  action: InputMenuAction;
  enabled: boolean;
}

/**
 * Which menu entries to show for a field and whether each is enabled. Password
 * fields drop Cut/Copy entirely; the rest are greyed (not hidden) so the menu
 * keeps a stable shape the way native menus do.
 */
export function inputMenuSpecs(ctx: FieldContext): InputMenuItemSpec[] {
  const specs: InputMenuItemSpec[] = [];
  if (!ctx.sensitive) {
    specs.push({ action: "cut", enabled: ctx.hasSelection && !ctx.readOnly });
    specs.push({ action: "copy", enabled: ctx.hasSelection });
  }
  specs.push({ action: "paste", enabled: !ctx.readOnly });
  specs.push({ action: "selectAll", enabled: ctx.hasValue });
  return specs;
}

/**
 * Whether this is a dev build. Blank-area context-menu suppression is skipped
 * in dev so right-click → Inspect Element stays reachable while debugging;
 * text-field and terminal custom menus still apply so the feature itself is
 * testable in dev. A function (not a constant) so tests can stub it.
 */
export function isDevBuild(): boolean {
  return import.meta.env.DEV;
}
