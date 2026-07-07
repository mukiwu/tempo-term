import type { ModelTokens } from "./statsBridge";

/**
 * Pricing per 1M output tokens in USD. Models are matched by substring;
 * unknown models contribute 0 cost and are tracked as unpriced tokens.
 */
export const OUTPUT_PRICES_PER_MTOK: ReadonlyArray<[pattern: string, usd: number]> = [
  ["opus", 75],
  ["sonnet", 15],
  ["haiku", 4],
  ["gpt-5", 10],
  ["codex", 10],
  ["o3", 8],
  ["gemini", 10],
];

/**
 * Estimates the rough output-token cost for a set of models.
 * Performs substring matching on each model's id against the price table.
 * Returns the estimated cost in USD and the count of unpriced tokens.
 */
export function estimateOutputCost(
  models: ModelTokens[]
): { usd: number; unpricedTokens: number } {
  let usd = 0;
  let unpricedTokens = 0;

  for (const { model, output_tokens } of models) {
    let found = false;

    for (const [pattern, pricePerM] of OUTPUT_PRICES_PER_MTOK) {
      // Case-insensitive on purpose: model ids from different agents vary in
      // casing (e.g. "GPT-5" vs "gpt-5"), and the table patterns are lowercase.
      if (model.toLowerCase().includes(pattern.toLowerCase())) {
        usd += (output_tokens / 1_000_000) * pricePerM;
        found = true;
        break;
      }
    }

    if (!found) {
      unpricedTokens += output_tokens;
    }
  }

  return { usd, unpricedTokens };
}
