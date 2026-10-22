import type { ModelTokens } from "./statsBridge";

/** List prices for one model family, in USD per 1M tokens. */
export interface ModelPrice {
  /** Substring of the model id, matched case-insensitively. */
  pattern: string;
  input: number;
  cacheRead: number;
  /** Cache-write rate; omitted for providers that do not bill writes
   *  separately (their logs report no cache-write tokens). */
  cacheWrite?: number;
  output: number;
}

/** Claude Code writes its prompt cache with the 1-hour TTL almost always
 *  (about 84% of cache-write tokens in local logs as of 2026-10-23), which
 *  bills at 2x the input rate; the index does not split 1-hour from 5-minute
 *  writes, so the 1-hour rate is used for all of them. */
const CLAUDE_CACHE_WRITE = 2;

function claude(pattern: string, input: number, output: number, cacheRead = input * 0.1): ModelPrice {
  return { pattern, input, cacheRead, cacheWrite: input * CLAUDE_CACHE_WRITE, output };
}

/**
 * Standard-tier list prices. The first matching pattern wins, so a specific
 * version must come before the family name it contains (`opus-5-5` before
 * `opus-5`, and both before `opus`).
 *
 * Sources: Anthropic model pricing as of 2026-10-06; OpenAI
 * developers.openai.com/api/docs/pricing as of 2026-10-23 (short-context
 * rates, prompts up to 272K tokens). Models not listed here, such as
 * Antigravity's Gemini sessions (which record no tokens) and
 * `codex-auto-review`, are reported as unpriced.
 */
export const MODEL_PRICES: readonly ModelPrice[] = [
  claude("fable-5-1", 10, 50, 0.25),
  claude("mythos-5-1", 10, 50, 0.25),
  claude("fable", 10, 50),
  claude("mythos", 10, 50),
  claude("opus-5-5", 4, 20, 0.2),
  claude("opus-5", 5, 25),
  claude("opus-4-8", 5, 25),
  claude("opus-4-7", 5, 25),
  claude("opus-4-6", 5, 25),
  claude("opus", 15, 75),
  claude("sonnet-5-5", 2, 10, 0.2),
  claude("sonnet-5", 2, 10),
  claude("sonnet", 3, 15),
  claude("haiku-5-5", 0.1, 0.5),
  claude("haiku-4-5", 1, 5),
  claude("haiku", 0.8, 4),
  { pattern: "gpt-6-astra", input: 10, cacheRead: 1, output: 50 },
  { pattern: "gpt-6.1-sol", input: 2, cacheRead: 0.1, output: 10 },
  { pattern: "gpt-5.3-codex", input: 1.75, cacheRead: 0.175, output: 14 },
];

/** The price entry for a model id, or `undefined` when it is unpriced. */
export function priceFor(model: string): ModelPrice | undefined {
  const id = model.toLowerCase();
  return MODEL_PRICES.find((price) => id.includes(price.pattern));
}

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
    const price = priceFor(m.model);
    if (!price) {
      unpricedTokens += totalTokens(m);
      continue;
    }
    usd +=
      (m.input_tokens * price.input +
        m.cache_read_tokens * price.cacheRead +
        m.cache_write_tokens * (price.cacheWrite ?? price.input) +
        m.output_tokens * price.output) /
      1_000_000;
  }

  return { usd, unpricedTokens };
}
