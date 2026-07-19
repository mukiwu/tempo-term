# PDF Preview

Route `.pdf` to the existing native preview webview (WKWebView on macOS, WebView2 on Windows both render PDFs natively). No pdf.js, no CSP change.

## User Stories

### US-1: View a PDF in-app
**As a** user
**I want** clicking a PDF to open it in the native viewer
**So that** I can read it without leaving the app or bundling pdf.js

**Acceptance Criteria**:
- [ ] Clicking a `.pdf` opens a `preview` pane that renders the document natively
- [ ] The tab title is the PDF basename
- [ ] No CSP change and no new dependency
- [ ] Works on macOS and Windows

## Development Tasks

### Rust Layer
- [ ] None (reuses the existing preview commands)

### IPC Layer (Capability + Permission)
- [ ] None. The native child webview renders the PDF; the main-window CSP does not apply to it

### Frontend Layer
- [ ] No new component. Routing remaps `.pdf` to `{ kind: "preview", url: fileUrl(path) }`; `resolvePreviewSrc` turns it into `asset://localhost/...`, identical to the existing drop-to-preview of a local file
- [ ] Title: basename captured from the original path before remap; `useNativePreviewWebview` ignores `asset:` navigations so the title stays put
- [ ] Known cosmetic (accept or follow-up): a local-PDF preview tab shows the `Globe` tab icon and an editable address bar containing the file path

### Quality Assurance
- [ ] Covered by the open-routing store tests (`.pdf` → preview url + basename title)
- [ ] Manual (macOS): click a `.pdf` → WKWebView renders it
- [ ] Manual (Windows CI build): click a `.pdf` → WebView2 renders it

## Windows Pitfalls (applies to images + PDFs)
- [ ] Images: always `convertFileSrc`, never hardcode `asset://` (Windows emits `http://asset.localhost/...`; CSP includes both)
- [ ] PDFs: same path the existing drop-to-preview of a local file uses; if that is broken on Windows, PDFs inherit it — cross-check the `windows-tauri` skill release checklist
- [ ] WebView2 renders PDF natively (Edge viewer); WKWebView renders PDF natively

## Time Estimate
- Frontend: 0.5-1h, Testing + Windows verify: 1-1.5h — **Subtotal 2-2.5h**
