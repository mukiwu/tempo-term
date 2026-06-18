/**
 * Detect file-path-looking tokens in a line of terminal output so they can be
 * turned into Alt-clickable links. Matching is deliberately broad;
 * the caller verifies the file actually exists before opening it, which filters
 * out false positives like bare domains.
 */

export interface FilePathMatch {
  /** The raw matched text, including any :line(:col) suffix. */
  text: string;
  /** Zero-based start index within the line. */
  start: number;
  /** Exclusive end index within the line. */
  end: number;
}

// optional ~/ ./ ../ or / prefix, dir segments, a filename with an extension,
// and an optional :line or :line:col suffix.
const FILE_PATH_RE =
  /(?:~\/|\.{0,2}\/)?(?:[\w.\-]+\/)*[\w.\-]+\.[A-Za-z0-9]+(?::\d+(?::\d+)?)?/g;

export function findFilePaths(line: string): FilePathMatch[] {
  const out: FilePathMatch[] = [];
  FILE_PATH_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FILE_PATH_RE.exec(line)) !== null) {
    out.push({ text: match[0], start: match.index, end: match.index + match[0].length });
  }
  return out;
}

/**
 * Resolve a matched token to an absolute file path: drop any :line(:col) suffix,
 * expand a leading ~, and join relative paths onto the shell's working directory.
 */
export function resolveFilePath(
  raw: string,
  cwd: string | null,
  home?: string | null,
): string {
  const path = raw.replace(/:\d+(?::\d+)?$/, "");
  if (path.startsWith("/")) {
    return path;
  }
  if (path.startsWith("~/") && home) {
    return `${home.replace(/\/$/, "")}/${path.slice(2)}`;
  }
  const base = (cwd ?? "").replace(/\/$/, "");
  const rel = path.replace(/^\.\//, "");
  return base ? `${base}/${rel}` : rel;
}
