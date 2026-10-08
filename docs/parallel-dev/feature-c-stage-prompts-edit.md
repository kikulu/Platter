# 平行開發提示詞：功能 C｜階段提示詞可編輯與從知識庫更新

分支名稱：`feat/stage-prompts-edit`　基準：`v1.40.0`
通用流程與合併提示詞見 [generic.md](./generic.md)。

## 分支對話提示詞（整段貼上）

```
我上傳了 Platter 專案（Platter_v1_40_0.zip，含 .git，基準 tag 為 v1.40.0）。
你這個對話只負責下面這一項功能，不要做其他事：

【本對話功能】
專案的 workflow.stagePrompts（1.40.0 新增）目前是建立專案時的快照，使用者無法調整。請：
1. 專案視窗流程頁的「本階段相關提示詞」區塊新增：
   - 新增：從知識庫挑一個提示詞加進本階段，或輸入自訂標題＋內容
   - 移除：刪除某個階段提示詞（需確認）
   - 編輯：可修改標題與內容（僅改這個專案的快照）
2. 新增「從知識庫重新整理」：對來源是知識庫的項目，比對內容有差異時顯示差異並讓使用者
   選擇要不要更新；自訂項目不受影響。stagePrompts 項目需要記錄來源（例如 sourceDefaultId）；
   舊專案沒有此欄位要能正常運作。
3. IPC 與 preload 新增對應方法；一般 projects:save 不可蓋掉 workflow／stagePrompts（沿用
   既有保護，補測試）。
4. 三語系與測試。

【開始前】
1. 解壓縮，讀 PROJECT_SPEC.md 中與本功能相關的章節、CHANGELOG.md 最近兩版。
2. 先 `git checkout -b feat/stage-prompts-edit`，所有修改都在這個分支。

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
- 不要動托盤（renderer/tray.*、lib/windows.js）。托盤只讀 stagePrompts，欄位格式
  { id, stage, title, prompt } 必須保持相容，只能新增欄位不能改名或刪除。
- 不要動 buildTrayProjectGroups()（另一個對話會改它的參數）。

【完成時輸出】
1. `git add -A && git commit`（commit message 用 feat: 開頭，說明改了什麼）。
2. 產生 patch：`git format-patch v1.40.0 --stdout > stage-prompts-edit.patch`，
   把 .patch 與 docs-fragments/stage-prompts-edit.md 一起放到 /mnt/user-data/outputs 並呈現給我。
3. 回報：改了哪些檔案、新增哪些 IPC／資料欄位／locale key、測試結果（通過與既有失敗各幾個）、
   哪些部分未實機驗證、可能與其他功能衝突的地方（例如動到 lib/workflow.js 的哪些函式）。
```
