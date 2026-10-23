import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { RotateCw } from "lucide-react";
import { detectTools, type ToolStatus } from "@/modules/setup/lib/setupTools";

/** One configured MCP server, as `mcp_servers_list` returns it. */
interface McpServer {
  agent: "claude" | "codex";
  name: string;
  transport: string;
  target: string;
}

const AGENT_IDS = ["claude", "codex", "antigravity"] as const;
const AGENT_NAMES: Record<string, string> = {
  claude: "Claude Code",
  codex: "Codex",
  antigravity: "Antigravity",
};

/**
 * The coding agents installed on this machine and the MCP servers they are
 * configured with. Read-only: both come from the agents' own installs and
 * config files, which stay the place to change them.
 */
export function AgentsSettingsBlock() {
  const { t } = useTranslation("settings");
  const [tools, setTools] = useState<ToolStatus[] | null>(null);
  const [servers, setServers] = useState<McpServer[] | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      detectTools()
        .then((result) => setTools(result.tools))
        .catch(() => setTools([])),
      invoke<McpServer[]>("mcp_servers_list")
        .then(setServers)
        .catch(() => setServers([])),
    ]).finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  return (
    <div className="mt-8 border-t border-border pt-8">
      <div className="mb-1 flex items-center justify-between">
        <label className="block text-sm font-medium text-fg">{t("agents.title")}</label>
        <button
          type="button"
          aria-label={t("agents.refresh")}
          title={t("agents.refresh")}
          onClick={load}
          disabled={loading}
          className="rounded p-1 text-fg-subtle transition-colors hover:bg-bg-elevated hover:text-fg disabled:opacity-40"
        >
          <RotateCw size={13} className={loading ? "animate-spin" : ""} />
        </button>
      </div>
      <p className="mb-2 text-xs text-fg-muted">{t("agents.description")}</p>
      <ul className="mb-6 divide-y divide-border rounded-md border border-border">
        {AGENT_IDS.map((id) => {
          const status = tools?.find((tool) => tool.id === id);
          return (
            <li key={id} className="flex items-center justify-between px-3 py-2 text-sm">
              <span className="text-fg">{AGENT_NAMES[id]}</span>
              <span className="font-mono text-xs text-fg-subtle">
                {tools === null
                  ? t("agents.checking")
                  : status?.installed
                    ? status.version ?? t("agents.installed")
                    : t("agents.notInstalled")}
              </span>
            </li>
          );
        })}
      </ul>

      <label className="mb-1 block text-sm font-medium text-fg">{t("agents.mcpTitle")}</label>
      <p className="mb-2 text-xs text-fg-muted">{t("agents.mcpDescription")}</p>
      {servers !== null && servers.length === 0 ? (
        <p className="rounded-md border border-border px-3 py-3 text-xs text-fg-subtle">
          {t("agents.mcpEmpty")}
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {(servers ?? []).map((server) => (
            <li key={`${server.agent}:${server.name}`} className="px-3 py-2">
              <div className="flex items-center gap-2 text-sm">
                <span className="min-w-0 truncate text-fg">{server.name}</span>
                <span className="shrink-0 rounded bg-bg-inset px-1.5 py-0.5 text-[10px] text-fg-muted">
                  {AGENT_NAMES[server.agent]}
                </span>
                <span className="shrink-0 text-[10px] uppercase text-fg-subtle">
                  {server.transport}
                </span>
              </div>
              <div className="truncate font-mono text-[11px] text-fg-subtle" title={server.target}>
                {server.target}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
