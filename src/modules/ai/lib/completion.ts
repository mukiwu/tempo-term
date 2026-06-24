import type { ChatMessage } from "./chat";

/**
 * Clean a raw model completion into the exact text to insert at the cursor.
 * Models tend to wrap completions in code fences and sometimes echo back the
 * line they are continuing, so strip both. `prefix` is the document text before
 * the cursor; its last line is what the model might repeat.
 */
export function cleanCompletion(raw: string, prefix: string = ""): string {
  let text = raw;
  const trimmed = raw.trim();
  const fence = trimmed.match(/^```[\w-]*\n([\s\S]*?)\n?```$/);
  if (fence) {
    text = fence[1];
  } else {
    const inline = trimmed.match(/^`([^`]*)`$/);
    if (inline) {
      text = inline[1];
    }
  }
  const lastLine = prefix.slice(prefix.lastIndexOf("\n") + 1);
  if (lastLine.length > 0 && text.startsWith(lastLine)) {
    text = text.slice(lastLine.length);
  }
  return text;
}

const COMPLETION_SYSTEM =
  "You are a code completion engine. Continue the code at the <CURSOR> marker. " +
  "Output ONLY the raw text to insert at the cursor: no explanation, no surrounding " +
  "code fences, no repetition of the code before the cursor.";

/**
 * Build the provider messages for a fill-in-the-middle completion request. The
 * user turn shows the code with a <CURSOR> marker between prefix and suffix so
 * the model knows exactly where the insertion goes.
 */
export function buildCompletionMessages(
  prefix: string,
  suffix: string,
  language: string,
): ChatMessage[] {
  return [
    { role: "system", content: COMPLETION_SYSTEM },
    {
      role: "user",
      content: `Language: ${language}\n${prefix}<CURSOR>${suffix}`,
    },
  ];
}
