import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { aiChat } = vi.hoisted(() => ({ aiChat: vi.fn() }));
vi.mock("../lib/aiBridge", () => ({ aiChat }));
// perWindowStorage touches Tauri window APIs; back it with an in-memory map so
// the persist middleware has a real getItem/setItem/removeItem to call.
vi.mock("@/lib/window", () => {
  const map = new Map<string, string>();
  return {
    perWindowStorage: () => ({
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => map.set(k, v),
      removeItem: (k: string) => map.delete(k),
    }),
  };
});

import { useChatStore } from "./chatStore";
import { CUSTOM_PROVIDER_ID } from "../lib/providers";

const initial = useChatStore.getState();

afterEach(() => {
  useChatStore.setState(initial, true);
  aiChat.mockReset();
});

beforeEach(() => {
  aiChat.mockResolvedValue("ok");
});

describe("chatStore.send base URL resolution", () => {
  it("sends the user's custom base URL when the custom provider is selected", async () => {
    useChatStore.setState({
      providerId: CUSTOM_PROVIDER_ID,
      model: "my-local-model",
      customBaseUrl: "http://localhost:9999/v1",
    });

    await useChatStore.getState().send("hi", "sys");

    expect(aiChat).toHaveBeenCalledTimes(1);
    expect(aiChat.mock.calls[0][0]).toMatchObject({
      provider: CUSTOM_PROVIDER_ID,
      kind: "openai",
      baseUrl: "http://localhost:9999/v1",
      model: "my-local-model",
    });
  });

  it("ignores customBaseUrl for a non-custom provider", async () => {
    useChatStore.setState({
      providerId: "openai",
      model: "gpt-5.4",
      customBaseUrl: "http://localhost:9999/v1",
    });

    await useChatStore.getState().send("hi", "sys");

    expect(aiChat.mock.calls[0][0]).toMatchObject({
      baseUrl: "https://api.openai.com/v1",
    });
  });
});

describe("chatStore.setProvider model handling", () => {
  it("clears the model when switching to a provider with no preset models", () => {
    useChatStore.setState({ providerId: "openai", model: "gpt-5.4" });
    useChatStore.getState().setProvider("lmstudio");
    expect(useChatStore.getState().model).toBe("");
  });

  it("seeds the first preset model when switching to one that has models", () => {
    useChatStore.setState({ providerId: "lmstudio", model: "local-x" });
    useChatStore.getState().setProvider("openai");
    expect(useChatStore.getState().model).toBe("gpt-5.6-sol");
  });

  it("keeps the typed model when re-selecting the same bare-endpoint provider", () => {
    useChatStore.setState({ providerId: CUSTOM_PROVIDER_ID, model: "my-local-model" });
    useChatStore.getState().setProvider(CUSTOM_PROVIDER_ID);
    expect(useChatStore.getState().model).toBe("my-local-model");
  });
});
