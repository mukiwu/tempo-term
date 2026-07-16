import { describe, expect, it } from "vitest";
import { branchNameError, branchSlug, defaultContainer, worktreePathFor } from "./worktreePath";

describe("defaultContainer", () => {
  it("parks worktrees in a sibling of the repo, named after it", () => {
    expect(defaultContainer("/code/tempo-term")).toBe("/code/tempo-term-worktrees");
  });

  it("ignores a trailing slash rather than producing a double one", () => {
    expect(defaultContainer("/code/tempo-term/")).toBe("/code/tempo-term-worktrees");
  });

  it("keeps the repo's own spelling of a separator on Windows", () => {
    expect(defaultContainer("C:\\code\\tempo-term")).toBe("C:\\code\\tempo-term-worktrees");
  });

  it("keeps a Windows drive root absolute", () => {
    // "C:\" trimmed to "C:" is drive-*relative* — a different directory from
    // the drive root, and one the Rust side refuses outright.
    expect(defaultContainer("C:\\")).toBe("C:\\-worktrees");
  });

  it("keeps the unix root absolute too", () => {
    expect(defaultContainer("/")).toBe("/-worktrees");
  });
});

describe("branchSlug", () => {
  it("flattens a branch's slashes into one directory name", () => {
    expect(branchSlug("feat/worktrees")).toBe("feat-worktrees");
  });

  it("leaves an already-flat name alone", () => {
    expect(branchSlug("hotfix")).toBe("hotfix");
  });

  it("flattens every level, not just the first", () => {
    expect(branchSlug("user/muki/feat/x")).toBe("user-muki-feat-x");
  });
});

describe("worktreePathFor", () => {
  it("puts the branch under the repo's container", () => {
    expect(worktreePathFor("/code/tempo-term", "feat/x")).toBe(
      "/code/tempo-term-worktrees/feat-x",
    );
  });

  it("honours a container the user chose instead", () => {
    expect(worktreePathFor("/code/tempo-term", "feat/x", "/scratch/trees")).toBe(
      "/scratch/trees/feat-x",
    );
  });

  it("ignores a blank override rather than treating it as a root", () => {
    expect(worktreePathFor("/code/tempo-term", "feat/x", "   ")).toBe(
      "/code/tempo-term-worktrees/feat-x",
    );
  });

  it("builds a Windows path with Windows separators", () => {
    expect(worktreePathFor("C:\\code\\tempo-term", "feat/x")).toBe(
      "C:\\code\\tempo-term-worktrees\\feat-x",
    );
  });

  it("is absolute, which the Rust side makes a contract", () => {
    // git resolves a relative path against the repo while our pre-flight
    // resolves it against the app's cwd — two different directories.
    expect(worktreePathFor("/code/repo", "x").startsWith("/")).toBe(true);
  });
});

describe("branchNameError", () => {
  it("accepts an ordinary branch name", () => {
    expect(branchNameError("feat/worktrees")).toBeNull();
    expect(branchNameError("fix-123")).toBeNull();
    expect(branchNameError("release/v1.2.0")).toBeNull();
  });

  it("wants a name at all", () => {
    expect(branchNameError("")).toBe("empty");
    expect(branchNameError("   ")).toBe("empty");
  });

  it("rejects a name git itself would refuse", () => {
    expect(branchNameError("feat x")).toBe("invalid");
    expect(branchNameError("feat~1")).toBe("invalid");
    expect(branchNameError("feat^")).toBe("invalid");
    expect(branchNameError("feat:x")).toBe("invalid");
    expect(branchNameError("feat?")).toBe("invalid");
    expect(branchNameError("feat*")).toBe("invalid");
    expect(branchNameError("feat[1]")).toBe("invalid");
    expect(branchNameError("feat\\x")).toBe("invalid");
    expect(branchNameError("feat..x")).toBe("invalid");
    expect(branchNameError("feat@{x")).toBe("invalid");
    expect(branchNameError("@")).toBe("invalid");
  });

  it("rejects the shapes that break a path rather than a ref", () => {
    expect(branchNameError("/feat")).toBe("invalid");
    expect(branchNameError("feat/")).toBe("invalid");
    expect(branchNameError("feat//x")).toBe("invalid");
    expect(branchNameError(".feat")).toBe("invalid");
    expect(branchNameError("feat/.x")).toBe("invalid");
    expect(branchNameError("feat.")).toBe("invalid");
    expect(branchNameError("feat.lock")).toBe("invalid");
  });

  it("rejects a name git would read as a flag", () => {
    // The Rust side refuses these too; saying so here means the user finds out
    // while typing rather than from a failed command.
    expect(branchNameError("-f")).toBe("flag");
    expect(branchNameError("--force")).toBe("flag");
  });

  it("rejects a name that would not survive being a directory", () => {
    // Git allows these in a ref; Windows does not allow them in a path, and the
    // worktree has to be a real directory somewhere.
    expect(branchNameError('feat"x')).toBe("invalid");
    expect(branchNameError("feat<x")).toBe("invalid");
    expect(branchNameError("feat|x")).toBe("invalid");
  });
});
