import { Extension } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export interface NoteSearchMatch {
  from: number;
  to: number;
}

export interface NoteSearchDecorations {
  matches: NoteSearchMatch[];
  active: number;
}

export const noteSearchPluginKey = new PluginKey<DecorationSet>("noteSearchHighlight");

/** Decorations are driven by the note search controller through transaction meta. */
export const NoteSearchHighlight = Extension.create({
  name: "noteSearchHighlight",

  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: noteSearchPluginKey,
        state: {
          init: () => DecorationSet.empty,
          apply(transaction, decorations) {
            const update = transaction.getMeta(noteSearchPluginKey) as
              | NoteSearchDecorations
              | null
              | undefined;
            if (update === null) {
              return DecorationSet.empty;
            }
            if (update) {
              return DecorationSet.create(
                transaction.doc,
                update.matches.map((match, index) =>
                  Decoration.inline(match.from, match.to, {
                    class:
                      index === update.active
                        ? "note-search-match note-search-match--active"
                        : "note-search-match",
                    ...(index === update.active ? { "data-note-search-active": "true" } : {}),
                  }),
                ),
              );
            }
            return transaction.docChanged
              ? decorations.map(transaction.mapping, transaction.doc)
              : decorations;
          },
        },
        props: {
          decorations: (state) => noteSearchPluginKey.getState(state) ?? DecorationSet.empty,
        },
      }),
    ];
  },
});
