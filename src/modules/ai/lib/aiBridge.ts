import { invoke } from "@tauri-apps/api/core";
import type { ChatMessage } from "./chat";
import type { ProviderKind } from "./providers";

export interface AiChatParams {
  provider: string;
  kind: ProviderKind;
  baseUrl: string;
  model: string;
  messages: ChatMessage[];
}

export function aiChat(params: AiChatParams): Promise<string> {
  return invoke<string>("ai_chat", {
    provider: params.provider,
    kind: params.kind,
    baseUrl: params.baseUrl,
    model: params.model,
    messages: params.messages,
  });
}

export function secretsSetKey(provider: string, key: string): Promise<void> {
  return invoke("secrets_set_key", { provider, key });
}

export function secretsDeleteKey(provider: string): Promise<void> {
  return invoke("secrets_delete_key", { provider });
}

export function secretsHasKey(provider: string): Promise<boolean> {
  return invoke<boolean>("secrets_has_key", { provider });
}
