# Roadmap

> 最後更新：`1.52.0`（2026-10-26）。這份只放「**還沒做的事**」與「**版本檢核表**」；
> 每個版本改了什麼見 [`docs/ROADMAP_HISTORY.md`](./docs/ROADMAP_HISTORY.md)（摘要）與 [`CHANGELOG.md`](./CHANGELOG.md)（逐項細節）。
> 更深入的優化與改版評估見 [`docs/OPTIMIZATION_PROPOSAL.md`](./docs/OPTIMIZATION_PROPOSAL.md)。
>
> 用法：做完一項就把 `- [ ]` 改成 `- [x]`，並在 `docs/ROADMAP_HISTORY.md` 補一列版本摘要、在下方「版本檢核表」補一行。

## 明確排除的功能

以下功能目前刻意排除，若未來考慮加入，需先重新確認不違反「核心原則」：

- 不做「連去 Chrome 線上應用程式商店一鍵安裝擴充功能」（僅支援已解壓縮
  格式，需使用者自行下載解壓）。
- 不做任何呼叫平台未公開 API 的自動化抓取（例如輪詢新訊息、背景自動
  匯出）。對話匯出永遠是「使用者手動觸發、擷取當前畫面 DOM」。
- 不會把 cookie / localStorage 等登入憑證放進任何備份 / 匯出檔案。
- 不會寫自動繞過 X-Frame-Options 或類似安全性標頭的程式碼。

## 待辦檢核表（依優先順序）

### P0：先補債，再加功能

- [ ] **實機驗證債務（最優先）**：`1.17.0` 之後的功能都只做過 `node --check`、單元測試，沒有在真正的 Electron 視窗操作過
      （開發環境沒有顯示器）。可以跑 `npm install && npm start` 時，照 `BUILD_PLAN.md` 標示「待手動驗證」的項目與各版
      `CHANGELOG.md`「已知限制」逐項驗證，並整理成 `docs/MANUAL_QA.md` 逐項勾選：
  - [ ] `sql.js` 在 main process 初始化 WASM、打包成品能否啟動
  - [ ] `.docx`／`.pdf` 預覽編輯（`1.33.0`），含 PDF 預覽的動態 `import()` + Web Worker
  - [ ] 浮動托盤在背景／最小化時的顯示（`1.37.0`～`1.41.0`）
  - [ ] 全域快捷鍵（Windows／macOS／Linux X11／Wayland 各自的註冊與焦點行為）、設定頁快捷鍵錄製
  - [ ] 專案階段提示詞編輯、對話擷取預覽、Claude 實際 DOM 的巢狀去重效果
  - [ ] 專案範本匯入／匯出：檔案對話框多選、從系統檔案管理員拖檔進視窗（`1.46.0`～`1.47.0`）
- [ ] **依賴鎖定**：目前沒有任何 lockfile。在有網路的環境跑 `npm install`、提交 `package-lock.json`，CI 改 `npm ci`；
      同時確認 CI 在 `master` 上真的有跑起來（`1.40.1` 才補上 `master` 分支）。
- [ ] **補上受版控的 `eslint.config.js`**：`README` 與 `package.json` 都寫了 `npm run lint`，但 repo 沒有 ESLint 設定檔
      （`eslint .` 在 ESLint 10 需要 flat config），所以 `1.47.0` 沒跑 lint。`renderer/project/*.js` 要設成 `sourceType: 'script'`，
      各檔頂端的 `/* global */`／`/* exported */` 註解已備好。
- [ ] **跑一次 `npm run format:check` 並單獨 commit**：既有檔案有不合格項（含 CRLF 換行相關），CI 已有 format 檢查。
- [ ] **資安修補剩餘項目**（[`docs/SECURITY_AUDIT_REPORT.md`](./docs/SECURITY_AUDIT_REPORT.md)、[`docs/SECURITY_FIX_CHECKLIST.md`](./docs/SECURITY_FIX_CHECKLIST.md)）：
  - [x] H-1、M-1～M-5、L-1～L-5（`1.42.0` 完成）
  - [ ] Electron 30 升級（H-2，要在有網路的環境升級並跑冒煙測試）
  - [ ] Actions 釘 commit SHA
  - [ ] 評估替換或隔離 `pdf-lib`（L-6）
  - [ ] `npm audit`
  - [ ] 程式碼簽章
  - [ ] 檢核清單末尾的人工驗證項目

### P1：下一批候選

- [ ] **各平台檔案抓取實測**：`1.50.0` 的檔案下載對 Claude 的附件／成品卡片、ChatGPT 的產生檔案與圖片、Gemini／Grok 的圖片只有
      通用規則與 `fileSelector` 設定，沒有在真實登入畫面驗證；請實測後把各平台確定可用的 `fileSelector` 補進 `default-selectors.json`。

- [ ] **冒煙測試**：評估用 Playwright 的 Electron 支援＋`xvfb` 在 CI 啟動 App、開各子視窗、斷言沒有 renderer
      錯誤（不能取代人工驗證，托盤顯示規則在 xvfb 下無法驗證）。
- [ ] **內嵌第三方網站的安全加固（剩餘部分）**：`1.42.0` 已擋 `file:` 等非網頁協定的導覽與開窗；仍待補帳號視圖的
      `sandbox` 與權限請求（攝影機、麥克風、通知等）限制（需逐平台實測登入流程）。
- [ ] **Electron 升級**：`^30` 已超出官方支援範圍，建議在冒煙測試之後單獨一版升級。
- [ ] **托盤延伸**：最近使用目前只記知識庫提示詞，可考慮納入「專案階段提示詞」；快捷鍵目前只有一組，
      可評估「直接開啟知識庫視窗」之類的第二組。
- [ ] **提示詞變數**：`{{主題}}` 之類具名變數，複製時填值（專案階段流程已有類似的自動帶入）。

### P2：值得評估的方向

- [ ] **更多平台支援**：在 `PLATFORM_URLS` 與 `default-selectors.json` 增加項目，UI 下拉選單同步增加。
      （跟已完成的「本地端 AI 服務」不同：這一項是新增更多**固定網址**的雲端平台。）
- [ ] **評估是否把其他模組的資料搬進 SQLite**：目前只有日誌主控台用 sql.js，其餘仍是 JSON 檔。
      先訂出觸發條件（例如單一 JSON 檔超過數 MB、或全域搜尋延遲可感知）再動手；資料量變大時應重新評估
      `better-sqlite3`（要處理 `electron-rebuild`／`asarUnpack`），不要預設沿用 sql.js。完整取捨見 `PROJECT_SPEC.md` 第 9.7 節。
- [ ] **其餘大檔拆分**：`renderer/knowledge.js`（932 行）、`lib/utils.js`（837）、`renderer/settings.js`（756）、
      `lib/windows.js`（733）、`lib/ipc/projects.js`（約 800，`1.47.0` 後更長）。做法（多支一般 `<script>` 共用全域詞法作用域）見 `CHANGELOG.md` `1.45.0`。
- [ ] **範本檔延伸**：範例範本的英文／日文版、把常用範例升級成內建範本。
      （範本匯出已在 `1.47.0` 完成。）
- [ ] **新資料種類／新欄位**：照 `lib/migrations.js` 檔頭的三步驟（補 migration 步驟、補測試、不改 loader）。

## 版本檢核表（已發布）

每行對應一個版本；摘要在 [`docs/ROADMAP_HISTORY.md`](./docs/ROADMAP_HISTORY.md)，細節在 [`CHANGELOG.md`](./CHANGELOG.md)。

- [x] `1.16.0`　帳號清單排序
- [x] `1.17.0`　`main.js` 模組化：拆成 `lib/**`
- [x] `1.18.0`　選擇器設定「測試擷取」預覽
- [x] `1.19.0`　知識庫全文搜尋
- [x] `1.20.0`　GitHub Actions CI
- [x] `1.30.0`　OpenSpec 整合
- [x] `1.31.0`　本地端 AI 服務帳號類型
- [x] `1.32.0`　知識庫「簡報製作提示詞範本」
- [x] `1.33.0`　文件庫 `.docx`／`.pdf` 預覽與基本編輯
- [x] `1.33.1`　打包體積優化
- [x] `1.34.0`　「AI 短劇製作」專案範本
- [x] `1.35.0`　專案「關聯文件」與「簡報橋接」
- [x] `1.36.0`　「遊戲設計」專案範本
- [x] `1.37.0`～`1.38.0`　求職與職涯提示詞與套餐
- [x] `1.39.0`　對話擷取巢狀重複修正
- [x] `1.40.0`　專案範本各階段「相關提示詞」與 11 組新內建提示詞
- [x] `1.40.1`　文件與工程一致性整理
- [x] `1.41.0`　資料檔原子寫入＋`check:docs`
- [x] `1.42.0`　資安修補（沒有新功能）
- [x] `1.43.0`　多語系補完（繁中／英文／日文）
- [x] `1.44.0`　專案流程「派發」：把步驟交給指定帳號
- [x] `1.45.0`　內部整理：`project.js` 拆成 `renderer/project/*.js`
- [x] `1.46.0`　專案範本檔匯入
- [x] `1.47.0`　專案範本匯入／匯出提到專案清單層級
- [x] `1.48.0`　右下角托盤加入「內容工具」快速連結
- [x] `1.49.0`　托盤加入一鍵「匯出對話」
- [x] `1.50.0`　Claude 匯出內容修正與完整歷史載入；對話中的檔案一起下載
- [x] `1.51.0`　匯出擷取自我修復（備用選擇器、放寬外殼排除）與「診斷頁面結構」報告
- [x] `1.51.1`　擷取清理：隱藏視圖改讀 textContent、去除平台標籤前綴與按鈕／表單內的 UI 文字
- [x] `1.51.2`　Claude 匯出改選文字較完整的備用選擇器、濾掉零寬字元與雜訊；EMPTY_RESULT 附頁面探針
- [x] `1.51.3`　擷取失敗（零命中）時日誌自動附網址、頁面探針與結構診斷報告
- [x] `1.51.4`　診斷報告與頁面探針寫進持久化日誌（日誌匯出檔帶得出）
- [x] `1.51.5`　ChatGPT 新版 DOM（class 為主）的備用選擇器
- [x] `1.51.6`　ChatGPT 備用候選補 `text-user-message`／`bg-user-message` 兩組
- [x] `1.52.0`　對話中「要點擊才下載」的檔案（ChatGPT sandbox: 連結、Claude 成品卡片）一起下載

> 下一版：從上面的待辦檢核表挑項目，完成後在此補一行 `- [x]`。
