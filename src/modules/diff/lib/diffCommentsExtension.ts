import {
  Decoration,
  type DecorationSet,
  EditorView,
  gutter,
  GutterMarker,
  WidgetType,
} from "@codemirror/view";
import { StateEffect, StateField, type Extension } from "@codemirror/state";

/** The slice of a DiffComment one editor side needs to render. */
export interface CommentView {
  id: string;
  line: number;
  body: string;
  sent: boolean;
}

/** Callbacks and labels the host component wires into the extension. */
export interface CommentHandlers {
  /** The "+" gutter was clicked on a line: open a draft there. */
  onAdd: (line: number) => void;
  /** The draft was confirmed with this body. */
  onSave: (line: number, body: string) => void;
  onCancel: () => void;
  onDelete: (id: string) => void;
  /** In-progress draft text, kept by the host so a widget rebuild (view
   *  recreation, draft moved to another line) doesn't lose what was typed. */
  getDraftBody: () => string;
  onDraftChange: (text: string) => void;
  labels: {
    placeholder: string;
    save: string;
    cancel: string;
    delete: string;
    sent: string;
  };
}

/** Replace the rendered comment set (dispatched whenever the store changes). */
export const setCommentsEffect = StateEffect.define<CommentView[]>();
/** Open (line number) or close (null) the draft input on this side. */
export const setDraftEffect = StateEffect.define<number | null>();

function button(label: string, className: string, onClick: () => void): HTMLButtonElement {
  const el = document.createElement("button");
  el.type = "button";
  el.textContent = label;
  el.className = className;
  el.addEventListener("click", (event) => {
    event.stopPropagation();
    onClick();
  });
  return el;
}

/** A saved comment rendered as a card under its line. */
class CommentCardWidget extends WidgetType {
  constructor(
    readonly comment: CommentView,
    readonly handlers: CommentHandlers,
  ) {
    super();
  }

  override eq(other: CommentCardWidget): boolean {
    return (
      other.comment.id === this.comment.id &&
      other.comment.body === this.comment.body &&
      other.comment.sent === this.comment.sent
    );
  }

  toDOM(): HTMLElement {
    const card = document.createElement("div");
    card.className = `cm-diff-comment-card${this.comment.sent ? " cm-diff-comment-sent" : ""}`;
    const body = document.createElement("div");
    body.className = "cm-diff-comment-body";
    body.textContent = this.comment.body;
    card.appendChild(body);
    const actions = document.createElement("div");
    actions.className = "cm-diff-comment-actions";
    if (this.comment.sent) {
      const sent = document.createElement("span");
      sent.className = "cm-diff-comment-sent-tag";
      sent.textContent = this.handlers.labels.sent;
      actions.appendChild(sent);
    }
    actions.appendChild(
      button(this.handlers.labels.delete, "cm-diff-comment-btn cm-diff-comment-btn-danger", () =>
        this.handlers.onDelete(this.comment.id),
      ),
    );
    card.appendChild(actions);
    return card;
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

/** The in-progress comment input rendered under the clicked line. */
class DraftWidget extends WidgetType {
  constructor(
    readonly line: number,
    readonly handlers: CommentHandlers,
  ) {
    super();
  }

  override eq(other: DraftWidget): boolean {
    return other.line === this.line;
  }

  toDOM(): HTMLElement {
    const card = document.createElement("div");
    card.className = "cm-diff-comment-card cm-diff-comment-draft";
    const input = document.createElement("textarea");
    input.className = "cm-diff-comment-input";
    input.rows = 2;
    input.placeholder = this.handlers.labels.placeholder;
    input.value = this.handlers.getDraftBody();
    input.addEventListener("input", () => this.handlers.onDraftChange(input.value));
    const save = () => {
      const body = input.value.trim();
      if (body) {
        this.handlers.onSave(this.line, body);
      } else {
        this.handlers.onCancel();
      }
    };
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        save();
      }
      if (event.key === "Escape") {
        event.preventDefault();
        this.handlers.onCancel();
      }
    });
    card.appendChild(input);
    const actions = document.createElement("div");
    actions.className = "cm-diff-comment-actions";
    actions.appendChild(button(this.handlers.labels.save, "cm-diff-comment-btn", save));
    actions.appendChild(
      button(this.handlers.labels.cancel, "cm-diff-comment-btn", () => this.handlers.onCancel()),
    );
    card.appendChild(actions);
    // Focus once the widget is attached; toDOM runs before insertion.
    requestAnimationFrame(() => input.focus());
    return card;
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

interface CommentFieldValue {
  comments: CommentView[];
  draft: number | null;
  decorations: DecorationSet;
}

function buildDecorations(
  state: { doc: { lines: number; line: (n: number) => { to: number } } },
  comments: CommentView[],
  draft: number | null,
  handlers: CommentHandlers,
): DecorationSet {
  const ranges = [];
  for (const comment of comments) {
    const line = Math.max(1, Math.min(comment.line, state.doc.lines));
    ranges.push(
      Decoration.widget({
        widget: new CommentCardWidget(comment, handlers),
        block: true,
        side: 1,
      }).range(state.doc.line(line).to),
    );
  }
  if (draft !== null) {
    const line = Math.max(1, Math.min(draft, state.doc.lines));
    ranges.push(
      Decoration.widget({
        widget: new DraftWidget(line, handlers),
        block: true,
        side: 2,
      }).range(state.doc.line(line).to),
    );
  }
  return Decoration.set(ranges, true);
}

const commentTheme = EditorView.baseTheme({
  ".cm-diff-comment-gutter": {
    width: "16px",
    cursor: "pointer",
  },
  ".cm-diff-comment-gutter .cm-gutterElement": {
    opacity: "0",
    textAlign: "center",
    color: "var(--color-accent)",
    fontWeight: "600",
  },
  ".cm-diff-comment-gutter .cm-gutterElement:hover": {
    opacity: "1",
  },
  ".cm-diff-comment-card": {
    margin: "2px 8px 4px",
    padding: "6px 8px",
    borderRadius: "6px",
    border: "1px solid var(--color-border)",
    backgroundColor: "var(--color-bg-elevated)",
    fontFamily: "var(--font-sans, system-ui)",
    fontSize: "12px",
    color: "var(--color-fg)",
  },
  ".cm-diff-comment-sent": {
    opacity: "0.6",
  },
  ".cm-diff-comment-body": {
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  },
  ".cm-diff-comment-actions": {
    display: "flex",
    gap: "8px",
    alignItems: "center",
    marginTop: "4px",
  },
  ".cm-diff-comment-sent-tag": {
    fontSize: "10px",
    color: "var(--color-fg-subtle)",
    border: "1px solid var(--color-border)",
    borderRadius: "4px",
    padding: "0 4px",
  },
  ".cm-diff-comment-btn": {
    fontSize: "11px",
    color: "var(--color-fg-muted)",
    cursor: "pointer",
    padding: "1px 6px",
    borderRadius: "4px",
    border: "1px solid var(--color-border)",
    backgroundColor: "transparent",
  },
  ".cm-diff-comment-btn:hover": {
    color: "var(--color-fg)",
    backgroundColor: "var(--color-bg)",
  },
  ".cm-diff-comment-btn-danger:hover": {
    color: "var(--color-danger, #e5534b)",
  },
  ".cm-diff-comment-input": {
    width: "100%",
    resize: "vertical",
    borderRadius: "4px",
    border: "1px solid var(--color-accent)",
    backgroundColor: "var(--color-bg)",
    color: "var(--color-fg)",
    fontSize: "12px",
    padding: "4px 6px",
    outline: "none",
  },
});

/**
 * Inline review comments for one side of the diff: a hover "+" gutter that
 * opens a draft box under the clicked line, plus block widgets rendering the
 * saved comments. The comment list itself lives outside the editor — the host
 * dispatches setCommentsEffect / setDraftEffect whenever it changes.
 */
export function diffCommentsExtension(handlers: CommentHandlers): Extension {
  const field = StateField.define<CommentFieldValue>({
    create(state) {
      return { comments: [], draft: null, decorations: buildDecorations(state, [], null, handlers) };
    },
    update(value, tr) {
      let { comments, draft } = value;
      let changed = false;
      for (const effect of tr.effects) {
        if (effect.is(setCommentsEffect)) {
          comments = effect.value;
          changed = true;
        }
        if (effect.is(setDraftEffect)) {
          draft = effect.value;
          changed = true;
        }
      }
      if (!changed && !tr.docChanged) {
        return value;
      }
      return { comments, draft, decorations: buildDecorations(tr.state, comments, draft, handlers) };
    },
    provide: (f) => EditorView.decorations.from(f, (v) => v.decorations),
  });

  const addMarker = new (class extends GutterMarker {
    toDOM(): Node {
      const el = document.createElement("span");
      el.textContent = "+";
      return el;
    }
  })();

  const addGutter = gutter({
    class: "cm-diff-comment-gutter",
    lineMarker: () => addMarker,
    domEventHandlers: {
      mousedown(view, block, event) {
        handlers.onAdd(view.state.doc.lineAt(block.from).number);
        event.preventDefault();
        return true;
      },
    },
  });

  return [field, addGutter, commentTheme];
}
