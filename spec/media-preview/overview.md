# Media Preview (Images + PDFs) Implementation Plan

## Reference Documentation
- Source: in-repo `src/modules/preview` (existing native-webview preview) and Tauri 2 asset protocol / `convertFileSrc`
- Key patterns:
  - `resolvePreviewSrc` builds `asset://localhost/%2F...` for the native child webview (relative-resource-safe)
  - `convertFileSrc(path)` (from `@tauri-apps/api/core`) is the platform-correct way to reference a local file from the main webview (`asset://localhost/...` on macOS/Linux, `http://asset.localhost/...` on Windows); already mocked to identity in `src/test/setup.ts`
  - `assetProtocol` is app-security config in `tauri.conf.json`, not a capability permission

## Codebase Analysis
- assetProtocol is already enabled (`tauri.conf.json` → `app.security.assetProtocol`) with `allow ["**","/**"]` and a secrets deny-list (`.ssh`, `.aws`, `.gnupg`, `.env*`, `*.pem`, `*.key`, `id_rsa*`), `requireLiteralLeadingDot: true`.
- Main-window CSP has `img-src 'self'`, so an inline `<img src="asset://...">` in the main webview is blocked today.
- All local file opens funnel through the tabs store:
  - `openFromSidebar({kind:"editor",path})` → FileTree click, FileTree new-file, FileFinder, Source Control "Open File"
  - `openInNewTab({kind:"editor",path})` → FileTree context menu, Source Control, tab-bar drop (`dragEntry.ts`)
  - `openEditorTab(path)` → LauncherPanel file picker
  - Pane drops → PaneTabContent `handleDrop` / split-drop effect / `onOpenFile`
- `PaneContent` union lives in `src/modules/terminal/lib/terminalLayout.ts`; `TabKind` in `src/stores/tabsStore.ts`. Two exhaustive `tabIcon` switches (`TabBar.tsx`, `WorkspacePanel.tsx`) compile-force handling of any new kind.
- `EditorTabContent` reads files as UTF-8 via `fs_read_file`; a binary image/PDF opened today shows garbled/empty text (baseline this feature fixes).
- Remote files use SFTP (`ssh://` URIs); the asset protocol cannot serve them, so routing must only branch for local paths (`isRemoteUri` guard).
- No shared `openFile` helper exists today; the store methods are the natural chokepoint.

## Rust / Capability Layer
- No new `#[tauri::command]` functions
- No capability or permission JSON changes (assetProtocol is config-level, not a capability permission)
- Only config edit is one line of CSP (`img-src`), for images. PDFs need no config change (they render in the existing native child webview)

---

## (1) Open Routing (shared foundation)
Extension classifier + interception in `openFromSidebar` / `openInNewTab` / `openEditorTab` + PaneTabContent drops

→ Details: [open-routing.md](./open-routing.md)

## (2) Image Preview
CSP `img-src` widening + `media` pane kind + `MediaTabContent` (main-webview `<img>` via `convertFileSrc`)

→ Details: [image-preview.md](./image-preview.md)

## (3) PDF Preview
Route `.pdf` to the existing native preview webview; no CSP change, no new dependency

→ Details: [pdf-preview.md](./pdf-preview.md)

## Time Estimate Summary
| Feature | Estimate |
|---------|----------|
| (1) Open Routing (shared) | 3.5-5h |
| (2) Image Preview | 5-7h |
| (3) PDF Preview | 2-2.5h |
| **Total** | **10.5-14.5h** |

Recommended implementation order: (2) first (it introduces the `media` pane kind the classifier returns), then (3), then (1) to wire every open path through them.

## Decision Points (diverging from the initial leaning)
1. PDFs remap to `{kind:"preview", url: fileUrl(path)}` at the shared store chokepoint instead of calling `openPreviewTab` — keeps routing at one branch point, honors caller open semantics, and sets a proper basename title (`openPreviewTab` would title the tab with the raw `file://` string). `openEditorTab` (LauncherPanel) still delegates to `openPreviewTab` for PDFs.
2. Images stay in the main webview via `<img>` (rejected routing them through the native preview webview: heavier per-image native child webview, floating z-order / overlay-hiding / zoom-scaling baggage). The CSP cost is a single render-only directive widening.
3. Scope guard: the classifier only branches for LOCAL paths; remote `ssh://` files keep opening in the editor (asset protocol cannot serve SFTP).

Known cosmetic wart (accept or follow-up): a local-PDF preview tab shows the web `Globe` icon and an editable address bar containing the file path.
