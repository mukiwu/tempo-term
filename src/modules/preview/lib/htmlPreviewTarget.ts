import { findPaneContent, leafIds, type LayoutNode } from "@/modules/terminal/lib/terminalLayout";

/** Where an HTML web-preview should open, given the source tab's layout. */
export type HtmlPreviewTarget =
  | { kind: "replace"; leafId: string } // a preview pane already exists in this tab
  | { kind: "split"; fromLeafId: string } // single-pane editor tab: split beside it
  | { kind: "previewTab" }; // split tab without a preview pane: use a preview tab

/**
 * Smart open rule (first match wins):
 * 1. the tab already shows a preview pane -> replace its content
 * 2. the tab is a single (unsplit) pane -> split the preview beside the editor
 * 3. otherwise (already split, no preview) -> open/reuse a dedicated preview tab
 */
export function decideHtmlPreviewOpen(paneTree: LayoutNode, fromLeafId: string): HtmlPreviewTarget {
  const previewLeafId = leafIds(paneTree).find(
    (id) => findPaneContent(paneTree, id)?.kind === "preview",
  );
  if (previewLeafId) {
    return { kind: "replace", leafId: previewLeafId };
  }
  if (paneTree.kind === "leaf") {
    return { kind: "split", fromLeafId };
  }
  return { kind: "previewTab" };
}

/**
 * The local filesystem path a preview url points at, or null for a web url.
 * Mirrors resolvePreviewSrc's input handling: `file://` (decoded) and absolute
 * `/` paths are local; everything else (http(s)/asset) is not.
 */
export function previewLocalPath(url: string): string | null {
  const value = url.trim();
  if (value.startsWith("file://")) {
    try {
      return decodeURIComponent(new URL(value).pathname);
    } catch {
      const withoutScheme = value.replace(/^file:\/\//i, "");
      try {
        return decodeURIComponent(withoutScheme);
      } catch {
        return withoutScheme;
      }
    }
  }
  if (value.startsWith("/")) {
    return value;
  }
  return null;
}
