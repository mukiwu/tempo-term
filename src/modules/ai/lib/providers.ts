export type ProviderKind = "openai" | "anthropic" | "google";

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
    models: ["gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-5.4-nano", "gpt-5.1", "o3"],
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
];

export function providerById(id: string): ProviderPreset {
  return PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0];
}
