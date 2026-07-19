# Image Preview

Render images (`png/jpg/jpeg/gif/webp/svg/bmp/ico`) in a new `media` pane inside the MAIN webview via `<img src={convertFileSrc(path)}>`.

## User Stories

### US-1: View an image in-app
**As a** user
**I want** clicking an image to show it in a viewer pane
**So that** I do not get garbled binary text in the editor

**Acceptance Criteria**:
- [ ] The image renders fit-to-pane on `bg-bg`, filename shown in the pane header
- [ ] A media pane splits/opens/reuses exactly like any other file pane
- [ ] A broken/denied file shows a load-error message, not a blank pane
- [ ] The tab icon is an image glyph; the tab title is the filename
- [ ] All strings are i18n'd (en + zh-Hant)

## Development Tasks

### Rust Layer
- [ ] None

### IPC Layer (Capability + Permission)
- [ ] No capability file changes
- [ ] `tauri.conf.json` → `app.security.csp`: widen `img-src` only — `img-src 'self'` → `img-src 'self' asset: http://asset.localhost`
- [ ] Security review (document in PR):
  - Only `img-src` is widened (render-only). `connect-src` is NOT widened, so `fetch()` still cannot read file bytes
  - The asset scope deny-list already blocks `.ssh`/`.aws`/`.env`/`*.key`/`*.pem`/`id_rsa*`
  - `script-src 'self'` (no inline/remote scripts) keeps `<img>` injection hard
  - SVG loaded via `<img>` runs no scripts and loads no external subresources
  - Residual risk: an injected `<img src="asset://...">` could probe file existence via load/error timing — low, acceptable, least-privilege

### Frontend Layer
- [ ] `src/modules/terminal/lib/terminalLayout.ts`: add `| { kind: "media"; path: string }` to `PaneContent`
- [ ] `src/stores/tabsStore.ts`: add `"media"` to `TabKind`; extend `singleLeafContentEquals` with a media path comparison (dedup parity)
- [ ] New `src/modules/media/MediaTabContent.tsx` (mirror `PreviewTabContent` shell): `PaneHeader` with basename; `<img src={convertFileSrc(path)}>` centered, `object-contain`, on `bg-bg`; `onError` → `t("media:loadError")`; props `{ path, showClose?, onClose? }`
- [ ] `PaneTabContent.tsx`: lazy `MediaTabContent`; render branch for `kind === "media"`
- [ ] `TabBar.tsx` + `WorkspacePanel.tsx`: `case "media": return Image;` (lucide) in both `tabIcon` switches
- [ ] i18n new `media` namespace (config.ts + en/media.json + zh-Hant/media.json)

### Quality Assurance
- [ ] `MediaTabContent.test.tsx`: renders `<img>` (convertFileSrc mocked to identity) + filename header; `onError` swaps to error text
- [ ] Manual: click a `.png` → renders; a denied file (`~/.ssh/x.png`) → load-error, not a crash
- [ ] Manual: temporarily revert the CSP edit → image fails (confirms CSP is the enabler)

## Time Estimate
- IPC/config: 0.5-1h, Frontend: 3-4h, Testing: 1h — **Subtotal 5-7h**
