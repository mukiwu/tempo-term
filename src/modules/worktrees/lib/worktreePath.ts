/**
 * Where a new worktree goes, and whether the branch name it is named for will
 * survive being both a git ref and a directory.
 *
 * Pure, and separator-aware rather than platform-aware: these take the repo's
 * own path and keep its spelling, so the Windows behavior is covered by tests on
 * any machine.
 */

/** Whichever separator the repo's path is already written with. */
function separatorOf(path: string): "/" | "\\" {
  return path.includes("\\") && !path.includes("/") ? "\\" : "/";
}

function trimTrailingSeparators(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, "");
  // A bare root is a real directory, and trimming its separator changes which
  // directory it names. "/" would trim to nothing; "C:\" would trim to "C:",
  // which is drive-*relative* — the Rust side refuses it for not being
  // absolute, and it would not mean the drive root anyway.
  if (trimmed === "") {
    return path.slice(0, 1);
  }
  if (/^[A-Za-z]:$/.test(trimmed)) {
    return path.slice(0, 3);
  }
  return trimmed;
}

/**
 * The container a repo's worktrees live in: a sibling of the repo named after
 * it, e.g. `/code/app` → `/code/app-worktrees`.
 *
 * A sibling rather than a directory inside the repo: worktrees inside would
 * show up in the repo's own file tree and searches, and would want gitignoring
 * in a file that belongs to the whole team.
 */
export function defaultContainer(repoPath: string): string {
  return `${trimTrailingSeparators(repoPath)}-worktrees`;
}

/**
 * A branch name as a single directory name.
 *
 * Flattened rather than nested: `feat/x` is one directory, not `feat/` holding
 * `x`. Nesting would leave empty parents behind on removal. The collision this
 * trades for — branches `feat/x` and `feat-x` wanting the same directory — is
 * caught by the Rust side, which refuses a target that is not empty.
 */
export function branchSlug(branch: string): string {
  return branch.replace(/\//g, "-");
}

/** Where a new worktree for `branch` goes. Always absolute, which the Rust side
 *  makes a contract: git resolves a relative path against the repo, our own
 *  pre-flight against the app's cwd. */
export function worktreePathFor(
  repoPath: string,
  branch: string,
  containerPath?: string,
): string {
  const container = containerPath?.trim()
    ? trimTrailingSeparators(containerPath.trim())
    : defaultContainer(repoPath);
  return `${container}${separatorOf(container)}${branchSlug(branch)}`;
}

/** Why a branch name will not do. Codes rather than sentences, so the message
 *  is the caller's to translate. */
export type BranchNameError = "empty" | "flag" | "invalid";

// Forbidden by git-check-ref-format, plus the characters Windows will not put in
// a path: a worktree branch has to be both a ref and a directory.
const FORBIDDEN_CHARS = /[\s~^:?*[\]\\"<>|]/;

/**
 * Whether this name can be a branch, or null when it can.
 *
 * Checked here rather than left to git so the user finds out while typing. The
 * Rust side refuses the same names — this is the friendly half of that, not the
 * only half.
 */
export function branchNameError(branch: string): BranchNameError | null {
  const name = branch.trim();
  if (!name) {
    return "empty";
  }
  // git reads a leading dash as a flag, and so does the command we build.
  if (name.startsWith("-")) {
    return "flag";
  }
  if (FORBIDDEN_CHARS.test(name)) {
    return "invalid";
  }
  if (name.includes("..") || name.includes("@{") || name === "@") {
    return "invalid";
  }
  if (name.startsWith("/") || name.endsWith("/") || name.includes("//")) {
    return "invalid";
  }
  if (name.endsWith(".") || name.endsWith(".lock")) {
    return "invalid";
  }
  // No path component may start with a dot: that is a ref rule, and it would
  // also make a hidden directory.
  if (name.split("/").some((part) => part.startsWith("."))) {
    return "invalid";
  }
  return null;
}
