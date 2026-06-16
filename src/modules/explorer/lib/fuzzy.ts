/**
 * Lightweight fuzzy subsequence matcher for the file finder. Returns whether
 * the query matches, a score (higher is better) and the matched character
 * indices for highlighting.
 */

export interface FuzzyResult {
  matched: boolean;
  score: number;
  indices: number[];
}

const SEPARATORS = "/\\_-. ";

export function fuzzyMatch(query: string, target: string): FuzzyResult {
  if (query === "") {
    return { matched: true, score: 0, indices: [] };
  }

  const q = query.toLowerCase();
  const t = target.toLowerCase();
  const indices: number[] = [];
  let qi = 0;
  let score = 0;
  let prevMatch = -2;

  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] !== q[qi]) {
      continue;
    }
    indices.push(ti);
    // Reward contiguous runs and matches at word boundaries.
    if (prevMatch === ti - 1) {
      score += 6;
    } else {
      score += 1;
    }
    if (ti === 0 || SEPARATORS.includes(t[ti - 1])) {
      score += 4;
    }
    prevMatch = ti;
    qi += 1;
  }

  if (qi !== q.length) {
    return { matched: false, score: 0, indices: [] };
  }

  // Slightly prefer shorter targets.
  score -= Math.floor(target.length / 24);
  return { matched: true, score, indices };
}

/**
 * Filter and rank a list of strings against a query, best match first. Ties
 * fall back to alphabetical order for stable output.
 */
export function fuzzyRank(query: string, items: string[]): string[] {
  if (query === "") {
    return [...items];
  }
  return items
    .map((item) => ({ item, result: fuzzyMatch(query, item) }))
    .filter((entry) => entry.result.matched)
    .sort(
      (a, b) =>
        b.result.score - a.result.score || a.item.localeCompare(b.item),
    )
    .map((entry) => entry.item);
}
