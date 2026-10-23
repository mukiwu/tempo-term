//! Read-only list of the MCP servers the coding agents are configured with:
//! Claude Code's user scope in `~/.claude.json` and Codex's
//! `~/.codex/config.toml`. Environment variables and headers are never read
//! out, since they routinely hold tokens.

use serde::Serialize;
use std::path::PathBuf;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServer {
    /// `claude` or `codex`.
    pub agent: String,
    pub name: String,
    /// `stdio` for a local command, otherwise the remote transport (`http`, `sse`).
    pub transport: String,
    /// The command line, or the URL of a remote server.
    pub target: String,
}

fn command_line(command: &str, args: &[String]) -> String {
    std::iter::once(command.to_string())
        .chain(args.iter().cloned())
        .collect::<Vec<_>>()
        .join(" ")
}

/// Servers in a `~/.claude.json` document's top-level `mcpServers`.
pub fn parse_claude(text: &str) -> Vec<McpServer> {
    let Ok(doc) = serde_json::from_str::<serde_json::Value>(text) else {
        return Vec::new();
    };
    let Some(servers) = doc.get("mcpServers").and_then(|v| v.as_object()) else {
        return Vec::new();
    };
    servers
        .iter()
        .map(|(name, server)| {
            let url = server.get("url").and_then(|v| v.as_str());
            let transport = server
                .get("type")
                .and_then(|v| v.as_str())
                .unwrap_or(if url.is_some() { "http" } else { "stdio" })
                .to_string();
            let target = match url {
                Some(url) => url.to_string(),
                None => {
                    let command = server.get("command").and_then(|v| v.as_str()).unwrap_or("");
                    let args: Vec<String> = server
                        .get("args")
                        .and_then(|v| v.as_array())
                        .map(|a| {
                            a.iter()
                                .filter_map(|v| v.as_str().map(String::from))
                                .collect()
                        })
                        .unwrap_or_default();
                    command_line(command, &args)
                }
            };
            McpServer {
                agent: "claude".to_string(),
                name: name.clone(),
                transport,
                target,
            }
        })
        .collect()
}

/// Servers in a Codex `config.toml`'s `[mcp_servers.<name>]` tables.
pub fn parse_codex(text: &str) -> Vec<McpServer> {
    let Ok(doc) = text.parse::<toml_edit::DocumentMut>() else {
        return Vec::new();
    };
    let Some(servers) = doc.get("mcp_servers").and_then(|v| v.as_table_like()) else {
        return Vec::new();
    };
    servers
        .iter()
        .filter_map(|(name, item)| {
            let server = item.as_table_like()?;
            let url = server.get("url").and_then(|v| v.as_str());
            let (transport, target) = match url {
                Some(url) => ("http".to_string(), url.to_string()),
                None => {
                    let command = server.get("command").and_then(|v| v.as_str()).unwrap_or("");
                    let args: Vec<String> = server
                        .get("args")
                        .and_then(|v| v.as_array())
                        .map(|a| {
                            a.iter()
                                .filter_map(|v| v.as_str().map(String::from))
                                .collect()
                        })
                        .unwrap_or_default();
                    ("stdio".to_string(), command_line(command, &args))
                }
            };
            Some(McpServer {
                agent: "codex".to_string(),
                name: name.to_string(),
                transport,
                target,
            })
        })
        .collect()
}

fn home() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

/// Every configured MCP server, Claude Code's first; a missing or unreadable
/// config simply contributes none.
#[tauri::command]
pub async fn mcp_servers_list() -> Result<Vec<McpServer>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let Some(home) = home() else {
            return Vec::new();
        };
        let codex_home = std::env::var_os("CODEX_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join(".codex"));
        let read = |path: PathBuf| std::fs::read_to_string(path).unwrap_or_default();
        let mut servers = parse_claude(&read(home.join(".claude.json")));
        servers.extend(parse_codex(&read(codex_home.join("config.toml"))));
        servers
    })
    .await
    .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_claude_servers_without_their_environment() {
        let text = r#"{"mcpServers": {
            "docs": {"type": "http", "url": "https://example.com/mcp"},
            "local": {"command": "npx", "args": ["-y", "pkg"], "env": {"TOKEN": "secret"}}
        }}"#;
        let servers = parse_claude(text);
        assert_eq!(servers.len(), 2);
        let local = servers.iter().find(|s| s.name == "local").unwrap();
        assert_eq!(local.transport, "stdio");
        assert_eq!(local.target, "npx -y pkg");
        assert!(!format!("{servers:?}").contains("secret"));
        assert_eq!(
            servers.iter().find(|s| s.name == "docs").unwrap().target,
            "https://example.com/mcp"
        );
    }

    #[test]
    fn reads_codex_servers() {
        let text = r#"
model = "x"
[mcp_servers.repl]
command = "node"
args = ["repl.js"]
[mcp_servers.repl.env]
KEY = "secret"
[mcp_servers.remote]
url = "https://example.com/mcp"
"#;
        let servers = parse_codex(text);
        assert_eq!(
            servers,
            vec![
                McpServer {
                    agent: "codex".into(),
                    name: "repl".into(),
                    transport: "stdio".into(),
                    target: "node repl.js".into(),
                },
                McpServer {
                    agent: "codex".into(),
                    name: "remote".into(),
                    transport: "http".into(),
                    target: "https://example.com/mcp".into(),
                },
            ]
        );
    }

    #[test]
    fn tolerates_missing_or_broken_configs() {
        assert!(parse_claude("").is_empty());
        assert!(parse_claude("{}").is_empty());
        assert!(parse_codex("not = [toml").is_empty());
    }
}
