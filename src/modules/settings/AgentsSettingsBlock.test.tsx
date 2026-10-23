import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import "@/i18n";

vi.mock("@/modules/setup/lib/setupTools", () => ({
  detectTools: () =>
    Promise.resolve({
      tools: [
        { id: "claude", installed: true, version: "2.1.309", meetsMin: true, installable: true },
        { id: "codex", installed: false, version: null, meetsMin: false, installable: true },
      ],
      brew: true,
      winget: false,
    }),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string) =>
    cmd === "mcp_servers_list"
      ? Promise.resolve([
          { agent: "claude", name: "deepwiki", transport: "http", target: "https://mcp.example/mcp" },
          { agent: "codex", name: "repl", transport: "stdio", target: "node repl.js" },
        ])
      : Promise.reject(new Error(cmd)),
}));

import { AgentsSettingsBlock } from "./AgentsSettingsBlock";

describe("AgentsSettingsBlock", () => {
  it("shows each agent's version and the configured MCP servers", async () => {
    render(<AgentsSettingsBlock />);
    expect(await screen.findByText("2.1.309")).toBeInTheDocument();
    expect(screen.getAllByText("Not installed")).toHaveLength(2);
    expect(await screen.findByText("deepwiki")).toBeInTheDocument();
    expect(screen.getByText("https://mcp.example/mcp")).toBeInTheDocument();
    expect(screen.getByText("node repl.js")).toBeInTheDocument();
  });
});
