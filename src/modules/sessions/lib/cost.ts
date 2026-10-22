import type { ModelTokens } from "./statsBridge";

/**
 * List prices per 1M tokens in USD as [input, output]. Models are matched by
 * substring; unknown models contribute 0 cost and are tracked as unpriced
 * tokens.
 */
export const PRICES_PER_MTOK: ReadonlyArray<[pattern: string, input: number, output: number]> = [
  ["opus", 15, 75],
  ["sonnet", 3, 15],
  ["haiku", 0.8, 4],
  ["gpt-5", 1.25, 10],
  ["codex", 1.25, 10],
  ["o3", 2, 8],
  ["gemini", 1.25, 10],
];

/** Cache reads bill at a tenth of the input rate across these providers. */
const CACHE_READ_MULTIPLIER = 0.1;
/** Anthropic's 5-minute cache write rate; providers without a separate cache
 *  write report zero cache-write tokens, so this never applies to them. */
const CACHE_WRITE_MULTIPLIER = 1.25;

/** Every token a model processed: uncached input, cache reads and writes,
 *  and output. */
export function totalTokens(m: Omit<ModelTokens, "model">): number {
  return m.input_tokens + m.cache_read_tokens + m.cache_write_tokens + m.output_tokens;
}

/** Share of input tokens served from cache, 0..100, or `null` when no input
 *  tokens were recorded. */
export function cacheHitRate(m: Omit<ModelTokens, "model" | "output_tokens">): number | null {
  const input = m.input_tokens + m.cache_read_tokens + m.cache_write_tokens;
  return input > 0 ? (m.cache_read_tokens / input) * 100 : null;
}

/**
 * Estimates the list-price cost of a set of models' input, cache and output
 * tokens. Performs substring matching on each model's id against the price
 * table. Returns the estimated cost in USD and the count of unpriced tokens.
 */
export function estimateCost(models: ModelTokens[]): { usd: number; unpricedTokens: number } {
  let usd = 0;
  let unpricedTokens = 0;

  for (const m of models) {
    // Case-insensitive on purpose: model ids from different agents vary in
    // casing (e.g. "GPT-5" vs "gpt-5"), and the table patterns are lowercase.
    const id = m.model.toLowerCase();
    const price = PRICES_PER_MTOK.find(([pattern]) => id.includes(pattern));
    if (!price) {
      unpricedTokens += totalTokens(m);
      continue;
    }
    const [, input, output] = price;
    usd +=
      (m.input_tokens * input +
        m.cache_read_tokens * input * CACHE_READ_MULTIPLIER +
        m.cache_write_tokens * input * CACHE_WRITE_MULTIPLIER +
        m.output_tokens * output) /
      1_000_000;
  }

  return { usd, unpricedTokens };
}
