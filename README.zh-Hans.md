<div align="center">

<img src="src-tauri/icons/128x128.png" width="88" alt="TempoTerm" />

# TempoTerm

一个 AI 原生的终端工作区，把终端、代码编辑器、文件管理器、Git 与 AI 助手整合在同一个窗口，并提供完整的繁体中文支持

[English](./README.md) · [正體中文](./README.zh-Hant.md) · **简体中文**

</div>

TempoTerm 是一个用 Tauri 2 加 Rust 与 React 19 打造的桌面 app，把原生 PTY 终端、代码编辑器、文件管理器、版本控制、网页预览、笔记、SSH／SFTP 远程连接与自带密钥的 AI 助手放在一起，并提供完整的繁体中文界面与对中文友好的终端字体；也把工作整理成具名的群组，每个标签页的卡片实时追踪对应 Claude 或 Codex CLI 会话的状态，以及 Git 分支、worktree 与对应的 PR

<div align="center">

<img src="screenshots/hero.png" alt="TempoTerm 把终端、编辑器、文件管理器与 AI 助手放在同一个窗口" width="860" />

</div>

## 功能

### 群组与 Agent 会话

- 在侧边栏用具名群组整理工作，可从列表重命名与删除，app 一打开就停在这个面板
- 每个标签页的卡片显示 Git 分支与 worktree、实时的 Claude 或 Codex CLI 会话状态徽章（执行中、思考中、等待输入、等待批准，可按状态筛选），以及对应的 PR 状态
- 一个标签页拆分成多个面板时，卡片会分别列出每个面板自己的 agent 与状态
- 卡片标题会自动从会话的对话记录推导出来
- 会话状态来自一支可开关的 Claude Code 或 Codex hook；可在设置里选卡片显示哪些区块，以及 PR 数据的来源
- 被追踪的 agent 需要批准或执行完毕时，窗口没有聚焦就会弹出桌面通知
- 可打开多个窗口，各自拥有独立的标签页、群组与对话状态；关掉窗口只会收掉那个窗口自己的终端
- 启动器可以直接打开 Claude Code 或 Codex CLI，并可设置默认带入的参数

![群组侧边栏与实时 Claude 会话卡片](screenshots/workspaces.png)

### 终端

- 以原生 PTY（portable-pty）驱动的 xterm.js v6，标签页可以指定类型
- 采用 xterm 的 DOM 渲染，刻意不用 WebGL，因为 WebGL 在 WKWebView 里渲染字体不稳定
- 自由分割布局，同一组分割能混合不同类型，例如终端与代码编辑器并排，分割线可以拖拽调整比例
- 完整的键盘快捷键、zsh 命令自动建议、终端内搜索，以及 IP、host:port、压缩包的 hover 操作卡片
- 大量输出保护（批量写入加过载提示），并可自定义 shell 路径
- 标签页可以拖拽重新排序，或右键重命名、关闭，标签栏会以徽章显示每个群组的标签数
- 在输出里 Cmd 或 Ctrl 点击文件路径，就会在旁边的分割面板打开，附 hover 提示，连被换行折断的路径也能识别
- 可选择在下次启动时，把每个终端的上次输出以只读方式还原
- 对齐其他终端的标准编辑快捷键，方便迁移过来：Shift+Enter、按单词与行移动、删到行首或行尾、复制粘贴
- 采用 Unicode 11 字宽表，全角中文字保持对齐

### 分割面板

任何标签页里的任何面板都能用四种方式分割：单击侧边栏项目自动分割、把文件或笔记拖到面板上、用右键菜单、或拖到标签栏开新标签页

| **单击自动分割**<br>单击文件管理器或笔记里的项目，直接分割进当前标签页<br>![单击自动分割](screenshots/split-click.gif) | **拖拽到面板**<br>把文件或笔记拖到任一面板，按放开位置决定分割方向<br>![拖拽到面板](screenshots/split-drag.gif) |
| --- | --- |
| **右键菜单**<br>右键选择在新标签页打开，或分割到新面板<br>![右键菜单](screenshots/split-context-menu.gif) | **拖拽到标签栏**<br>把文件、笔记或 SSH 连接拖到标签栏，直接打开新标签页<br>![拖拽到标签栏](screenshots/split-tab-drop.gif) |

### 编辑器

- CodeMirror 6 加语法高亮
- AI ghost-text 行内补全，按 Tab 接受
- 跟随 app 主题切换明暗
- Markdown 文件可在编辑、并排、预览之间切换
- 标签页有未保存的修改时，关闭会弹出确认；标签页上有个小圆点标记未保存
- 文件在磁盘上被改动时（例如被 AI 或其他工具改动），没有未保存的修改就自动重新加载，有的话会提示选择版本，另外也有手动刷新按钮
- 工具栏可一键预览 HTML 文件（详见下方网页预览）

### 文件管理器

- 文件树，支持模糊搜索与内容 grep
- 与终端目录双向同步：任一边 cd，另一边跟着切
- 右键菜单：打开、在 Finder 中显示、新建文件或文件夹、复制路径、附加给 AI 助手、删除到回收站
- 把文件或文件夹拖到任一面板，按面板类型有对应行为

### SSH 与远程文件

- 从独立的连接面板连上 SSH 主机，连接信息与密钥密码可以记住
- 支持本地端口转发（-L）
- 连接打开时，可以在文件管理器用 SFTP 浏览、上传、下载、直接编辑远程文件

### 版本控制

- 暂存、取消暂存、提交与推送，变更按文件夹分组，可整个文件夹一次 stage
- 用 AI 从 staged diff 生成 Conventional Commits 信息
- 提交图（DAG）与分支、tag 操作；点任一 commit 看变更文件与 diff
- 让 AI 用白话、好扫读的方式解释这个 commit 的 diff
- 工具栏支持远程分支、stash、fetch 与关键字搜索

![Git 提交图](screenshots/git-graph.png)

### 网页预览

- 用原生子 webview（不是 iframe）预览一个网址或拖进来的本地文件，不会被 X-Frame-Options 这类反嵌入规则挡住
- 从编辑器工具栏一键打开文件的实时预览，保存就会更新
- 标签页标题跟随网页实际的 `<title>`
- 前进／后退按钮，也可用 ⌘[ 与 ⌘] 切换
- ⌘L 直接跳到地址栏

### 笔记

- 所见即所得编辑器（TipTap），内置斜杠命令菜单
- 代码块支持语法高亮、复制与在终端运行
- 全局文件夹，重启后依然保留

### AI 助手

- 自带密钥：OpenAI、Anthropic、Google Gemini、Groq、DeepSeek、Ollama，以及任何兼容 OpenAI 的端点
- 服务商密钥与 GitHub token 存在一个与本机绑定的加密文件里，不会回传到 app 窗口
- 回复以 Markdown 呈现，可从文件管理器把文件附加为上下文
- 默认会把终端输出纳入上下文，发送前会先遮蔽敏感信息

![AI 助手面板与 Markdown 回复](screenshots/ai-assistant.png)

### AI 对话浏览

- 在同一处浏览 Claude Code、Codex 与 Antigravity CLI 的所有历史对话，直接读取本机的 session 文件，因此不会复制到 TempoTerm 自己的数据库
- 仪表板汇总你的记录：全周期活动热图、今日时段分布、model 使用量饼图、各 agent 的本周统计、热门对话，以及以美元估算的成本
- 从任一对话的项目名进入项目视图，查看该项目的累计统计、最近对话，并一键在该目录打开新终端
- 在对话正文下方直接看到本次对话期间该项目产生的本机 git commit
- 按 agent 或 model 筛选列表；置顶、删除到回收站、把正文导出为 Markdown，或把筛选后的列表导出为 CSV

![AI 对话浏览仪表板](screenshots/ai-sessions-dashboard.png)

### 状态栏

- 实时显示 CPU、内存与网络上下行流量
- 端口监控：列出监听中的端口、占用的程序与资源使用情况，可直接打开浏览器、打开一个终端到该程序，或结束程序

### 主题与语言

- 多套深色与浅色主题，应用到整个窗口
- 繁体中文与英文双语界面，可即时切换
- 对中文友好的终端字体设置，并可自定义 icon 字体

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
