# 跨平台統一右鍵選單 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 macOS 與 Linux 的文字欄位、終端機、空白區右鍵行為統一成與 Windows 相同的自訂選單，終端機選單擴成五項

**Architecture:** 拆掉 #184 留下的兩個 IS_WINDOWS 閘門讓現有跨平台程式碼全平台生效，終端機選單抽成純函式 builder（仿 inputMenuSpecs 模式）方便測試，空白區壓制加 dev build 例外保住 Inspect

**Tech Stack:** React + TypeScript、Vitest + jsdom、xterm.js、i18next

**Spec:** `docs/superpowers/specs/2026-07-11-unified-context-menu-design.md`

## Global Constraints

- 語言慣例：程式碼註解、commit message 一律英文
- Tiptap（ProseMirror）與 CodeMirror（contentEditable）兩平台維持原生選單，不得動到 isRichEditable 分支
- 不新增任何套件依賴
- 每個 task 結束時 `npm run typecheck` 與相關測試檔必須綠
- commit 不推 master，全部落在 feat/unified-context-menu 分支

---

### Task 1: InputContextMenu 全平台化與 dev 例外

**Files:**
- Modify: `src/components/inputMenuItems.ts`（加 isDevBuild helper）
- Modify: `src/components/InputContextMenu.tsx:53-87`（拆閘門、dev 例外、更新註解）
- Test: `src/components/InputContextMenu.test.tsx`（新檔）

**Interfaces:**
- Produces: `isDevBuild(): boolean`（inputMenuItems.ts 匯出，Task 1 測試會 mock 它）
- InputContextMenu 行為契約：文字欄位右鍵出自訂選單（全平台）、contentEditable 放行原生、其餘區域 prod 壓掉 dev 放行

- [ ] **Step 1: 寫失敗測試**

新檔 `src/components/InputContextMenu.test.tsx`：

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { InputContextMenu } from "@/components/InputContextMenu";

// Menu labels come from i18next; follow the same i18n bootstrap convention the
// existing component tests use (check how SettingsView.test.tsx or
// App.menu-events.test.tsx get real translations and mirror it — if they rely
// on an i18n side-effect import, add the same import here). If the suite runs
// with untranslated keys, assert on the key (e.g. "actions.paste") instead.

// Non-Windows platform: the menu must now work here too (the whole point of
// the unification), so pin IS_WINDOWS to false.
vi.mock("@/lib/platform", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/platform")>();
  return { ...actual, IS_WINDOWS: false };
});

// The fast Tauri clipboard path is not available in jsdom.
vi.mock("@/modules/terminal/lib/terminalClipboard", () => ({
  terminalClipboardText: () => Promise.resolve(""),
}));

// isDevBuild is flipped per test; the real impl reads import.meta.env.DEV
// which is always true under Vitest and would mask the prod branch.
const devMock = vi.hoisted(() => ({ dev: false }));
vi.mock("@/components/inputMenuItems", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/inputMenuItems")>();
  return { ...actual, isDevBuild: () => devMock.dev };
});

function rightClick(target: Element): boolean {
  let notPrevented = true;
  act(() => {
    notPrevented = target.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 40, clientY: 40 }),
    );
  });
  return notPrevented;
}

describe("InputContextMenu on non-Windows platforms", () => {
  beforeEach(() => {
    devMock.dev = false;
    document.body.innerHTML = "";
  });

  it("opens the custom menu on a plain text input", () => {
    render(<InputContextMenu />);
    const input = document.createElement("input");
    input.type = "text";
    input.value = "hello";
    document.body.appendChild(input);

    const notPrevented = rightClick(input);

    expect(notPrevented).toBe(false);
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Paste" })).toBeInTheDocument();
  });

  it("keeps the native menu on contentEditable (Tiptap/CodeMirror)", () => {
    render(<InputContextMenu />);
    const editor = document.createElement("div");
    Object.defineProperty(editor, "isContentEditable", { value: true });
    document.body.appendChild(editor);

    expect(rightClick(editor)).toBe(true);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("suppresses the browser menu on blank areas in prod builds", () => {
    render(<InputContextMenu />);
    const blank = document.createElement("div");
    document.body.appendChild(blank);

    expect(rightClick(blank)).toBe(false);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("keeps the native menu on blank areas in dev builds (Inspect stays reachable)", () => {
    devMock.dev = true;
    render(<InputContextMenu />);
    const blank = document.createElement("div");
    document.body.appendChild(blank);

    expect(rightClick(blank)).toBe(true);
  });

  it("defers to a menu another component already showed", () => {
    render(<InputContextMenu />);
    const host = document.createElement("div");
    host.addEventListener("contextmenu", (e) => e.preventDefault());
    document.body.appendChild(host);

    rightClick(host);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/components/InputContextMenu.test.tsx`
Expected: FAIL，第一個測試 menu 不出現（effect 被 IS_WINDOWS 擋掉）、isDevBuild 不存在造成 mock factory 或 import 錯誤

- [ ] **Step 3: 最小實作**

`src/components/inputMenuItems.ts` 檔尾加：

```ts
/**
 * Whether this is a dev build. Blank-area context-menu suppression is skipped
 * in dev so right-click → Inspect Element stays reachable while debugging;
 * text-field and terminal custom menus still apply so the feature itself is
 * testable in dev. A function (not a constant) so tests can stub it.
 */
export function isDevBuild(): boolean {
  return import.meta.env.DEV;
}
```

`src/components/InputContextMenu.tsx` 兩處修改。effect 開頭與註解：

```tsx
  useEffect(() => {
    function onContextMenu(e: MouseEvent) {
```

（刪掉 `if (!IS_WINDOWS) { return; }` 三行，並把 `import { IS_WINDOWS } from "@/lib/platform";` 移除，`isDevBuild` 加進既有的 inputMenuItems import 清單）

blanket 壓制分支：

```tsx
      // Everywhere else: kill the browser menu (Reload / Save as / Inspect …).
      // Dev builds keep it so right-click → Inspect Element still works.
      if (isDevBuild()) {
        return;
      }
      e.preventDefault();
```

元件 JSDoc 的 Windows-only 描述同步改為全平台描述（保留 WebView2 慢貼上的歷史脈絡一句即可）

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run src/components/InputContextMenu.test.tsx src/components/inputMenuItems.test.ts`
Expected: PASS 全綠

- [ ] **Step 5: typecheck 與 commit**

```bash
npm run typecheck
git add src/components/inputMenuItems.ts src/components/InputContextMenu.tsx src/components/InputContextMenu.test.tsx
git commit -m "feat(context-menu): enable the input context menu on all platforms

The IS_WINDOWS gate from #184 is removed: macOS and Linux now get the same
app-styled cut/copy/paste menu on plain text fields and the same blanket
suppression of the browser menu elsewhere. Dev builds keep the native menu
on blank areas so Inspect Element stays reachable."
```

---

### Task 2: 終端機統一選單五項

**Files:**
- Create: `src/modules/terminal/lib/terminalMenuItems.ts`
- Test: `src/modules/terminal/lib/terminalMenuItems.test.ts`（新檔）
- Modify: `src/modules/terminal/TerminalView.tsx:1482-1533`（拆閘門、改用 builder、五項接線）
- Modify: `src/i18n/locales/en/common.json:5-6` 附近、`src/i18n/locales/zh-Hant/common.json` 同位置

**Interfaces:**
- Consumes: 無（獨立於 Task 1）
- Produces: `terminalMenuSpecs(ctx: TerminalMenuContext): TerminalMenuItemSpec[]`，型別 `TerminalMenuAction = "copy" | "paste" | "selectAll" | "clear" | "search"`、`TerminalMenuContext = { hasSelection: boolean }`、`TerminalMenuItemSpec = { action: TerminalMenuAction; enabled: boolean; group: number }`

- [ ] **Step 1: 寫失敗測試**

新檔 `src/modules/terminal/lib/terminalMenuItems.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import { terminalMenuSpecs } from "./terminalMenuItems";

describe("terminalMenuSpecs", () => {
  it("lists the five actions in stable order with edit and view groups", () => {
    const specs = terminalMenuSpecs({ hasSelection: true });
    expect(specs.map((s) => s.action)).toEqual(["copy", "paste", "selectAll", "clear", "search"]);
    expect(specs.map((s) => s.group)).toEqual([0, 0, 0, 1, 1]);
  });

  it("greys copy out without a selection instead of hiding it", () => {
    const withSel = terminalMenuSpecs({ hasSelection: true });
    expect(withSel.find((s) => s.action === "copy")?.enabled).toBe(true);

    const withoutSel = terminalMenuSpecs({ hasSelection: false });
    expect(withoutSel.find((s) => s.action === "copy")?.enabled).toBe(false);
    expect(withoutSel.map((s) => s.action)).toContain("copy");
  });

  it("keeps paste, select-all, clear and search always enabled", () => {
    for (const spec of terminalMenuSpecs({ hasSelection: false })) {
      if (spec.action !== "copy") {
        expect(spec.enabled).toBe(true);
      }
    }
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/modules/terminal/lib/terminalMenuItems.test.ts`
Expected: FAIL，module not found

- [ ] **Step 3: 最小實作 builder**

新檔 `src/modules/terminal/lib/terminalMenuItems.ts`：

```ts
/**
 * Pure spec builder for the terminal's context menu, mirroring the
 * inputMenuSpecs pattern: the component maps specs to ContextMenu items and
 * wires the handlers. Copy is greyed (not hidden) without a selection so the
 * menu keeps a stable shape the way native menus do.
 */

export type TerminalMenuAction = "copy" | "paste" | "selectAll" | "clear" | "search";

export interface TerminalMenuContext {
  hasSelection: boolean;
}

export interface TerminalMenuItemSpec {
  action: TerminalMenuAction;
  enabled: boolean;
  /** Group index; ContextMenu draws a divider between consecutive groups. */
  group: number;
}

export function terminalMenuSpecs(ctx: TerminalMenuContext): TerminalMenuItemSpec[] {
  return [
    { action: "copy", enabled: ctx.hasSelection, group: 0 },
    { action: "paste", enabled: true, group: 0 },
    { action: "selectAll", enabled: true, group: 0 },
    { action: "clear", enabled: true, group: 1 },
    { action: "search", enabled: true, group: 1 },
  ];
}
```

Run: `npx vitest run src/modules/terminal/lib/terminalMenuItems.test.ts`
Expected: PASS

- [ ] **Step 4: TerminalView 接線**

`src/modules/terminal/TerminalView.tsx` 三處：

onContextMenu（約 1482 行）拆閘門並更新註解：

```tsx
      onContextMenu={(event) => {
        // All platforms get the app menu (unified in the cross-platform
        // context-menu work; Windows started it in #184 because WebView2's
        // native paste is ~5s). Backed by the same fast clipboard path as
        // the paste keybinding.
        event.preventDefault();
        setContextMenu({
          x: event.clientX,
          y: event.clientY,
          hasSelection: handleRef.current?.term.hasSelection() ?? false,
        });
      }}
```

選單渲染（約 1499 行起）改為 builder 驅動。先在檔頭 import 區加：

```tsx
import { terminalMenuSpecs, type TerminalMenuAction } from "./lib/terminalMenuItems";
import { TextSelect, Eraser, Search } from "lucide-react";
```

（Copy 與 ClipboardPaste 已在既有 import 裡，把新 icon 併進同一行 lucide-react import）

```tsx
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          items={terminalMenuSpecs({ hasSelection: contextMenu.hasSelection }).map((spec) => {
            const icons = {
              copy: Copy,
              paste: ClipboardPaste,
              selectAll: TextSelect,
              clear: Eraser,
              search: Search,
            } satisfies Record<TerminalMenuAction, ComponentType<LucideProps>>;
            // Literal t() calls per key — a dynamic t(labels[action]) can fail
            // typecheck if the project ever adopts typed i18next keys.
            const labels: Record<TerminalMenuAction, string> = {
              copy: t("terminalCopy"),
              paste: t("terminalPaste"),
              selectAll: t("terminalSelectAll"),
              clear: t("terminalClear"),
              search: t("terminalSearch"),
            };
            const actions: Record<TerminalMenuAction, () => void> = {
              copy: () => {
                const term = handleRef.current?.term;
                if (term?.hasSelection()) {
                  void navigator.clipboard.writeText(term.getSelection());
                }
              },
              // "cmd" so an empty clipboard is a no-op; "ctrl" would inject the
              // raw paste control byte, which a menu paste should never do.
              paste: () => {
                pasteRef.current?.("cmd");
                handleRef.current?.term.focus();
              },
              selectAll: () => handleRef.current?.term.selectAll(),
              clear: () => handleRef.current?.term.clear(),
              search: () => setSearchOpen(true),
            };
            return {
              id: spec.action,
              label: labels[spec.action],
              icon: icons[spec.action],
              disabled: !spec.enabled,
              group: spec.group,
              onSelect: actions[spec.action],
            } satisfies ContextMenuItem;
          })}
        />
      )}
```

若 `ComponentType`／`LucideProps` 尚未 import，從 react 與 lucide-react 補 type import。若既有程式已有 `openSearchBox()` helper（約 531 行 `setSearchOpen(true)` 的包裝），search 動作改呼叫該 helper 保持單一入口

i18n，`src/i18n/locales/en/common.json` 在 terminalPaste 旁加：

```json
  "terminalSelectAll": "Select All",
  "terminalClear": "Clear",
  "terminalSearch": "Search"
```

`src/i18n/locales/zh-Hant/common.json` 同位置：

```json
  "terminalSelectAll": "全選",
  "terminalClear": "清空畫面",
  "terminalSearch": "搜尋"
```

- [ ] **Step 5: 跑測試、typecheck、commit**

Run: `npx vitest run src/modules/terminal/ && npm run typecheck`
Expected: PASS 全綠、typecheck 乾淨

```bash
git add src/modules/terminal/lib/terminalMenuItems.ts src/modules/terminal/lib/terminalMenuItems.test.ts src/modules/terminal/TerminalView.tsx src/i18n/locales/en/common.json src/i18n/locales/zh-Hant/common.json
git commit -m "feat(terminal): unified five-item context menu on all platforms

The terminal context menu (Windows-only since #184) now shows on macOS and
Linux too, and grows from copy/paste to copy, paste, select-all, clear and
search. Items come from a pure spec builder mirroring inputMenuSpecs; copy is
greyed without a selection instead of hidden."
```

---

### Task 3: SourceControlView 壓制器退役與全庫回歸

**Files:**
- Modify: `src/modules/source-control/SourceControlView.tsx:637-647`
- Test: 既有 `src/modules/source-control/SourceControlView.test.tsx`（如有壓制器相關斷言則調整）

**Interfaces:**
- Consumes: Task 1 的全域 blanket 壓制（此 task 移除的區域壓制器由它接手）
- Produces: 無新介面

- [ ] **Step 1: 移除區域壓制器**

`src/modules/source-control/SourceControlView.tsx` 把根 div 的 onContextMenu 與其註解整段移除：

```tsx
  return (
    <div className="flex h-full flex-col bg-bg-inset">
```

（刪掉原本的 4 行註解與 `onContextMenu={(e) => { ... }}` 整個 prop，其餘 JSX 不動）

- [ ] **Step 2: 跑 source-control 測試**

Run: `npx vitest run src/modules/source-control/`
Expected: PASS。若有測試斷言 panel 層 preventDefault 行為，把該斷言改為描述新現實（交給全域 handler）或刪除該測試，並在 commit message 說明

- [ ] **Step 3: 全庫回歸與 typecheck**

Run: `npx vitest run && npm run typecheck`
Expected: 全綠、乾淨

- [ ] **Step 4: Commit**

```bash
git add src/modules/source-control/SourceControlView.tsx
git commit -m "refactor(source-control): drop the panel-level context-menu suppressor

InputContextMenu now suppresses the browser menu app-wide on every platform,
so the panel's own onContextMenu guard is redundant. Text inputs inside the
panel switch from the native menu to the app menu, which is the unified
behavior everywhere else."
```

---

## 驗收清單（主會話收尾用）

- [ ] `npx vitest run` 全綠、`npm run typecheck` 乾淨
- [ ] diff 對照 spec 逐段讀過
- [ ] code review（多維度 + 對抗驗證）
- [ ] windows-tauri pre-flight：本次移除平台分支、不加平台相依 code，確認無 `#[cfg]`、無 subprocess、無路徑處理變更
- [ ] PR 帶 label enhancement、milestone、assignee，內文附 spec 連結與平台行為對照表
