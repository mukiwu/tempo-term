/**
 * How a git status letter reads, shared by every list that shows one: the
 * Source Control panel's rows and the all-changes view's file headers.
 */
export const STATUS_COLOR: Record<string, string> = {
  M: "text-warning",
  A: "text-success",
  D: "text-danger",
  "?": "text-fg-subtle",
  R: "text-accent",
};
