export type ProviderKind = "openai" | "anthropic" | "google";

/** Provider id whose base URL the user supplies, for any OpenAI-compatible server. */
export const CUSTOM_PROVIDER_ID = "custom";

export interface ProviderPreset {
  id: string;
  label: string;
  kind: ProviderKind;
  baseUrl: string;
  models: string[];
  needsKey: boolean;
}

/** Built-in BYOK providers. OpenAI-compatible endpoints share the "openai" kind. */
export const PROVIDERS: ProviderPreset[] = [
  {
    id: "openai",
    label: "OpenAI",
    kind: "openai",
    baseUrl: "https://api.openai.com/v1",
    models: [
      "gpt-5.6-sol",
      "gpt-5.6-terra",
      "gpt-5.6-luna",
      "gpt-5.5",
      "gpt-5.4",
      "gpt-5.4-mini",
      "gpt-5.4-nano",
      "gpt-5.1",
      "o3",
    ],
    needsKey: true,
  },
  {
    id: "anthropic",
    label: "Anthropic",
    kind: "anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    models: ["claude-opus-4-8", "claude-sonnet-4-6", "claude-haiku-4-5", "claude-fable-5"],
    needsKey: true,
  },
  {
    id: "google",
    label: "Google Gemini",
    kind: "google",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    models: [
      "gemini-3.5-flash",
      "gemini-3.1-pro",
      "gemini-3-flash",
      "gemini-2.5-pro",
      "gemini-2.5-flash",
    ],
    needsKey: true,
  },
  {
    id: "groq",
    label: "Groq",
    kind: "openai",
    baseUrl: "https://api.groq.com/openai/v1",
    models: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"],
    needsKey: true,
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    kind: "openai",
    baseUrl: "https://api.deepseek.com",
    models: ["deepseek-chat", "deepseek-reasoner"],
    needsKey: true,
  },
  {
    id: "ollama",
    label: "Ollama (local)",
    kind: "openai",
    baseUrl: "http://localhost:11434/v1",
    models: ["llama3.2", "qwen2.5-coder", "qwen2.5"],
    needsKey: false,
  },
  {
    id: "lmstudio",
    label: "LM Studio (local)",
    kind: "openai",
    baseUrl: "http://localhost:1234/v1",
    models: [],
    needsKey: false,
  },
  {
    id: CUSTOM_PROVIDER_ID,
    label: "Custom (OpenAI-compatible)",
    kind: "openai",
    // Editable per user via chatStore.customBaseUrl; this is only the seed value
    // shown in the settings field. Covers any OpenAI-compatible server (oMLX,
    // vLLM, a non-default LM Studio port, …). Keyless like the other local
    // presets: an empty key is sent as `Bearer ` and local servers ignore it.
    baseUrl: "http://localhost:1234/v1",
    models: [],
    needsKey: false,
  },
];

export function providerById(id: string): ProviderPreset {
  return PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0];
}

/**
 * Effective base URL for a request. Only the custom provider reads the
 * user-supplied override; everything else uses its fixed preset URL. A blank
 * override falls back to the custom preset's seed so a request never targets a
 * bare "/chat/completions" path.
 */
export function resolveBaseUrl(
  provider: ProviderPreset,
  customBaseUrl: string | undefined | null,
): string {
  if (provider.id !== CUSTOM_PROVIDER_ID) {
    return provider.baseUrl;
  }
  // Tolerate a missing value from unhydrated/older persisted state.
  return (customBaseUrl ?? "").trim() || provider.baseUrl;
}
