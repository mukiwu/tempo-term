import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@/i18n";
import { useChatStore } from "@/modules/ai/store/chatStore";
import { AiSettingsSection } from "./AiSettingsSection";

const bridge = vi.hoisted(() => ({
  aiAppleAvailable: vi.fn(),
  secretsDeleteKey: vi.fn(),
  secretsHasKey: vi.fn(),
  secretsSetKey: vi.fn(),
}));

vi.mock("@/modules/ai/lib/aiBridge", () => bridge);

const initialChatState = useChatStore.getState();

beforeEach(() => {
  useChatStore.setState(initialChatState, true);
  bridge.aiAppleAvailable.mockResolvedValue(true);
  bridge.secretsHasKey.mockResolvedValue(false);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("AI model settings", () => {
  it("lets quick actions and assistant chat choose independent providers", async () => {
    render(<AiSettingsSection />);

    await waitFor(() => expect(bridge.aiAppleAvailable).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getAllByRole("button", { name: "Quick AI provider" })[0]);
    fireEvent.click(await screen.findByRole("button", { name: "Apple Intelligence" }));
    expect(useChatStore.getState().providerId).toBe("apple");

    fireEvent.click(screen.getAllByRole("button", { name: "AI assistant provider" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Groq" }));
    expect(useChatStore.getState().chatProviderId).toBe("groq");
    expect(useChatStore.getState().providerId).toBe("apple");
  });

  it("probes Apple Intelligence once and keeps it out of the chat choices", async () => {
    render(<AiSettingsSection />);

    await waitFor(() => expect(bridge.aiAppleAvailable).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getAllByRole("button", { name: "AI assistant provider" })[0]);

    expect(screen.queryByRole("button", { name: "Apple Intelligence" })).toBeNull();
    expect(
      screen.getByText(/Apple Intelligence is available for quick AI features/),
    ).toBeInTheDocument();
  });
});
