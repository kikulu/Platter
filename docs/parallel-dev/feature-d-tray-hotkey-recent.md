# 平行開發提示詞：功能 D｜托盤全域快捷鍵與最近使用

分支名稱：`feat/tray-hotkey-recent`　基準：`v1.40.0`
通用流程與合併提示詞見 [generic.md](./generic.md)。

## 分支對話提示詞（整段貼上）

```
我上傳了 Platter 專案（Platter_v1_40_0.zip，含 .git，基準 tag 為 v1.40.0）。
你這個對話只負責下面這一項功能，不要做其他事：

【本對話功能】
浮動快速提示詞托盤（lib/windows.js、renderer/tray.*）新增：
1. 全域快捷鍵（預設可自訂，例如 CommandOrControl+Shift+P）：切換托盤展開／收合。
   Platter 在背景時快捷鍵只在 Platter 有焦點視窗時才讓托盤顯示（沿用 1.39.0 的
   syncTrayVisibility() 規則，不可再讓托盤蓋在其他應用前面）；快捷鍵衝突或註冊失敗時要
   在設定頁顯示錯誤並不影響其他功能。
2. 最近使用：清單最上方新增「最近使用」區，記錄最近複製的 N 筆（預設 5，只記提示詞 id，
   存進既有設定儲存機制）；知識庫項目被刪除時要自動略過。
3. 設定頁新增快捷鍵與最近使用筆數設定。三語系與測試（最近使用的排序、去重、上限、
   項目被刪除）。
4. 在文件草稿中老實標註：Linux／Wayland 的快捷鍵與焦點行為未驗證。

【開始前】
1. 解壓縮，讀 PROJECT_SPEC.md 中與本功能相關的章節、CHANGELOG.md 最近兩版。
2. 先 `git checkout -b feat/tray-hotkey-recent`，所有修改都在這個分支。

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
- 不要動托盤的「專案任務與階段提示詞」區塊（appendProjectSection() 及其資料來源，
  另一個對話負責）。你新增的「最近使用」區請做成獨立函式，由 renderList() 呼叫一行即可，
  降低衝突。
- 不要動 lib/workflow.js。

【完成時輸出】
1. `git add -A && git commit`（commit message 用 feat: 開頭，說明改了什麼）。
2. 產生 patch：`git format-patch v1.40.0 --stdout > tray-hotkey-recent.patch`，
   把 .patch 與 docs-fragments/tray-hotkey-recent.md 一起放到 /mnt/user-data/outputs 並呈現給我。
3. 回報：改了哪些檔案、新增哪些 IPC／資料欄位／locale key、測試結果（通過與既有失敗各幾個）、
   哪些部分未實機驗證、可能與其他功能衝突的地方（例如動到 lib/workflow.js 的哪些函式）。
```
