import { aiChat } from "@/modules/ai/lib/aiBridge";
import { composeMessages } from "@/modules/ai/lib/chat";
import { providerById, resolveBaseUrl } from "@/modules/ai/lib/providers";
import { redactSecrets } from "@/modules/ai/lib/redact";

const SYSTEM_PROMPT =
  "You are a git commit message generator. Given a staged diff, write a single " +
  "concise Conventional Commits message in the form 'type(scope): summary' " +
  "(types: feat, fix, refactor, docs, test, chore, perf, ci). Output ONLY the " +
  "commit message text, with no code fences, quotes or explanation.";

/** Build the user prompt from a staged diff, bounding huge diffs. */
export function buildCommitPrompt(diff: string, maxChars = 12000): string {
  const body =
    diff.length > maxChars ? `${diff.slice(0, maxChars)}\n...[truncated]` : diff;
  return `Write a conventional commit message for this staged diff:\n\n${redactSecrets(body)}`;
}

/** Strip code fences and surrounding whitespace from a model's reply. */
export function sanitizeCommitMessage(text: string): string {
  return text
    .trim()
    .replace(/^```[a-zA-Z]*\n?/, "")
    .replace(/\n?```$/, "")
    .trim();
}

/** Ask the configured AI provider for a commit message based on a diff. */
export async function generateCommitMessage(
  diff: string,
  providerId: string,
  model: string,
  customBaseUrl: string,
): Promise<string> {
  const provider = providerById(providerId);
  const messages = composeMessages(SYSTEM_PROMPT, [], buildCommitPrompt(diff));
  const reply = await aiChat({
    provider: provider.id,
    kind: provider.kind,
    baseUrl: resolveBaseUrl(provider, customBaseUrl),
    model,
    messages,
  });
  return sanitizeCommitMessage(reply);
}
