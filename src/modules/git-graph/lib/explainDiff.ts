import { aiChat } from "@/modules/ai/lib/aiBridge";
import { composeMessages } from "@/modules/ai/lib/chat";
import { providerById, resolveBaseUrl } from "@/modules/ai/lib/providers";
import { redactSecrets } from "@/modules/ai/lib/redact";

export const EXPLAIN_SYSTEM_PROMPT =
  "You are a senior software engineer. Explain a git diff in simple, scannable terms: " +
  "what was added or removed, and why the change was likely made. Use brief markdown " +
  "(bold, bullet points) and keep it concise and easy to read.";

/** Build the user prompt for explaining one file's diff, bounding huge diffs. */
export function buildExplainPrompt(
  diff: string,
  file: string,
  lang: string,
  maxChars = 12000,
): string {
  const body = redactSecrets(
    diff.length > maxChars ? `${diff.slice(0, maxChars)}\n...[truncated]` : diff,
  );
  const language = lang.startsWith("zh")
    ? "Respond in 正體中文 (Traditional Chinese)."
    : "Respond in English.";
  return `Explain the changes in this diff for file "${file}".\n${language}\n\nGit diff:\n${body}`;
}

/** Ask the configured AI provider to explain a file's diff. */
export async function explainDiff(
  diff: string,
  file: string,
  providerId: string,
  model: string,
  lang: string,
  customBaseUrl: string,
): Promise<string> {
  const provider = providerById(providerId);
  const messages = composeMessages(
    EXPLAIN_SYSTEM_PROMPT,
    [],
    buildExplainPrompt(diff, file, lang),
  );
  return aiChat({
    provider: provider.id,
    kind: provider.kind,
    baseUrl: resolveBaseUrl(provider, customBaseUrl),
    model,
    messages,
  });
}
