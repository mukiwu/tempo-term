import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectionForm } from "./ConnectionForm";
import "../../i18n";

// vi.mock is hoisted to the top of the file, so mocks must be created with
// vi.hoisted() to be accessible inside the factory callbacks.
const { mockInvoke, mockOpenSshTab, mockAddConnection, mockUpdateConnection } = vi.hoisted(
  () => ({
    mockInvoke: vi.fn().mockResolvedValue(undefined),
    mockOpenSshTab: vi.fn(),
    mockAddConnection: vi.fn().mockReturnValue("test-id-123"),
    mockUpdateConnection: vi.fn(),
  }),
);

// Stub Tauri's invoke so the component can import without a Tauri runtime
vi.mock("@tauri-apps/api/core", () => ({
  invoke: mockInvoke,
}));

// Stub the tabs store so openSshTab doesn't blow up in jsdom
vi.mock("@/stores/tabsStore", () => ({
  useTabsStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({ openSshTab: mockOpenSshTab }),
}));

// Stub the connections store — track calls but don't need real persistence
vi.mock("@/stores/connectionsStore", () => ({
  useConnectionsStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({
      addConnection: mockAddConnection,
      updateConnection: mockUpdateConnection,
    }),
}));

/** Open the Auth method Combobox and click the given display label. */
function selectAuthMethod(displayLabel: string) {
  // The Combobox trigger button has aria-label="Auth method"
  const triggers = screen.getAllByRole("button", { name: /auth method/i });
  fireEvent.click(triggers[0]);
  fireEvent.click(screen.getByText(displayLabel));
}

describe("ConnectionForm", () => {
  beforeEach(() => {
    mockAddConnection.mockClear();
    mockUpdateConnection.mockClear();
    mockInvoke.mockClear();
    mockOpenSshTab.mockClear();
  });

  it("renders the paste box and form fields", () => {
    render(<ConnectionForm onClose={() => {}} />);
    expect(screen.getByPlaceholderText(/ssh user@host/i)).toBeInTheDocument();
    expect(screen.getByText(/Host/i)).toBeInTheDocument();
    expect(screen.getByText(/Port/i)).toBeInTheDocument();
    expect(screen.getByText(/Username/i)).toBeInTheDocument();
  });

  it("auto-fills host field when an ssh command is pasted", () => {
    render(<ConnectionForm onClose={() => {}} />);
    const pasteBox = screen.getByPlaceholderText(/ssh user@host/i);
    fireEvent.change(pasteBox, { target: { value: "ssh muki@example.com" } });
    // Both name and host auto-fill to "example.com" — use getAllBy to handle both
    const matches = screen.getAllByDisplayValue("example.com");
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it("auto-fills user from user@host syntax", () => {
    render(<ConnectionForm onClose={() => {}} />);
    const pasteBox = screen.getByPlaceholderText(/ssh user@host/i);
    fireEvent.change(pasteBox, { target: { value: "ssh muki@example.com" } });
    expect(screen.getByDisplayValue("muki")).toBeInTheDocument();
  });

  it("auto-fills port when -p flag is used", () => {
    render(<ConnectionForm onClose={() => {}} />);
    const pasteBox = screen.getByPlaceholderText(/ssh user@host/i);
    fireEvent.change(pasteBox, { target: { value: "ssh -p 2222 muki@example.com" } });
    expect(screen.getByDisplayValue("2222")).toBeInTheDocument();
  });

  it("shows ignored message when deferred flags like -J are used", () => {
    render(<ConnectionForm onClose={() => {}} />);
    const pasteBox = screen.getByPlaceholderText(/ssh user@host/i);
    fireEvent.change(pasteBox, {
      target: { value: "ssh -J bastion muki@example.com" },
    });
    expect(screen.getByText(/jump host/i)).toBeInTheDocument();
  });

  it("hides the key path field when authMethod is password", () => {
    render(<ConnectionForm onClose={() => {}} />);
    expect(screen.queryByPlaceholderText("~/.ssh/id_ed25519")).not.toBeInTheDocument();
  });

  it("shows the key path field when pasting a -i command", () => {
    render(<ConnectionForm onClose={() => {}} />);
    const pasteBox = screen.getByPlaceholderText(/ssh user@host/i);
    fireEvent.change(pasteBox, {
      target: { value: "ssh -i ~/.ssh/id_ed25519 muki@example.com" },
    });
    expect(screen.getByDisplayValue("~/.ssh/id_ed25519")).toBeInTheDocument();
  });

  it("does not crash on garbage input", () => {
    render(<ConnectionForm onClose={() => {}} />);
    const pasteBox = screen.getByPlaceholderText(/ssh user@host/i);
    // Should not throw
    fireEvent.change(pasteBox, { target: { value: "not an ssh command at all!!!" } });
  });

  it("hides secret field and remember checkbox when authMethod is agent", () => {
    render(<ConnectionForm onClose={() => {}} />);

    // Verify the secret field IS present before switching (sanity check)
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();

    // Switch to "SSH agent" via the Combobox
    selectAuthMethod("SSH agent");

    // Secret input must be gone
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/passphrase/i)).not.toBeInTheDocument();

    // Remember checkbox must be gone too
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("pre-fills fields from existing connection in edit mode", () => {
    const existing = {
      id: "abc-123",
      name: "My Server",
      host: "server.example.com",
      port: 2222,
      user: "admin",
      authMethod: "password" as const,
      rememberSecret: false,
    };
    render(<ConnectionForm connection={existing} onClose={() => {}} />);
    expect(screen.getByDisplayValue("My Server")).toBeInTheDocument();
    expect(screen.getByDisplayValue("server.example.com")).toBeInTheDocument();
    expect(screen.getByDisplayValue("2222")).toBeInTheDocument();
    expect(screen.getByDisplayValue("admin")).toBeInTheDocument();
  });

  // ──────────────────────────────────────────────
  // W2: Save / Connect handler behavior
  // ──────────────────────────────────────────────

  it("Save persists profile without secret and calls ssh_secret_set with the returned id", async () => {
    render(<ConnectionForm onClose={() => {}} />);

    // Fill required fields
    fireEvent.change(screen.getByPlaceholderText("example.com"), {
      target: { value: "myserver.io" },
    });
    fireEvent.change(screen.getByPlaceholderText("root"), {
      target: { value: "deploy" },
    });

    // Enter a secret — query by input type to avoid ambiguity with the
    // "Remember password" label that also contains the word "password"
    const secretInput = document.querySelector('input[type="password"]') as HTMLInputElement;
    fireEvent.change(secretInput, { target: { value: "s3cr3t" } });

    // Check the remember checkbox
    const rememberCheckbox = screen.getByRole("checkbox");
    fireEvent.click(rememberCheckbox);

    // Click Save
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => {
      expect(mockAddConnection).toHaveBeenCalledTimes(1);
    });

    // The profile passed to addConnection must NOT contain a secret/password field
    const profile = mockAddConnection.mock.calls[0][0] as Record<string, unknown>;
    expect(profile).not.toHaveProperty("secret");
    expect(profile).not.toHaveProperty("password");
    expect(profile).not.toHaveProperty("passphrase");

    // ssh_secret_set must be invoked with the id that addConnection returned
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("ssh_secret_set", {
        connectionId: "test-id-123",
        secret: "s3cr3t",
      });
    });
  });

  it("remember UNCHECKED → profile still saved but ssh_secret_set NOT called", async () => {
    render(<ConnectionForm onClose={() => {}} />);

    fireEvent.change(screen.getByPlaceholderText("example.com"), {
      target: { value: "myserver.io" },
    });

    // Enter a secret but leave remember UNCHECKED (default)
    // Query by type to avoid ambiguity with the "Remember password" label
    const secretInput = document.querySelector('input[type="password"]') as HTMLInputElement;
    fireEvent.change(secretInput, { target: { value: "s3cr3t" } });

    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    // Profile must still be persisted
    await waitFor(() => {
      expect(mockAddConnection).toHaveBeenCalledTimes(1);
    });

    // But the secret must NOT be written to keyring
    await waitFor(() => {
      expect(mockInvoke).not.toHaveBeenCalledWith(
        "ssh_secret_set",
        expect.anything(),
      );
    });
  });

  it("Connect persists the profile then opens the SSH tab with the same id", async () => {
    const onClose = vi.fn();
    render(<ConnectionForm onClose={onClose} />);

    fireEvent.change(screen.getByPlaceholderText("example.com"), {
      target: { value: "myserver.io" },
    });
    fireEvent.change(screen.getByPlaceholderText("root"), {
      target: { value: "deploy" },
    });

    fireEvent.click(screen.getByRole("button", { name: /connect/i }));

    // addConnection must be called first (persist before open)
    await waitFor(() => {
      expect(mockAddConnection).toHaveBeenCalledTimes(1);
    });

    // openSshTab must be called with the SAME id that addConnection returned
    await waitFor(() => {
      expect(mockOpenSshTab).toHaveBeenCalledWith("test-id-123", expect.any(String));
    });

    // Verify ordering: addConnection was called before openSshTab
    const addOrder = mockAddConnection.mock.invocationCallOrder[0];
    const openOrder = mockOpenSshTab.mock.invocationCallOrder[0];
    expect(addOrder).toBeLessThan(openOrder);
  });
});
