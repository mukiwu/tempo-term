<div align="center">

<img src="src-tauri/icons/128x128.png" width="88" alt="TempoTerm" />

# TempoTerm

一个 AI 原生的终端工作区，把终端、代码编辑器、文件管理器、Git 与 AI 助手整合在同一个窗口，并提供完整的繁体中文支持

[English](./README.md) · [正體中文](./README.zh-Hant.md) · **简体中文**

</div>

TempoTerm 是一个用 Tauri 2 加 Rust 与 React 19 打造的桌面 app，把原生 PTY 终端、代码编辑器、文件管理器、版本控制、网页预览、笔记与自带密钥的 AI 助手放在一起，并提供完整的繁体中文界面与对中文友好的终端字体

## 功能

### 终端

- 以原生 PTY（portable-pty）驱动的 xterm.js v6，标签页可以指定类型
- 自由分割布局，同一组分割能混合不同类型，例如终端与代码编辑器并排，分割线可以拖拽调整比例
- 在输出里 Alt 或 Cmd 点击文件路径，就会在旁边的分割面板打开
- 对齐其他终端的标准编辑快捷键，方便迁移过来：Shift+Enter、按单词与行移动、删到行首或行尾、复制粘贴
- 采用 Unicode 11 字宽表，全角中文字保持对齐

### 编辑器

- CodeMirror 6 加语法高亮
- 跟随 app 主题切换明暗
- Markdown 文件可在编辑、并排、预览之间切换

### 文件管理器

- 文件树，支持模糊搜索与内容 grep
- 右键菜单：打开、在 Finder 中显示、新建文件或文件夹、复制路径、附加给 AI 助手、删除到回收站
- 把文件或文件夹拖到任一面板，按面板类型有对应行为

### 版本控制

- 状态、暂存、取消暂存、提交与推送
- 带提交图的 Git 历史

### 网页预览

- 内嵌预览一个网址，或拖进来的本地文件

### 笔记

- 所见即所得编辑器（TipTap），内置斜杠命令菜单
- 代码块支持语法高亮、复制与在终端运行
- 全局文件夹，重启后依然保留

### AI 助手

- 自带密钥：OpenAI、Anthropic、Google Gemini、Groq、DeepSeek、Ollama，以及任何兼容 OpenAI 的端点
- 密钥存在系统 keychain，不会回传到 app 窗口
- 回复以 Markdown 呈现，可从文件管理器把文件附加为上下文

### 主题与语言

- 多套深色与浅色主题，应用到整个窗口
- 繁体中文与英文双语界面，可即时切换
- 对中文友好的终端字体设置

## 技术栈

Tauri 2、Rust、portable-pty、git2、keyring、React 19、TypeScript、Vite、Zustand、Tailwind CSS v4、xterm.js v6、CodeMirror 6、TipTap、i18next

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
