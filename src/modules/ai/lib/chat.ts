export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

/**
 * Assemble the message list sent to a provider: an optional system prompt
 * first, then the existing conversation, then the new user turn. The input
 * history is never mutated.
 */
export function composeMessages(
  systemPrompt: string,
  history: ChatMessage[],
  userText: string,
): ChatMessage[] {
  const messages: ChatMessage[] = [];
  if (systemPrompt.trim().length > 0) {
    messages.push({ role: "system", content: systemPrompt });
  }
  messages.push(...history);
  messages.push({ role: "user", content: userText });
  return messages;
}
