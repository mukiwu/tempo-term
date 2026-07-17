<div align="center">

<img src="src-tauri/icons/128x128.png" width="88" alt="TempoTerm" />

# TempoTerm

<img src="screenshots/tempo-term-feature-flow-en.png" alt="TempoTerm feature flow diagram" width="860" />

An AI-native terminal workspace that brings the terminal, code editor, file explorer, Git and an AI assistant into a single window, with first-class Traditional Chinese support.

**English** · [正體中文](./README.zh-Hant.md) · [简体中文](./README.zh-Hans.md)

</div>

TempoTerm is a desktop app built on Tauri 2 + Rust and React 19. It pairs a native PTY terminal with a code editor, file explorer, source control, web preview, notes, SSH/SFTP remote access and a bring-your-own-key AI assistant, and ships a full Traditional Chinese interface with CJK-friendly terminal fonts. It organizes your work into named groups, and each tab's card tracks its Claude Code or Codex CLI session status live, alongside the Git branch, worktree and matching pull request. It can also run several worktrees of one repo in parallel, each in its own directory with its own agent.

<div align="center">

<img src="screenshots/hero.png" alt="TempoTerm workspace: terminal, editor, file explorer and AI assistant in one window" width="860" />

</div>

## Features

### Groups & agent sessions

- Organize work into named groups in a sidebar, with rename and delete from the list; the app opens on this panel
- Each tab's card shows the Git branch and worktree, a live status badge for its Claude Code or Codex CLI session (working, thinking, waiting for input, waiting for approval) you can filter by, and the matching pull request status
- A tab split into several panes lists each pane's own agent and status on the card
- Card titles are derived automatically from the session transcript
- Session status comes from a Claude Code or Codex hook you can toggle; choose which blocks a card shows and where PR data comes from in settings
- A desktop notification fires when a tracked agent needs approval or finishes and the window isn't focused
- Open additional windows, each with its own tabs, groups and chat state; closing a window only tears down its own terminals
- The launcher can start Claude Code or Codex CLI directly, with a configurable default set of arguments

![Groups sidebar with live Claude session cards](screenshots/workspaces.png)

### Layout

- Sidebar panels (file explorer, source control, notes, AI assistant, SSH connections, ports) dock as icon strips on either side of the window; drag an icon across to move a panel to the other side
- Every pane in a tab shares the same slim header strip, so close buttons no longer float over content
- Terminal and editor headers show the path as a breadcrumb; click a segment to browse that folder and cd the terminal or swap the file in place, SSH panes included

### Terminal

- xterm.js v6 over a native PTY (portable-pty), with typed tabs
- Renders through xterm's DOM renderer, chosen deliberately over WebGL, which renders glyphs unreliably inside a WKWebView
- Free split layout: panels can mix types, for example a terminal next to a file editor, with draggable dividers to resize
- Full keyboard shortcut set, zsh command autosuggestions, in-terminal search, and hover action cards for IPs, host:port pairs and archive files
- Large-output protection with a batched writer and an overload notice, plus an optional custom shell path override
- Drag to reorder tabs, or right-click a tab to rename or close it, with a per-group tab count badge in the tab bar
- Cmd or Ctrl click a file path in the output to open it in a split pane, with a hover hint and support for paths broken across wrapped lines
- Optionally restore each terminal's previous output as read-only scrollback on the next launch
- Standard editing shortcuts that carry over from other terminals: Shift+Enter, word and line navigation, delete to line start/end, copy and paste
- Unicode 11 width tables so full-width CJK glyphs stay aligned

### Split panes

Any pane in any tab can be split four ways: click a sidebar item to auto-split, drag a file or note onto a pane, use the right-click menu, or drag onto the tab bar for a brand-new tab

| **Click to split**<br>Click a file or note in the explorer or notes sidebar; it splits straight into the active tab<br>![Click to split](screenshots/split-click.gif) | **Drag onto a pane**<br>Drag a file or note onto any pane; where you drop it decides the split direction<br>![Drag onto a pane](screenshots/split-drag.gif) |
| --- | --- |
| **Right-click menu**<br>Open in a new tab, or split into a pane, straight from the right-click menu<br>![Right-click menu](screenshots/split-context-menu.gif) | **Drag onto the tab bar**<br>Drop a file, note or SSH connection onto the tab bar to open a brand-new tab<br>![Drag onto the tab bar](screenshots/split-tab-drop.gif) |

### Editor

- CodeMirror 6 with syntax highlighting
- AI ghost-text inline completion; press Tab to accept
- Follows the app theme's light or dark appearance
- Markdown files toggle between edit, split and preview
- Closing a tab with unsaved changes prompts for confirmation; a dot on the tab marks unsaved edits
- Reloads automatically when the file changes on disk (for example, edited by the AI or another tool) if there are no unsaved changes; otherwise offers to pick a version, plus a manual reload button
- Preview an HTML file from the toolbar with one click (see Web preview below)

### File explorer

- File tree with fuzzy find and content grep
- Two-way directory sync with the terminal: cd on either side moves the other
- Right-click context menu: open, reveal in Finder, new file or folder, copy path, attach to the AI agent, delete to trash
- Drag a file or folder onto any pane, with behavior per pane type

### SSH & remote files

- Connect to SSH hosts from a dedicated connections panel; connection details and key passphrases can be remembered
- Local port forwarding (-L)
- Browse, upload, download and edit remote files over SFTP in the file explorer while a connection is open

### Source control

- Stage, unstage, commit and push, with changes grouped by folder and folder-level staging
- Generate a Conventional Commits message from the staged diff with AI
- Commit graph (DAG) with branch and tag actions; click any commit to see its changed files and diff
- Ask AI to explain a commit's diff in plain, scannable language
- Toolbar for remote branches, stashes, fetch and keyword search

![Git commit graph](screenshots/git-graph.png)

### Parallel worktrees

- Run several worktrees of one repo side by side, each in its own directory with its own agent
- Create a worktree from the terminal's ⋯ menu or from a branch's right-click menu in the commit graph
- Creation can copy local files such as `.env`, run a setup command (remembered per repo) and launch Claude Code or Codex CLI right away
- A status bar badge counts your worktrees and opens the manager, which lists each one's branch, uncommitted changes, agent activity and disk usage, and removes ones you're done with
- Open a worktree from the manager in a new tab or split beside the current pane; if it's already open, TempoTerm jumps to it instead

### Web preview

- Native child webview (not an iframe) for a URL or a dropped local file, so it isn't blocked by embedding restrictions like X-Frame-Options
- Open a file's live preview from the editor toolbar with one click; it updates on save
- Tab title follows the page's real `<title>`
- Back/forward buttons and ⌘[ / ⌘] history navigation
- ⌘L jumps straight to the address bar

### Notes

- WYSIWYG editor (TipTap) with a slash command menu
- Code blocks with syntax highlighting, copy and run-in-terminal
- Global folders that persist across restarts

### AI assistant

- Bring your own key: OpenAI, Anthropic, Google Gemini, Groq, DeepSeek, Ollama and any OpenAI-compatible endpoint
- Provider keys and your GitHub token are stored in an encrypted file bound to this machine, and are never returned to the webview
- Replies render as Markdown; attach files from the explorer as context
- Terminal output is included as context by default, with secrets redacted before it's sent

![AI assistant panel with a Markdown reply](screenshots/ai-assistant.png)

### AI Sessions

- Browse every past AI CLI conversation from Claude Code, Codex, and Antigravity CLI in one place. They are read directly from their local session files, so nothing is ever copied into TempoTerm's own storage
- A dashboard summarizes your history: a full-range activity heatmap, today's hour-of-day distribution, model usage as a share donut, a per-agent weekly breakdown, top conversations, and an estimated cost in USD
- Open a project view from any conversation's project name to see its aggregate stats, recent sessions, and a one-click terminal rooted at that project
- See the local git commits made during a session, right below its transcript
- Filter the list by agent or model; pin, delete to trash, export a transcript to Markdown, or export the filtered list to CSV

![AI Sessions dashboard](screenshots/ai-sessions-dashboard.png)

### Status bar

- Live CPU, memory and network throughput
- Ports: a badge counts listening ports and opens the Ports panel, which lists each port's owning process and resource usage; open one in the browser, open a terminal at its process, or end the process
- Worktrees: a badge counts your worktrees and opens the manager (see Parallel worktrees above)

### Themes and languages

- Several dark and light themes, applied across the whole window
- Full English and Traditional Chinese UI, switchable on the fly
- CJK-friendly terminal font settings, with a configurable icon font fallback

![Theme and language settings](screenshots/themes.png)

## Tech stack

Tauri 2, Rust, portable-pty, git2, keyring, russh, React 19, TypeScript, Vite, Zustand, Tailwind CSS v4, xterm.js v6, CodeMirror 6, TipTap, i18next.

## Development

```bash
pnpm install        # install frontend dependencies
pnpm tauri dev      # run the desktop app in dev mode
pnpm typecheck      # TypeScript type check
pnpm build          # build the frontend
```

## Testing

```bash
pnpm test                       # frontend unit and integration tests (Vitest)
cd src-tauri && cargo test      # backend Rust tests
```

## License

TempoTerm is licensed under the [Apache License 2.0](LICENSE).
The TempoTerm name and logo are not licensed for use by derivative works (see [NOTICE](NOTICE)).

## Support

If TempoTerm saves you time, you can support its continued development. Every contribution helps keep the project moving.

<div align="center">

<a href="https://portaly.cc/mukiwu/support">
  <img src="https://img.shields.io/badge/%E2%9D%A4%20Support%20TempoTerm-Portaly-ff4f64?style=for-the-badge&labelColor=1a1a1a" alt="Support TempoTerm on Portaly" height="40" />
</a>

</div>
