# 平行開發提示詞：功能 B｜托盤專案區塊的顯示條件可設定

分支名稱：`feat/tray-project-mode`　基準：`v1.40.0`
通用流程與合併提示詞見 [generic.md](./generic.md)。

## 分支對話提示詞（整段貼上）

```
我上傳了 Platter 專案（Platter_v1_40_0.zip，含 .git，基準 tag 為 v1.40.0）。
你這個對話只負責下面這一項功能，不要做其他事：

【本對話功能】
浮動托盤的「專案任務與階段提示詞」區塊（1.40.0 新增，資料來自 buildTrayProjectGroups()）
目前只顯示「已指派帳號且未完成」的流程任務，從範本新建的專案因任務未指派而是空的。請：
1. 新增設定「托盤專案區塊顯示範圍」，兩個選項：
   - 只顯示已指派的任務（預設，維持現行行為）
   - 顯示每個進行中專案的「目前步驟」（不論有沒有指派）
2. 設定存進既有的設定儲存機制，變更後托盤即時刷新；buildTrayProjectGroups() 以參數接收模式，
   保持純函式。
3. 區塊為空時，在托盤顯示一行說明為什麼是空的（依目前模式給不同文字），並指出怎麼改。
4. 三語系與測試（兩種模式、舊設定沒有該欄位時走預設）。

【開始前】
1. 解壓縮，讀 PROJECT_SPEC.md 中與本功能相關的章節、CHANGELOG.md 最近兩版。
2. 先 `git checkout -b feat/tray-project-mode`，所有修改都在這個分支。

【專案慣例（必須遵守）】
- 檔案是 CRLF 換行；修改時保留 CRLF，不要整檔改換行或整檔重排。
- 修改後用 Prettier 格式化「你動過的檔案」，不要全專案 format。
- UI 文字三語系（renderer/locales 的 zh-TW、en、ja）都要補，key 不可重複。
- 新行為要有測試（test/*.test.js，node:test）；跑 `node --test`，
  若有因環境缺套件（如 sql.js、mammoth）造成的既有失敗，要明說，不要當成通過。
- 資料欄位新增要向下相容舊資料（舊專案/舊設定沒有該欄位時不能壞）。
- 沒有實機驗證過的部分，要老實寫「未驗證」，不要寫成已完成。

【禁止事項（避免合併衝突）】
- 不要修改 package.json 的版本號。
- 不要直接編輯 CHANGELOG.md、README*.md、PROJECT_SPEC.md。
  改為新增一個檔案 docs-fragments/<分支名稱>.md，內容包含三段：
  (a) CHANGELOG 條目草稿（繁體中文，格式比照既有條目）
  (b) PROJECT_SPEC.md 要新增或修改的段落草稿，註明放在哪一節
  (c) 若影響內建提示詞數量或 README 說明，列出需要同步改的地方
- 不要重新命名或搬移既有檔案。

【不要動的範圍】
- 不要動托盤快捷鍵、最近使用（另一個對話負責，會動 renderer/tray.* 與 lib/windows.js）。
  你對 renderer/tray.js 的修改請盡量集中在 appendProjectSection() 與空狀態，降低衝突。
- 不要動階段提示詞的編輯／更新功能（另一個對話負責，會動 lib/workflow.js 的 stagePrompts 相關函式）。
  你只能改 buildTrayProjectGroups() 與其呼叫處。

【完成時輸出】
1. `git add -A && git commit`（commit message 用 feat: 開頭，說明改了什麼）。
2. 產生 patch：`git format-patch v1.40.0 --stdout > tray-project-mode.patch`，
   把 .patch 與 docs-fragments/tray-project-mode.md 一起放到 /mnt/user-data/outputs 並呈現給我。
3. 回報：改了哪些檔案、新增哪些 IPC／資料欄位／locale key、測試結果（通過與既有失敗各幾個）、
   哪些部分未實機驗證、可能與其他功能衝突的地方（例如動到 lib/workflow.js 的哪些函式）。
```
