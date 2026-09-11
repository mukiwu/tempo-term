/**
 * Reading the paths git writes into diff output.
 *
 * Two surfaces need this and they cannot line up by accident: `git_status` goes
 * through libgit2 and hands back raw UTF-8 paths, while `git_diff` shells out
 * to git itself, which quotes a path holding anything non-ASCII. Comparing one
 * against the other without undoing the quoting silently matches nothing — and
 * for a diff, nothing is indistinguishable from "this file did not change".
 */

/** C-style escapes git may use inside a quoted path. */
const SIMPLE_ESCAPES: Record<string, string> = {
  a: "\x07",
  b: "\b",
  t: "\t",
  n: "\n",
  v: "\v",
  f: "\f",
  r: "\r",
  "\\": "\\",
  '"': '"',
};

/**
 * Unquote a path git wrote with `core.quotePath` on. Git emits non-ASCII
 * UTF-8 bytes as three-digit octal escapes, so decode those bytes together
 * rather than leaving them in the repo-relative lookup key.
 */
export function unquoteGitPath(path: string): string {
  if (!path.startsWith('"') || !path.endsWith('"')) {
    return path;
  }
  const body = path.slice(1, -1);
  const output: string[] = [];
  const octalBytes: number[] = [];
  const flushOctalBytes = () => {
    if (octalBytes.length > 0) {
      output.push(new TextDecoder("utf-8").decode(new Uint8Array(octalBytes)));
      octalBytes.length = 0;
    }
  };

  for (let i = 0; i < body.length; i += 1) {
    if (body[i] !== "\\") {
      flushOctalBytes();
      output.push(body[i]);
      continue;
    }

    const escaped = body[i + 1];
    if (escaped === undefined) {
      flushOctalBytes();
      output.push("\\");
      continue;
    }

    if (/^[0-7]$/.test(escaped)) {
      const octal = body.slice(i + 1, i + 4).match(/^[0-7]{1,3}/)?.[0];
      if (octal) {
        octalBytes.push(Number.parseInt(octal, 8));
        i += octal.length;
        continue;
      }
    }

    flushOctalBytes();
    output.push(SIMPLE_ESCAPES[escaped] ?? escaped);
    i += 1;
  }

  flushOctalBytes();
  return output.join("");
}

/** Drop the a/ or b/ git puts in front of a path, quotes stripped first. */
export function stripGitPathSide(target: string, side: "a/" | "b/"): string {
  const bare = unquoteGitPath(target);
  return bare.startsWith(side) ? bare.slice(2) : bare;
}

/**
 * The new-side path out of a `diff --git a/x b/x` header. Both halves carry the
 * same name for everything but a rename, and a path holding " b/" would fool
 * the split — so a caller holding the file's own `+++ b/` line should prefer
 * that and treat this as the provisional answer.
 */
export function diffHeaderPath(line: string): string | null {
  const rest = line.slice("diff --git ".length);
  const split = Math.max(rest.lastIndexOf(' "b/'), rest.lastIndexOf(" b/"));
  if (split < 0) {
    return null;
  }
  return stripGitPathSide(rest.slice(split + 1).trim(), "b/");
}
