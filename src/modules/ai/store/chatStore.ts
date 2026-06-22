import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { perWindowStorage } from "@/lib/window";
import { aiChat } from "../lib/aiBridge";
import { composeMessages, type ChatMessage } from "../lib/chat";
import { providerById, PROVIDERS } from "../lib/providers";

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
  messages: ChatMessage[];
  sending: boolean;
  error: string | null;
  /** Absolute file paths the user attached as extra context for the assistant. */
  attachedPaths: string[];
  setProvider: (id: string) => void;
  setModel: (model: string) => void;
  send: (text: string, systemPrompt: string) => Promise<void>;
  clear: () => void;
  attachPath: (path: string) => void;
  removeAttached: (path: string) => void;
  clearAttached: () => void;
}

export const CHAT_STORAGE_KEY = "tempoterm-chat";

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      providerId: PROVIDERS[0].id,
      model: PROVIDERS[0].models[0],
      messages: [],
      sending: false,
      error: null,
      attachedPaths: [],

      setProvider: (id) => {
        const provider = providerById(id);
        set({ providerId: provider.id, model: provider.models[0] });
      },

      setModel: (model) => set({ model }),

      send: async (text, systemPrompt) => {
        const trimmed = text.trim();
        if (!trimmed || get().sending) {
          return;
        }
        const { providerId, model, messages } = get();
        const provider = providerById(providerId);
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
            baseUrl: provider.baseUrl,
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
        attachedPaths: state.attachedPaths,
      }),
    },
  ),
);
