import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { perWindowStorage } from "@/lib/window";
import { aiChat } from "../lib/aiBridge";
import { composeMessages, type ChatMessage } from "../lib/chat";
import { providerById, PROVIDERS, resolveBaseUrl, CUSTOM_PROVIDER_ID } from "../lib/providers";

function getErrorMessage(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Unexpected error";
}

interface ChatState {
  providerId: string;
  model: string;
  /** Chat-only provider used while the default is Apple Intelligence. */
  chatProviderId: string | null;
  chatModel: string | null;
  /** User-supplied base URL for the custom OpenAI-compatible provider. */
  customBaseUrl: string;
  messages: ChatMessage[];
  sending: boolean;
  error: string | null;
  /** Absolute file paths the user attached as extra context for the assistant. */
  attachedPaths: string[];
  setProvider: (id: string) => void;
  setModel: (model: string) => void;
  setChatProvider: (id: string) => void;
  setChatModel: (model: string) => void;
  setCustomBaseUrl: (url: string) => void;
  send: (text: string, systemPrompt: string) => Promise<void>;
  clear: () => void;
  attachPath: (path: string) => void;
  removeAttached: (path: string) => void;
  clearAttached: () => void;
}

/**
 * What the chat panel actually talks to. An Apple Intelligence default is for
 * background tasks; the assistant falls back to the persisted chat-only pair
 * (seeded with OpenAI) and switching in the panel edits that pair, never the
 * default.
 */
export function resolveChatTarget(state: {
  providerId: string;
  model: string;
  chatProviderId: string | null;
  chatModel: string | null;
}): { provider: ReturnType<typeof providerById>; model: string } {
  if (state.providerId !== "apple") {
    return { provider: providerById(state.providerId), model: state.model };
  }
  const provider = providerById(state.chatProviderId ?? "openai");
  return { provider, model: state.chatModel ?? provider.models[0] ?? "" };
}

export const CHAT_STORAGE_KEY = "tempoterm-chat";

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      providerId: PROVIDERS[0].id,
      model: PROVIDERS[0].models[0],
      chatProviderId: null,
      chatModel: null,
      customBaseUrl: providerById(CUSTOM_PROVIDER_ID).baseUrl,
      messages: [],
      sending: false,
      error: null,
      attachedPaths: [],

      setProvider: (id) => {
        const provider = providerById(id);
        const switching = get().providerId !== provider.id;
        set({
          providerId: provider.id,
          // A preset with a fixed list seeds its first model. A bare endpoint
          // (LM Studio, custom) has none: clear the field on an actual switch
          // so the user types their local model instead of inheriting a stale
          // one the server would reject; keep it when re-selecting the same one.
          model: provider.models[0] ?? (switching ? "" : get().model),
        });
      },

      setModel: (model) => set({ model }),

      setChatProvider: (id) => {
        const provider = providerById(id);
        set({ chatProviderId: provider.id, chatModel: provider.models[0] ?? "" });
      },

      setChatModel: (model) => set({ chatModel: model }),

      setCustomBaseUrl: (url) => set({ customBaseUrl: url }),

      send: async (text, systemPrompt) => {
        const trimmed = text.trim();
        if (!trimmed || get().sending) {
          return;
        }
        const { customBaseUrl, messages } = get();
        const { provider, model } = resolveChatTarget(get());
        const payload = composeMessages(systemPrompt, messages, trimmed);

        set({
          messages: [...messages, { role: "user", content: trimmed }],
          sending: true,
          error: null,
        });

        try {
          const reply = await aiChat({
            provider: provider.id,
            kind: provider.kind,
            baseUrl: resolveBaseUrl(provider, customBaseUrl),
            model,
            messages: payload,
          });
          set((state) => ({
            messages: [...state.messages, { role: "assistant", content: reply }],
            sending: false,
          }));
        } catch (error) {
          set({ sending: false, error: getErrorMessage(error) });
        }
      },

      clear: () => set({ messages: [], error: null }),

      attachPath: (path) =>
        set((state) =>
          state.attachedPaths.includes(path)
            ? state
            : { attachedPaths: [...state.attachedPaths, path] },
        ),

      removeAttached: (path) =>
        set((state) => ({
          attachedPaths: state.attachedPaths.filter((p) => p !== path),
        })),

      clearAttached: () => set({ attachedPaths: [] }),
    }),
    {
      name: CHAT_STORAGE_KEY,
      storage: createJSONStorage(() => perWindowStorage()),
      partialize: (state) => ({
        providerId: state.providerId,
        model: state.model,
        chatProviderId: state.chatProviderId,
        chatModel: state.chatModel,
        customBaseUrl: state.customBaseUrl,
        attachedPaths: state.attachedPaths,
      }),
    },
  ),
);
