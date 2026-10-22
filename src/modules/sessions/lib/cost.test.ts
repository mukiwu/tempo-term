import { describe, it, expect } from "vitest";
import { cacheHitRate, estimateCost, priceFor, totalTokens } from "./cost";
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
  it("prices each Opus version at its own rate", () => {
    expect(estimateCost([m("claude-opus-5-5", { output_tokens: 1_000_000 })]).usd).toBe(20);
    expect(estimateCost([m("claude-opus-4-7", { output_tokens: 1_000_000 })]).usd).toBe(25);
    expect(estimateCost([m("claude-opus-4-1", { output_tokens: 1_000_000 })]).usd).toBe(75);
  });

  it("matches the most specific version first", () => {
    expect(priceFor("claude-sonnet-5-5")?.pattern).toBe("sonnet-5-5");
    expect(priceFor("claude-sonnet-5")?.pattern).toBe("sonnet-5");
    expect(priceFor("claude-sonnet-4-6")?.pattern).toBe("sonnet");
    expect(priceFor("claude-fable-5-1")?.pattern).toBe("fable-5-1");
  });

  it("prices Claude cache reads per model and cache writes at the 1-hour rate", () => {
    // opus-5-5: input 4, cache read 0.2, cache write 8 per M.
    const result = estimateCost([
      m("claude-opus-5-5", {
        input_tokens: 1_000_000,
        cache_read_tokens: 1_000_000,
        cache_write_tokens: 1_000_000,
      }),
    ]);
    expect(result.usd).toBeCloseTo(4 + 0.2 + 8);
  });

  it("prices OpenAI models from the official table", () => {
    const result = estimateCost([
      m("gpt-6-astra", { input_tokens: 1_000_000, cache_read_tokens: 1_000_000, output_tokens: 1_000_000 }),
    ]);
    expect(result.usd).toBeCloseTo(10 + 1 + 50);
    expect(priceFor("gpt-6.1-sol")?.output).toBe(10);
  });

  it("accumulates every token of unknown models as unpriced", () => {
    const result = estimateCost([
      m("claude-sonnet-5-5", { output_tokens: 1_000_000 }),
      m("codex-auto-review", { output_tokens: 500_000, input_tokens: 100 }),
    ]);
    expect(result).toEqual({ usd: 10, unpricedTokens: 500_100 });
  });

  it("returns zero for an empty models array", () => {
    expect(estimateCost([])).toEqual({ usd: 0, unpricedTokens: 0 });
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
