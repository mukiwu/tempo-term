// A tiny registry that lets app-level shortcuts and the menu bar reach the
// preview pane the user is looking at. The preview toolbar lives in the DOM but
// its actions (focus the address bar, go back/forward) must be callable from
// outside the component — the ⌘/Ctrl+L keydown handler in App.tsx and ⌘[ / ⌘]
// may arrive while another element holds focus. Each mounted preview registers
// its controls under its pane's leaf id; callers look them up by leaf id.

export interface PreviewControls {
  /** Focus and select the address-bar input. */
  focusAddressBar: () => void;
  back: () => void;
  forward: () => void;
  reload: () => void;
}

const registry = new Map<string, PreviewControls>();

/** Register a preview pane's controls; returns an unregister fn for cleanup. */
export function registerPreviewControls(leafId: string, controls: PreviewControls): () => void {
  registry.set(leafId, controls);
  return () => {
    if (registry.get(leafId) === controls) {
      registry.delete(leafId);
    }
  };
}

/** Look up a preview pane's controls, or undefined when it isn't a live preview. */
export function getPreviewControls(leafId: string): PreviewControls | undefined {
  return registry.get(leafId);
}
