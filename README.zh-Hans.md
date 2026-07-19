<div align="center">

<img src="src-tauri/icons/128x128.png" width="88" alt="TempoTerm" />

# TempoTerm

一个 AI 原生的终端工作区，把终端、代码编辑器、文件管理器、Git 与 AI 助手整合在同一个窗口，并提供完整的繁体中文支持

[English](./README.md) · [正體中文](./README.zh-Hant.md) · **简体中文**

</div>

TempoTerm 是一个用 Tauri 2 加 Rust 与 React 19 打造的桌面 app，把原生 PTY 终端、代码编辑器、文件管理器、版本控制、网页预览、笔记、SSH／SFTP 远程连接与自带密钥的 AI 助手放在一起，并提供完整的繁体中文界面与对中文友好的终端字体；也把工作整理成具名的群组，每个标签页的卡片实时追踪对应 Claude 或 Codex CLI 会话的状态，以及 Git 分支、worktree 与对应的 PR；还能把同一个 repo 的多个 worktree 并排跑，各自有独立目录与自己的 agent

<div align="center">

<img src="screenshots/hero.png" alt="TempoTerm 把终端、编辑器、文件管理器与 AI 助手放在同一个窗口" width="860" />

</div>

## 重点特色

- **AI agent 指挥中心**：每个标签页的卡片实时追踪 Claude Code 或 Codex CLI 会话的状态、Git 分支、worktree 与 PR，分割面板各自列出自己的 agent，需要批准时弹桌面通知
- **在 diff 上留评论给 agent**：对 diff 的任何一行留评论，一键打包发进正在执行的 agent 会话
- **并行 worktree**：同一个 repo 打开多个 worktree 并行，各自的目录跑各自的 agent
- **AI 对话浏览**：集中浏览 Claude Code、Codex 与 Antigravity 的所有历史对话，附活动仪表板与成本估算
- **单一窗口工作区**：终端、编辑器、文件管理器、版本控制、笔记、SSH／SFTP、网页预览与图片／PDF 预览，全部可自由分割并排
- **自带密钥的 AI 助手**：OpenAI、Anthropic、Google Gemini、Groq、DeepSeek、Ollama 与任何兼容 OpenAI 的端点，密钥加密并绑定本机
- **繁体中文一等公民**：完整繁体中文界面，加上让全角字符对齐的终端字体设置

## 功能

### AI 工作流

- 侧边栏以具名群组整理标签页；每张卡片显示可筛选的会话状态（执行中、思考中、等待输入、等待批准）、分支、worktree 与对应 PR，拆分的标签页列出每个面板自己的 agent，卡片标题自动从对话记录推导
- agent 需要批准或在后台执行完毕时弹桌面通知；启动器可直接打开 Claude Code 或 Codex CLI 并带默认参数
- 在 diff 的任何一行点行号旁的 + 留评论，一键把所有评论（按文件分组、附行号与代码）粘贴进正在执行 Claude 或 Codex 的终端面板，内容先落在输入框、由你确认发送
- 从终端菜单或 git 提交图创建 worktree，可复制 `.env` 这类本地文件、执行记住的设置命令并直接启动 agent；状态栏徽章打开管理器，列出每个 worktree 的分支、未提交改动、agent 活动与磁盘用量
- AI 对话浏览直接读取各 CLI 的本机文件（不复制进 TempoTerm），提供活动热图、model 用量、项目统计、成本估算，以及 Markdown 与 CSV 导出
- AI 助手面板自带密钥即可用，可从文件管理器附加文件当上下文，终端输出默认纳入且发送前先遮蔽敏感信息

![群组侧边栏与实时 Claude 会话卡片](screenshots/workspaces.png)

![AI 对话浏览仪表板](screenshots/ai-sessions-dashboard.png)

![AI 助手面板与 Markdown 回复](screenshots/ai-assistant.png)

### 终端与工作区

- 以原生 PTY 驱动的 xterm.js v6：终端内搜索、zsh 命令自动建议、IP 与压缩包的 hover 操作卡片，Unicode 字宽表让全角中文字保持对齐
- 任何面板都能四种方式分割：单击侧栏项目自动分割、拖文件到面板、右键菜单、拖到标签栏开新标签页
- CodeMirror 6 编辑器：AI ghost-text 补全（Tab 接受）、Markdown 编辑／并排／预览三模式、文件在磁盘上被改动时自动重新加载
- 文件树支持模糊搜索与内容 grep，和终端双向同步目录；点图片或 PDF 直接在面板内预览
- HTML 文件一键打开原生网页预览（不是 iframe，不受反嵌入规则限制），保存就会更新
- 终端与编辑器标题栏是可点击的面包屑路径；侧栏面板可拖到窗口左右任一侧停靠

| **单击自动分割**<br>单击文件管理器或笔记里的项目，直接分割进当前标签页<br>![单击自动分割](screenshots/split-click.gif) | **拖拽到面板**<br>把文件或笔记拖到任一面板，按放开位置决定分割方向<br>![拖拽到面板](screenshots/split-drag.gif) |
| --- | --- |
| **右键菜单**<br>右键选择在新标签页打开，或分割到新面板<br>![右键菜单](screenshots/split-context-menu.gif) | **拖拽到标签栏**<br>把文件、笔记或 SSH 连接拖到标签栏，直接打开新标签页<br>![拖拽到标签栏](screenshots/split-tab-drop.gif) |

### 其他

- 版本控制：按文件夹分组的暂存、提交、推送，用 AI 从 staged diff 生成 Conventional Commits 信息，提交图点任一 commit 看变更与 diff，也能让 AI 解释
- SSH：连接面板记住连接信息与密钥密码，本地端口转发，连接打开时在文件管理器用 SFTP 浏览与编辑远程文件
- 笔记：所见即所得编辑器、斜杠命令菜单、代码块可一键在终端运行
- 状态栏：实时 CPU、内存与网络流量，端口面板列出每个端口占用的程序并可直接处理
- 多窗口，各自独立的标签页、群组与对话状态
- 多套深色与浅色主题，繁体中文与英文界面可即时切换

![Git 提交图](screenshots/git-graph.png)

![主题与语言设置](screenshots/themes.png)

## 技术栈

Tauri 2、Rust、portable-pty、git2、keyring、russh、React 19、TypeScript、Vite、Zustand、Tailwind CSS v4、xterm.js v6、CodeMirror 6、TipTap、i18next

## 开发

```bash
pnpm install        # 安装前端依赖
pnpm tauri dev      # 以开发模式启动桌面 app
pnpm typecheck      # TypeScript 类型检查
pnpm build          # 构建前端
```

## 测试

```bash
pnpm test                       # 前端单元与集成测试（Vitest）
cd src-tauri && cargo test      # 后端 Rust 测试
```

## 赞助支持

如果 TempoTerm 帮你省下了时间，欢迎小额赞助，支持项目持续开发

<div align="center">

<a href="https://portaly.cc/mukiwu/support">
  <img src="https://img.shields.io/badge/%E2%9D%A4%20Support%20TempoTerm-Portaly-ff4f64?style=for-the-badge&labelColor=1a1a1a" alt="在 Portaly 上赞助 TempoTerm" height="40" />
</a>

</div>
