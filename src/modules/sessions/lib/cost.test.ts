import { describe, it, expect } from "vitest";
import { cacheHitRate, estimateCost, PRICES_PER_MTOK, totalTokens } from "./cost";
import type { ModelTokens } from "./statsBridge";

const m = (model: string, tokens: Partial<Omit<ModelTokens, "model">>): ModelTokens => ({
  model,
  output_tokens: 0,
  input_tokens: 0,
  cache_read_tokens: 0,
  cache_write_tokens: 0,
  ...tokens,
});

describe("estimateCost", () => {
  it("prices output tokens by substring match", () => {
    const result = estimateCost([m("claude-opus-4-8", { output_tokens: 1_000_000 })]);
    expect(result).toEqual({ usd: 75, unpricedTokens: 0 });
  });

  it("prices input, cache reads and cache writes at their own rates", () => {
    // sonnet: input 3, cache read 0.3, cache write 3.75 per M.
    const result = estimateCost([
      m("claude-sonnet-5", {
        input_tokens: 1_000_000,
        cache_read_tokens: 1_000_000,
        cache_write_tokens: 1_000_000,
      }),
    ]);
    expect(result.usd).toBeCloseTo(3 + 0.3 + 3.75);
    expect(result.unpricedTokens).toBe(0);
  });

  it("accumulates every token of unknown models as unpriced", () => {
    const result = estimateCost([
      m("claude-sonnet-5", { output_tokens: 1_000_000 }),
      m("unknown-model-v1", { output_tokens: 500_000, input_tokens: 100 }),
    ]);
    expect(result).toEqual({ usd: 15, unpricedTokens: 500_100 });
  });

  it("returns zero for an empty models array", () => {
    expect(estimateCost([])).toEqual({ usd: 0, unpricedTokens: 0 });
  });

  it("price table contains expected models", () => {
    const patterns = PRICES_PER_MTOK.map(([pattern]) => pattern);
    for (const p of ["opus", "sonnet", "haiku", "gpt-5", "codex", "o3", "gemini"]) {
      expect(patterns).toContain(p);
    }
  });
});

describe("totalTokens / cacheHitRate", () => {
  it("sums every token kind", () => {
    expect(totalTokens(m("x", { input_tokens: 1, cache_read_tokens: 2, cache_write_tokens: 3, output_tokens: 4 }))).toBe(10);
  });

  it("is the cache-read share of all input, or null without input", () => {
    expect(cacheHitRate(m("x", { input_tokens: 10, cache_read_tokens: 80, cache_write_tokens: 10 }))).toBe(80);
    expect(cacheHitRate(m("x", { output_tokens: 5 }))).toBeNull();
  });
});
