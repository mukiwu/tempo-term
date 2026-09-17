/** One run of text, marked if the query matched it. */
export interface QuerySegment {
  text: string;
  hit: boolean;
}

/**
 * Split `text` into runs, marking the ones the query matched. Case-insensitive
 * and literal, because the graph's search is a substring test rather than a
 * pattern — the same test `commitMatches` uses to decide the row matched at all.
 *
 * Returns the whole string as one unmatched run when there is nothing to mark,
 * so a caller can skip the wrapping spans entirely in the common case.
 */
export function splitOnQuery(text: string, query: string): QuerySegment[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") {
    return [{ text, hit: false }];
  }
  const haystack = text.toLowerCase();
  const runs: QuerySegment[] = [];
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) {
      break;
    }
    const previous = runs[runs.length - 1];
    if (at > from) {
      runs.push({ text: text.slice(from, at), hit: false });
    } else if (previous?.hit) {
      // This match begins exactly where the last one ended — "off" searched for
      // "f". Two runs would be two adjacent <mark>s, and a translucent
      // background drawn twice over the pixels where their boxes meet leaves a
      // darker seam. One run is also the truer description: the reader sees a
      // single stretch of matched text, not two.
      previous.text += text.slice(at, at + needle.length);
      from = at + needle.length;
      continue;
    }
    runs.push({ text: text.slice(at, at + needle.length), hit: true });
    from = at + needle.length;
  }
  if (runs.length === 0) {
    return [{ text, hit: false }];
  }
  if (from < text.length) {
    runs.push({ text: text.slice(from), hit: false });
  }
  return runs;
}
