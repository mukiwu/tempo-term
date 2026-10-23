import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@/i18n";

const hosts = vi.hoisted(() => ({
  list: [
    { host: "prod.example.com", keyType: "ssh-ed25519", fingerprint: "SHA256:abc" },
    { host: "[dev]:2222", keyType: "ssh-rsa", fingerprint: "SHA256:def" },
  ],
}));
const invoke = vi.hoisted(() =>
  vi.fn((cmd: string, args?: { host: string }) => {
    if (cmd === "ssh_known_hosts_list") {
      return Promise.resolve(hosts.list);
    }
    if (cmd === "ssh_known_hosts_remove") {
      hosts.list = hosts.list.filter((h) => h.host !== args!.host);
      return Promise.resolve();
    }
    return Promise.reject(new Error(cmd));
  }),
);
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import { SshSettingsSection } from "./SshSettingsSection";

beforeEach(() => {
  invoke.mockClear();
});

describe("SshSettingsSection", () => {
  it("lists trusted hosts with their fingerprints and removes one after confirming", async () => {
    render(<SshSettingsSection />);
    expect(await screen.findByText("prod.example.com")).toBeInTheDocument();
    expect(screen.getByText("ssh-ed25519 SHA256:abc")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Remove prod.example.com" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    await waitFor(() => expect(screen.queryByText("prod.example.com")).not.toBeInTheDocument());
    expect(invoke).toHaveBeenCalledWith("ssh_known_hosts_remove", { host: "prod.example.com" });
    expect(screen.getByText("[dev]:2222")).toBeInTheDocument();
  });

  it("explains the empty state", async () => {
    hosts.list = [];
    render(<SshSettingsSection />);
    expect(await screen.findByText(/No trusted hosts yet/)).toBeInTheDocument();
  });
});
