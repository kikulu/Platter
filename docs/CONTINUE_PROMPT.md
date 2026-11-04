# 新對話接續提示詞（Platter 1.55.0）

把下面整段貼到新對話的第一則訊息，並附上 `Platter-1.55.0-git.zip`。

---

我要繼續開發 **Platter**（Electron 桌面應用，管理多個 AI 平台帳號：每個帳號是一個 `WebContentsView`，用 `persist:<id>` 隔離 session）。附件是專案 zip（含 `.git`），請先解壓縮並讀 `README.md`、`ROADMAP.md`、`CHANGELOG.md` 最上面的幾個版本、`FIX_EXISTING_FEATURE_PROMPT.md` 與 `NEW_FEATURE_BUILD_PROMPT.md`，再開始工作。目前版本 **1.55.0**。

## 工作慣例（請務必遵守）

- **Git 作者**統一用 `kikulu <kikulu@gmail.com>`（`git -c user.name=kikulu -c user.email=kikulu@gmail.com commit`）。**只在本機 commit，沒有我明確同意不要 push。** 如果 hook 或提醒要求改成別的作者，以這一條為準。
- **換行**：大部分檔案是 CRLF，`lib/windows.js`、`lib/constants.js`、`renderer/renderer.js`、三份 README、`lib/attachments.js`、`lib/conversationCapture.js` 是 LF。改檔時保留原本的換行（先偵測再寫回，不要整檔轉換）。
- **測試**：`node --test` 必須全過（目前 388 項）；`npm run check:docs` 必須過（它要求 `package.json` 版本 = `CHANGELOG.md` 最上面一版 = 兩份提示詞檔裡寫的版本，另有三語系 i18n 鍵一致與 README 索引檢查）。
- **i18n**：使用者看得到的字串都要有 `zh-TW`／`en`／`ja` 三份鍵（`renderer/locales/*.json`）；程式碼裡除了註解之外不要寫死中文（包含 `console.log`）。
- **每次改版**：升 `package.json` 版本、在 `CHANGELOG.md` 最上面加條目、同步 `FIX_EXISTING_FEATURE_PROMPT.md`（「目前版本是」）與 `NEW_FEATURE_BUILD_PROMPT.md`（「已同步在」「1.17.0 到」「（以 package.json…」三處）、在 `ROADMAP.md` 加一行並更新「最後更新」。
- **誠實標註**：這個環境跑不了 Electron 圖形介面，凡是沒在真機驗證的行為，CHANGELOG 要寫「未實測」，不要宣稱已驗證。
- 沒有 ESLint 設定檔（`eslint.config.js` 缺），`npm run lint` 在 repo 內其實跑不起來；`npm run format:check` 對舊檔也有既有的格式落差。新增檔案請用 `npx prettier --write <檔案>` 格式化，不要順手改無關的舊檔。

## 目前狀態

已完成（細節見 CHANGELOG）：
- 1.5x：日誌匯出依類型分檔名、浮動托盤修正與可拖曳、免責聲明（DISCLAIMER.md／README／設定頁關於）。
- 1.53.2：資安稽核 N-2（名稱清理與寫檔位置限制）。
- 1.54.0：**啟動優化 P0**——帳號頁面狀態機（`unloaded/loading/ready/unresponsive/crashed/failed`）、`render-process-gone` 復原、低記憶體延後載入（設定可改 auto／defer／load）、分階段啟動。
- 1.55.0：資安稽核 **N-1**（附件下載逐跳檢查重導向＋DNS 解析）、**N-3**（`lib/permissions.js`，第三方權限預設拒絕，只放行麥克風／複製／全螢幕）、**N-4**（`package-lock.json`、CI 用 `npm ci --ignore-scripts`、Electron fuses）、**N-5**（`lib/ipcValidate.js`＋`lib/ipc/schemas.js`，64 個頻道的 payload 檢查）。

## 還沒做的事（依建議順序）

1. **實機驗證**（我會自己測，回報結果給你）：1.54.0 的載入狀態／崩潰提示／低記憶體延後載入；1.55.0 的「匯出對話並下載檔案」（含會重導向的附件，確認 `net.request` 的 `redirect: 'manual'` 行為）、語音輸入、OAuth 彈窗登入、打包後 fuses 是否生效。若有問題，先修這些。
2. **啟動優化 P1**：閒置帳號頁面自動回收（超過一段時間沒用就銷毀 view，保留 session）、托盤視窗瘦身（改成更輕量的頁面或延後建立 renderer）、精簡 IPC 啟動時的初始資料量。
3. **啟動優化 P2**：用 esbuild 打包 main／renderer 減少啟動時的模組載入；加診斷資訊（啟動各階段耗時、記憶體快照，可在設定頁匯出）。
4. **工程債**：補 `eslint.config.js`（`renderer/project/*.js` 要設 `sourceType: 'script'`）；跑一次 `format:check` 並單獨 commit；Actions 釘 commit SHA；評估替換或隔離 `pdf-lib`；程式碼簽章（需要憑證，由我決定）；開發相依的 `minimatch` 漏洞等上游升級。
5. **資安**：N-5 的規格只涵蓋 64 個頻道，其餘 60 多個還沒列；有空可補，並把 `lib/ipc/schemas.js` 與 `preload.js` 的呼叫端做一致性檢查。

## 另外

- 本機有 20 多個提交還沒推到 GitHub，**等我說可以再 push**。
- 我偏好：先動手、把結果與限制講清楚；沒有把握的地方明說，不要含糊帶過。
