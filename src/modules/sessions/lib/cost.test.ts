import { describe, it, expect } from "vitest";
import { estimateOutputCost, OUTPUT_PRICES_PER_MTOK } from "./cost";
import type { ModelTokens } from "./statsBridge";

describe("estimateOutputCost", () => {
  it("matches known model by substring and calculates cost", () => {
    const models: ModelTokens[] = [
      { model: "claude-opus-4-8", output_tokens: 1_000_000 }, // opus → 75 USD per M tokens
    ];
    const result = estimateOutputCost(models);
    expect(result).toEqual({ usd: 75, unpricedTokens: 0 });
  });

  it("handles multiple known models with different prices", () => {
    const models: ModelTokens[] = [
      { model: "claude-sonnet-5", output_tokens: 1_000_000 }, // sonnet → 15 USD per M tokens
      { model: "claude-haiku-4-5", output_tokens: 1_000_000 }, // haiku → 4 USD per M tokens
    ];
    const result = estimateOutputCost(models);
    expect(result).toEqual({ usd: 19, unpricedTokens: 0 });
  });

  it("accumulates unpriced tokens for unknown models", () => {
    const models: ModelTokens[] = [
      { model: "claude-sonnet-5", output_tokens: 1_000_000 }, // sonnet → 15 USD per M tokens
      { model: "unknown-model-v1", output_tokens: 500_000 }, // unknown → 0 cost
    ];
    const result = estimateOutputCost(models);
    expect(result).toEqual({ usd: 15, unpricedTokens: 500_000 });
  });

  it("returns zero cost and zero unpriced tokens for empty models array", () => {
    const models: ModelTokens[] = [];
    const result = estimateOutputCost(models);
    expect(result).toEqual({ usd: 0, unpricedTokens: 0 });
  });

  it("handles partial token amounts correctly", () => {
    const models: ModelTokens[] = [
      { model: "claude-opus-4-8", output_tokens: 500_000 }, // 500k tokens @ 75 per M = 37.5 USD
    ];
    const result = estimateOutputCost(models);
    expect(result).toEqual({ usd: 37.5, unpricedTokens: 0 });
  });

  it("price table contains expected models", () => {
    // Verify the price table has the documented models
    const modelSubstrings = OUTPUT_PRICES_PER_MTOK.map(([pattern]) => pattern);
    expect(modelSubstrings).toContain("opus");
    expect(modelSubstrings).toContain("sonnet");
    expect(modelSubstrings).toContain("haiku");
    expect(modelSubstrings).toContain("gpt-5");
    expect(modelSubstrings).toContain("codex");
    expect(modelSubstrings).toContain("o3");
    expect(modelSubstrings).toContain("gemini");
  });
});
