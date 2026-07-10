/**
 * Pure spec builder for the terminal's context menu, mirroring the
 * inputMenuSpecs pattern: the component maps specs to ContextMenu items and
 * wires the handlers. Copy is greyed (not hidden) without a selection so the
 * menu keeps a stable shape the way native menus do.
 */

export type TerminalMenuAction = "copy" | "paste" | "selectAll" | "clear" | "search";

export interface TerminalMenuContext {
  hasSelection: boolean;
}

export interface TerminalMenuItemSpec {
  action: TerminalMenuAction;
  enabled: boolean;
  /** Group index; ContextMenu draws a divider between consecutive groups. */
  group: number;
}

export function terminalMenuSpecs(ctx: TerminalMenuContext): TerminalMenuItemSpec[] {
  return [
    { action: "copy", enabled: ctx.hasSelection, group: 0 },
    { action: "paste", enabled: true, group: 0 },
    { action: "selectAll", enabled: true, group: 0 },
    { action: "clear", enabled: true, group: 1 },
    { action: "search", enabled: true, group: 1 },
  ];
}
