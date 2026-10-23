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
  /** Last local date ("YYYY-MM-DD") this rate applies; a later entry with
   *  the same pattern takes over from the next day. */
  until?: string;
}

/** Claude Code writes its prompt cache with the 1-hour TTL almost always
 *  (about 84% of cache-write tokens in local logs as of 2026-10-23), which
 *  bills at 2x the input rate; the index does not split 1-hour from 5-minute
 *  writes, so the 1-hour rate is used for all of them. */
const CLAUDE_CACHE_WRITE = 2;

function claude(pattern: string, input: number, output: number, cacheRead = input * 0.1): ModelPrice {
  return { pattern, input, cacheRead, cacheWrite: input * CLAUDE_CACHE_WRITE, output };
}

type Rate = Pick<ModelPrice, "input" | "cacheRead" | "output">;

const FLASH_INTRO: Rate = { input: 0.75, cacheRead: 0.075, output: 3.75 };
const FLASH_STANDARD: Rate = { input: 1.5, cacheRead: 0.15, output: 7.5 };

/** A Gemini model with an introductory rate through `until`, then its
 *  standard rate. */
function gemini(pattern: string, until: string, intro: Rate, standard: Rate): ModelPrice[] {
  return [
    { pattern, ...intro, until },
    { pattern, ...standard },
  ];
}

/**
 * Standard-tier list prices. The first matching pattern wins, so a specific
 * version must come before the family name it contains (`opus-5-5` before
 * `opus-5`, and both before `opus`).
 *
 * Sources: Anthropic model pricing as of 2026-10-06; OpenAI
 * developers.openai.com/api/docs/pricing as of 2026-10-23 (short-context
 * rates, prompts up to 272K tokens); Gemini ai.google.dev/gemini-api/docs/pricing
 * as of 2026-10-23 (Gemini 3.7 Flash is not on that page; its rates follow
 * Google's announcement and match 3.6/3.8 Flash, cache read assumed the
 * same). Models not listed here, such as `codex-auto-review`, are reported
 * as unpriced.
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
  ...gemini("gemini-4-argon", "2026-11-30", { input: 2, cacheRead: 0.1, output: 10 }, { input: 4, cacheRead: 0.2, output: 20 }),
  ...gemini("gemini-3.8-flash", "2026-12-31", FLASH_INTRO, FLASH_STANDARD),
  ...gemini("gemini-3.7-flash", "2026-12-31", FLASH_INTRO, FLASH_STANDARD),
  ...gemini("gemini-3.6-flash", "2026-12-31", FLASH_INTRO, FLASH_STANDARD),
  { pattern: "gemini-3.5-flash-lite", input: 0.3, cacheRead: 0.03, output: 2.5 },
  { pattern: "gemini-3.1-flash-lite", input: 0.25, cacheRead: 0.025, output: 1.5 },
  { pattern: "gemini-3.1-pro", input: 2, cacheRead: 0.2, output: 12 },
];

/** Local calendar date as "YYYY-MM-DD". */
function dateKey(d: Date): string {
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

/** The price entry for a model id on `date` ("YYYY-MM-DD", default today),
 *  or `undefined` when it is unpriced. */
export function priceFor(model: string, date: string = dateKey(new Date())): ModelPrice | undefined {
  const id = model.toLowerCase();
  return MODEL_PRICES.find((price) => id.includes(price.pattern) && (!price.until || date <= price.until));
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
 * tokens, at the rates in effect on `date` ("YYYY-MM-DD", default today).
 * Returns the estimated cost in USD and the count of unpriced tokens.
 */
export function estimateCost(
  models: ModelTokens[],
  date?: string,
): { usd: number; unpricedTokens: number } {
  let usd = 0;
  let unpricedTokens = 0;

  for (const m of models) {
    const price = priceFor(m.model, date);
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
