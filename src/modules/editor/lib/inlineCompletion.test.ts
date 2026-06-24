import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, runScopeHandlers } from "@codemirror/view";
import { inlineCompletion, setSuggestion } from "./inlineCompletion";

const noopRequest = async () => "";

/** A Tab binding that always indents, standing in for @uiw/react-codemirror's
 * `indentWithTab`: it is unshifted to the front of the keymap, so at the same
 * precedence level it sits ahead of the inline-completion extension added
 * afterwards and would otherwise swallow every Tab. */
const indentTab = (view: EditorView): boolean => {
  view.dispatch(view.state.replaceSelection("\t"));
  return true;
};

function makeView(doc: string): EditorView {
  const state = EditorState.create({
    doc,
    extensions: [keymap.of([{ key: "Tab", run: indentTab }]), inlineCompletion(noopRequest)],
  });
  return new EditorView({ state });
}

function pressTab(view: EditorView): boolean {
  return runScopeHandlers(view, new KeyboardEvent("keydown", { key: "Tab" }), "editor");
}

describe("inline completion Tab handling", () => {
  it("accepts the ghost suggestion on Tab even when indentWithTab is bound first", () => {
    const view = makeView("const x");
    const end = view.state.doc.length;
    view.dispatch({ selection: { anchor: end } });
    view.dispatch({ effects: setSuggestion.of({ text: " = 1", pos: end }) });

    const handled = pressTab(view);

    expect(handled).toBe(true);
    expect(view.state.doc.toString()).toBe("const x = 1");
    view.destroy();
  });

  it("falls through to indentation on Tab when there is no suggestion", () => {
    const view = makeView("hi");
    view.dispatch({ selection: { anchor: view.state.doc.length } });

    const handled = pressTab(view);

    expect(handled).toBe(true);
    expect(view.state.doc.toString()).toBe("hi\t");
    view.destroy();
  });
});
