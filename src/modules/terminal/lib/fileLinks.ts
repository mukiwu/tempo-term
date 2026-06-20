/**
 * Detect file-path-looking tokens in a line of terminal output so they can be
 * turned into Alt-clickable links. Matching is deliberately broad;
 * the caller verifies the file actually exists before opening it, which filters
 * out false positives like bare domains.
 */

import type { ILink, IBufferRange } from "@xterm/xterm";
import { hideLinkTooltip, showLinkTooltip } from "./linkTooltip";
import { matchesOpenModifier } from "@/lib/platform";

export interface FilePathMatch {
  /** The raw matched text, including any :line(:col) suffix. */
  text: string;
  /** Zero-based start index within the line. */
  start: number;
  /** Exclusive end index within the line. */
  end: number;
}

// optional ~/ ./ ../ or / prefix, dir segments, a filename with an extension,
// and an optional :line or :line:col suffix. Segment characters allow any
// Unicode letter/number (via the u flag) so CJK file and directory names match,
// not just ASCII; the extension itself stays ASCII.
const FILE_PATH_RE =
  /(?:~\/|\.{0,2}\/)?(?:[\p{L}\p{N}_.\-]+\/)*[\p{L}\p{N}_.\-]+\.[A-Za-z0-9]+(?::\d+(?::\d+)?)?/gu;

// Web URLs are handled by the web-links addon; skip any file-looking token that
// sits inside one so the two link providers don't fight over the same text.
const WEB_URL_RE = /\bhttps?:\/\/\S+/g;

function webUrlRanges(line: string): { start: number; end: number }[] {
  const ranges: { start: number; end: number }[] = [];
  WEB_URL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = WEB_URL_RE.exec(line)) !== null) {
    ranges.push({ start: m.index, end: m.index + m[0].length });
  }
  return ranges;
}

export function findFilePaths(line: string): FilePathMatch[] {
  const out: FilePathMatch[] = [];
  const urls = webUrlRanges(line);
  FILE_PATH_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FILE_PATH_RE.exec(line)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    const insideUrl = urls.some((u) => start < u.end && end > u.start);
    if (insideUrl) {
      continue;
    }
    out.push({ text: match[0], start, end });
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

interface BuildFileLinkParams {
  text: string;
  range: IBufferRange;
  hint: string;
  isMac: boolean;
  onOpen: (text: string) => void;
}

/**
 * Build an xterm ILink for a detected file path. activate honours the
 * platform open-modifier; hover/leave drive the shared link tooltip so file
 * links get the same hover hint as web links.
 */
export function buildFileLink({
  text,
  range,
  hint,
  isMac,
  onOpen,
}: BuildFileLinkParams): ILink {
  return {
    range,
    text,
    activate: (event: MouseEvent) => {
      if (matchesOpenModifier(event, isMac)) {
        onOpen(text);
      }
    },
    hover: (event: MouseEvent) => {
      showLinkTooltip(hint, event.clientX, event.clientY);
    },
    leave: () => {
      hideLinkTooltip();
    },
  };
}
