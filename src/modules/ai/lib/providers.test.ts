import { describe, expect, it } from "vitest";
import {
  CUSTOM_PROVIDER_ID,
  PROVIDERS,
  providerById,
  resolveBaseUrl,
} from "./providers";

describe("PROVIDERS", () => {
  it("ships an LM Studio preset on its default loopback port", () => {
    const lm = PROVIDERS.find((p) => p.id === "lmstudio");
    expect(lm).toBeDefined();
    expect(lm?.kind).toBe("openai");
    expect(lm?.baseUrl).toBe("http://localhost:1234/v1");
    expect(lm?.needsKey).toBe(false);
  });

  it("ships a generic OpenAI-compatible custom provider", () => {
    const custom = PROVIDERS.find((p) => p.id === CUSTOM_PROVIDER_ID);
    expect(custom).toBeDefined();
    expect(custom?.kind).toBe("openai");
  });

  it("keeps provider ids unique", () => {
    const ids = PROVIDERS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("resolveBaseUrl", () => {
  it("returns the preset base URL for a non-custom provider", () => {
    const ollama = providerById("ollama");
    expect(resolveBaseUrl(ollama, "http://ignored")).toBe(ollama.baseUrl);
  });

  it("returns the user's base URL for the custom provider", () => {
    const custom = providerById(CUSTOM_PROVIDER_ID);
    expect(resolveBaseUrl(custom, "http://localhost:9000/v1")).toBe("http://localhost:9000/v1");
  });

  it("trims surrounding whitespace on the custom base URL", () => {
    const custom = providerById(CUSTOM_PROVIDER_ID);
    expect(resolveBaseUrl(custom, "  http://localhost:1234/v1  ")).toBe(
      "http://localhost:1234/v1",
    );
  });

  it("falls back to the custom preset default when the user URL is blank", () => {
    const custom = providerById(CUSTOM_PROVIDER_ID);
    expect(resolveBaseUrl(custom, "   ")).toBe(custom.baseUrl);
  });

  it("tolerates a missing custom base URL from unhydrated/old state", () => {
    const custom = providerById(CUSTOM_PROVIDER_ID);
    expect(resolveBaseUrl(custom, undefined)).toBe(custom.baseUrl);
    expect(resolveBaseUrl(custom, null)).toBe(custom.baseUrl);
  });
});
