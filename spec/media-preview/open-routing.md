# Open Routing (shared foundation)

Single branch point so every file-open path (sidebar click, file finder, source control, launcher picker, tab-bar drop, pane drop) opens images and PDFs in the right viewer instead of the text editor.

## User Stories

### US-1: One place decides the viewer
**As a** developer maintaining the open paths
**I want** file-type routing in one shared helper applied at the store boundary
**So that** every current and future open path benefits without duplicating logic

**Acceptance Criteria**:
- [ ] `fileOpenContent(path)` returns `media` for image extensions, `preview` for `.pdf`, `editor` otherwise
- [ ] Extension match is case-insensitive; a path with no extension opens in the editor
- [ ] Remote `ssh://` paths are never remapped (they keep opening in the editor)
- [ ] Clicking, finder-opening, source-control-opening, launcher-picking, and dropping an image or PDF all land in the correct viewer
- [ ] Tab title for a routed image/PDF is the file basename

## Development Tasks

### Rust Layer
- [ ] None

### IPC Layer (Capability + Permission)
- [ ] None (no command, no capability). Routing is pure frontend

### Frontend Layer
- [ ] New pure module `src/modules/explorer/lib/fileOpenContent.ts`:
  - `extOf(path)`: lowercased extension without the dot, or "" when none (handles both separators)
  - `isImagePath` / `isPdfPath` against `IMAGE_EXTS = png/jpg/jpeg/gif/webp/svg/bmp/ico`
  - `fileOpenContent(path): PaneContent` — `isRemoteUri` → editor; image → `{kind:"media",path}`; pdf → `{kind:"preview", url: fileUrl(path)}`; else editor
- [ ] `src/stores/tabsStore.ts`: private `resolveFileOpen(content)` remapping editor content; apply in `openFromSidebar` and `openInNewTab` — compute the basename title from the ORIGINAL editor path first, then remap, before the `!activeTab` branch and the split branch
- [ ] `openEditorTab(path)` (LauncherPanel picker): classify first; `preview` delegates to `openPreviewTab(content.url)`; `media`/`editor` fall through (keep the dedup ONLY for editor)
- [ ] `PaneTabContent.tsx` drop handlers: `handleDrop` cases editor/launcher/preview → `setPaneContent(tab.id, leafId, fileOpenContent(entry.path))`; split/wrap drop effect uses `fileOpenContent(pendingDrop.entry.path)`; `canDrop` adds `"media"` to the single-file group
- [ ] Optional (nice-to-have): terminal `onOpenFile` and editor breadcrumb `onSwitchFile` also route through `fileOpenContent`

### Quality Assurance
- [ ] `fileOpenContent.test.ts`: `.png`/`.PNG`/`.jpeg`/`.svg`/`.ico` → media; `.pdf`/`.PDF` → preview with `file://` url; `.ts`/`README` (no ext) → editor; `ssh://c1/a.png` → editor
- [ ] `tabsStore.test.ts`: `openFromSidebar` with `/a/pic.png` yields a media leaf + title `pic.png`; `/a/doc.pdf` yields a preview leaf url `file:///a/doc.pdf` + title `doc.pdf`; `openInNewTab` mirrors; `openEditorTab` routes both kinds
- [ ] Extend `FileTree.test.tsx`: clicking an image row opens a media pane

## Test Script

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Click `logo.png` in the explorer | Opens the image viewer pane, not garbled text |
| 2 | Click `spec.pdf` | Opens the native PDF preview |
| 3 | Cmd-P finder, open an image | Same image viewer |
| 4 | Drop an image onto a terminal pane edge | Splits a media pane |
| 5 | Click `main.ts` | Still opens the text editor |

## Time Estimate
- Frontend: 2-3h, Testing: 1h — **Subtotal 3.5-5h**
