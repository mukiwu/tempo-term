import { Prec, StateEffect, StateField, type Extension } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
  keymap,
} from "@codemirror/view";

/** Ask the backend for a completion given the text around the cursor. Returns
 * the raw text to insert (already cleaned), or an empty string for "nothing". */
export type CompletionRequest = (prefix: string, suffix: string) => Promise<string>;

interface Suggestion {
  text: string;
  pos: number;
}

/** Set or clear the current ghost suggestion. Exported so tests can arrange a
 * suggestion directly without driving the debounced request pipeline. */
export const setSuggestion = StateEffect.define<Suggestion | null>();

/** Holds the ghost suggestion and renders it as a dim widget after the cursor.
 * Any edit or cursor move (that isn't the one setting the suggestion) clears it
 * so a stale ghost never lingers. */
const suggestionField = StateField.define<Suggestion | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setSuggestion)) {
        return effect.value;
      }
    }
    if (tr.docChanged || tr.selection) {
      return null;
    }
    return value;
  },
  provide: (field) =>
    EditorView.decorations.from(field, (value): DecorationSet => {
      if (!value || value.text.length === 0) {
        return Decoration.none;
      }
      const widget = Decoration.widget({
        widget: new GhostWidget(value.text),
        side: 1,
      });
      return Decoration.set([widget.range(value.pos)]);
    }),
});

class GhostWidget extends WidgetType {
  constructor(readonly text: string) {
    super();
  }

  eq(other: GhostWidget): boolean {
    return other.text === this.text;
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-ghost-text";
    span.style.opacity = "0.4";
    span.style.whiteSpace = "pre-wrap";
    // Let clicks fall through to the editor so tapping the ghost text never
    // parks the cursor inside a suggestion that isn't real document content.
    span.style.pointerEvents = "none";
    span.textContent = this.text;
    return span;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

/** Insert the current ghost suggestion at its position and clear it. */
function acceptSuggestion(view: EditorView): boolean {
  const suggestion = view.state.field(suggestionField, false);
  if (!suggestion || suggestion.text.length === 0) {
    return false;
  }
  view.dispatch({
    changes: { from: suggestion.pos, insert: suggestion.text },
    selection: { anchor: suggestion.pos + suggestion.text.length },
    effects: setSuggestion.of(null),
  });
  return true;
}

function dismissSuggestion(view: EditorView): boolean {
  if (!view.state.field(suggestionField, false)) {
    return false;
  }
  view.dispatch({ effects: setSuggestion.of(null) });
  return true;
}

const DEBOUNCE_MS = 400;

/**
 * CodeMirror extension that requests an AI completion shortly after the user
 * stops typing and shows it as ghost text. Tab accepts, Escape dismisses. The
 * request is debounced and stale results (cursor moved meanwhile) are dropped.
 */
export function inlineCompletion(request: CompletionRequest): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      timer: ReturnType<typeof setTimeout> | null = null;

      constructor(readonly view: EditorView) {}

      update(update: ViewUpdate): void {
        if (update.docChanged) {
          this.schedule();
        }
      }

      schedule(): void {
        if (this.timer) {
          clearTimeout(this.timer);
        }
        this.timer = setTimeout(() => void this.fire(), DEBOUNCE_MS);
      }

      async fire(): Promise<void> {
        const state = this.view.state;
        const selection = state.selection.main;
        if (!selection.empty) {
          return;
        }
        const pos = selection.head;
        const prefix = state.sliceDoc(0, pos);
        if (prefix.trim().length === 0) {
          return;
        }
        const suffix = state.sliceDoc(pos);
        let text: string;
        try {
          text = await request(prefix, suffix);
        } catch {
          return;
        }
        // Drop the result if the user moved on or typed while we waited.
        if (text.length === 0 || this.view.state.selection.main.head !== pos) {
          return;
        }
        this.view.dispatch({ effects: setSuggestion.of({ text, pos }) });
      }

      destroy(): void {
        if (this.timer) {
          clearTimeout(this.timer);
        }
      }
    },
  );

  return [
    suggestionField,
    plugin,
    // Prec.highest so accepting a suggestion beats editor setups (e.g.
    // @uiw/react-codemirror's indentWithTab) that bind Tab to indentation.
    // acceptSuggestion returns false when there is no ghost text, letting Tab
    // fall through to indentation as usual.
    Prec.highest(
      keymap.of([
        { key: "Tab", run: acceptSuggestion },
        { key: "Escape", run: dismissSuggestion },
      ]),
    ),
  ];
}
