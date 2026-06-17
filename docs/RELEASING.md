# TempoTerm 發版指南

本機一鍵發版。第一次跑「首次設定」一次，之後每次只跑「升版步驟」

## 首次設定（一次即可）

### 1. Apple Developer ID

確認 macOS Keychain 有 Developer ID Application 憑證

```bash
security find-identity -v -p codesigning
```

應看到 `Developer ID Application: <Your Name> (<TEAM_ID>)`

### 2. App-specific password

到 https://appleid.apple.com → Sign-In and Security → App-Specific Passwords 產一組，標籤例如 tempoterm-notarize

### 3. 環境變數

加進 `~/.zshrc`

```bash
export APPLE_ID="your@apple.id"
export APPLE_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export APPLE_TEAM_ID="62629DYRU8"
```

### 4. Updater 簽名金鑰

已存在 `~/.tempoterm/updater-key.json`（無密碼）

重要：把 `~/.tempoterm/updater-key.json` 與 `.pub` 備份到 1Password 或加密硬碟。遺失私鑰等於無法再發更新給現有使用者

公鑰已在 `src-tauri/tauri.conf.json`、進 repo，不需另外備份

### 5. GitHub CLI

```bash
gh auth status   # 未登入就 gh auth login
```

---

## 升版步驟

### 1. 改版號（三處同步）

- `src-tauri/tauri.conf.json` → version
- `package.json` → version
- `src-tauri/Cargo.toml` → version

依 semver，patch 修 bug、minor 加功能、major 破壞性變更

### 2. 寫 release notes

編輯 `CHANGELOG-NEXT.md`，這份內容會同時出現在 GitHub release 和 app 內的更新提示

### 3. Commit + push

```bash
git add -A
git commit -m "chore: release v<VERSION>"
git push origin master
```

### 4. 跑 release.sh

```bash
./scripts/release.sh
```

腳本會做：build（順便公證並 staple .app）→ 公證 .dmg（5 到 15 分鐘）→ staple → 產 latest.json → gh release create 上傳四個資產（dmg、app.tar.gz、.sig、latest.json）

### 5. 歸檔 changelog（建議）

```bash
mkdir -p docs/changelogs
mv CHANGELOG-NEXT.md docs/changelogs/CHANGELOG-<VERSION>.md
touch CHANGELOG-NEXT.md
git add -A && git commit -m "chore: archive v<VERSION> changelog" && git push
```

---

## 自動更新怎麼運作

app 啟動後幾秒會靜默打 `https://github.com/mukiwu/tempo-term/releases/latest/download/latest.json`，比對版本，有新版才跳提示。使用者也能在 設定 → 關於 手動按檢查更新。下載的 `.tar.gz` 會用 `~/.tempoterm` 的私鑰簽章，app 內嵌的公鑰負責驗章，驗不過就不會安裝

---

## 故障排除

### Notarize timeout 或被拒

```bash
xcrun notarytool history --apple-id "$APPLE_ID" --password "$APPLE_PASSWORD" --team-id "$APPLE_TEAM_ID"
xcrun notarytool log <id> --apple-id "$APPLE_ID" --password "$APPLE_PASSWORD" --team-id "$APPLE_TEAM_ID"
```

### Updater 簽名不符

私鑰換過或對不上公鑰，使用者只能手動下載新版重建信任

### 私鑰遺失（嚴重事件）

1. 產新 keypair
2. 更新 `tauri.conf.json` 的 pubkey
3. 發新版，現有使用者的 updater 會失敗、需手動下載，release notes 要標明

---

## 私鑰備份建議

1Password 或 Bitwarden 加密附件、外接加密硬碟（FileVault）。不要放 iCloud 明文、不要 commit、不要 email
