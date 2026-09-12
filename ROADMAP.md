# Roadmap

以下功能目前刻意排除，若未來考慮加入，需先重新確認不違反「核心原則」：

- 不做「連去 Chrome 線上應用程式商店一鍵安裝擴充功能」（僅支援已解壓縮
  格式，需使用者自行下載解壓）。
- 不做任何呼叫平台未公開 API 的自動化抓取（例如輪詢新訊息、背景自動
  匯出）。對話匯出永遠是「使用者手動觸發、擷取當前畫面 DOM」。
- 不會把 cookie / localStorage 等登入憑證放進任何備份 / 匯出檔案。
- 不會寫自動繞過 X-Frame-Options 或類似安全性標頭的程式碼。

## 未來可能考慮的方向

- ~~帳號清單排序（拖曳排序）~~ → 已在 `1.16.0` 完成，見 `PROJECT_SPEC.md`
  第 3.2 節。
- 知識庫項目全文搜尋。
- 選擇器設定支援「測試擷取」預覽，不用真的匯出就能看到擷取結果——
  1.11.0 已經讓擷取失敗時回傳診斷數字（`matchedNodeCount`/
  `nonEmptyMessageCount`）並顯示在提示視窗跟日誌主控台的主控台分頁，
  但還沒有一個「不用真的匯出、點一下就能看預覽」的專屬 UI，這項還是
  待辦。
- 更多平台支援（在 `PLATFORM_URLS` 與 `default-selectors.json` 增加項目
  即可，UI 下拉選單同步增加選項）。
- GitHub Actions CI：push / PR 時自動跑 `npm run lint` + `npm test`
  （不含實際啟動 Electron App 互動的測試，CI 環境沒有顯示器，那部分
  永遠要靠 `npm start` 手動驗證）。`npm test`/`npm run lint` 本身已經在
  `1.7.0` 做成真的可以跑的腳本（見 `lib/utils.js`、`test/utils.test.js`、
  `.eslintrc.json`），`1.13.0` 又補了 `test/sqlite.test.js`，還缺的只是
  接上 CI workflow 檔案。
- 把 `main.js`（目前已破千行）繼續模組化，`lib/utils.js`、
  `lib/sqlite.js` 只是第一步，之後可以考慮把資料層（`loadX`/`saveX`
  系列）、IPC handler 註冊也拆成獨立模組。
- `npm run format` 目前只有腳本本身可以正確執行，`main.js`/`preload.js`/
  `renderer/**` 都還沒有整批套用過 Prettier 排版（會是一次性的大量非
  功能性 diff，刻意獨立處理，不跟其他修改混在一起）。
- **評估是否把其他模組的資料也搬進 SQLite**：目前只有日誌主控台
  （`logs.sqlite`）用 sql.js，帳號/知識庫/專案/文件庫/對話庫仍然是
  JSON 檔。如果之後這些模組的資料量或查詢需求明顯變複雜（例如想要
  「知識庫全文搜尋」這種跨欄位查詢），可以考慮跟進；但 sql.js 資料庫
  整個活在記憶體裡、每次存檔都要整份匯出重寫，資料量/寫入頻率如果變
  大，屆時應該重新評估 `better-sqlite3`（原生模組，效能好很多，但要
  處理 `electron-rebuild`/`asarUnpack` 這些打包上的額外複雜度），不要
  預設沿用 sql.js。完整取捨說明見 `PROJECT_SPEC.md` 第 9.7 節。
- **Stage 9～14 的手動驗證債務**：這幾個階段目前只做過語法檢查跟邏輯
  層面的單元測試，沒有在真正的 Electron 視窗環境操作過（開發環境沒有
  顯示器）。下一次有辦法實際跑 `npm start` 的時候，應該優先把
  `BUILD_PLAN.md` 裡標示「待手動驗證」的項目都補做完，尤其是 Stage 13
  的「`sql.js` 在 Electron main process 裡能不能正常初始化 WASM」跟
  Stage 12 的「打包出來的成品能不能正常啟動」這兩項——這兩項理論上都
  應該沒問題，但都還沒被真的驗證過。
