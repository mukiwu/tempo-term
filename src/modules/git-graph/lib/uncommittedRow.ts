import type { GitStatus } from "@/modules/source-control/lib/gitBridge";
import type { UncommittedSummary } from "../types";

/**
 * What the graph's top row should show, or `null` for no row at all.
 *
 * Two settings meet here. `showRow` is the feature itself. `keepWhenClean`
 * decides what a clean tree looks like: kept, the row stays as a quiet line and
 * the graph never moves; dropped, the row appears and disappears and the whole
 * graph shifts a row every time you commit or touch a file — which is why
 * keeping it is the default, and why anyone turning that off is choosing the
 * movement deliberately.
 *
 * A status that has not arrived yet counts as "nothing to show" rather than as
 * a clean tree, so the row does not blink into view and back out on every
 * reload while `keepWhenClean` is off.
 */
export function uncommittedRowSummary(
  status: GitStatus | null,
  showRow: boolean,
  keepWhenClean: boolean,
): UncommittedSummary | null {
  if (!showRow) {
    return null;
  }
  const staged = status?.staged.length ?? 0;
  const unstaged = status?.unstaged.length ?? 0;
  if (!keepWhenClean && staged + unstaged === 0) {
    return null;
  }
  return { staged, unstaged };
}
