# 平行開發提示詞：通用範本

把專案資料夾（含 `.git`）放進多個**新對話**，各自做一項功能，最後在另一個對話合併。
完整流程請見 [README.md](./README.md)。本檔是**通用範本**：分支對話用提示詞 1，合併對話用提示詞 2。
個別功能的現成版本在同資料夾的 `feature-*.md`。

## 提示詞 1：分支對話（每個對話各貼一次）

把 `【本對話功能】` 換成功能說明，`<分支名稱>` 換成簡短英文（例如 `tray-project-mode`）。

```
我上傳了 Platter 專案（Platter_v1_40_0.zip，含 .git，基準 tag 為 v1.40.0）。
你這個對話只負責下面這一項功能，不要做其他事：

【本對話功能】
（在此貼上功能說明。請同時寫清楚「不要動什麼」——其他對話負責的功能，避免互相干擾。）

【開始前】
1. 解壓縮，讀 PROJECT_SPEC.md 中與本功能相關的章節、CHANGELOG.md 最近兩版。
2. 先 `git checkout -b feat/<分支名稱>`，所有修改都在這個分支。

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

【完成時輸出】
1. `git add -A && git commit`（commit message 用 feat: 開頭，說明改了什麼）。
2. 產生 patch：`git format-patch v1.40.0 --stdout > <分支名稱>.patch`，
   把 .patch 與 docs-fragments/<分支名稱>.md 一起放到 /mnt/user-data/outputs 並呈現給我。
3. 回報：改了哪些檔案、新增哪些 IPC／資料欄位／locale key、測試結果（通過與既有失敗各幾個）、
   哪些部分未實機驗證、可能與其他功能衝突的地方（例如動到 lib/workflow.js 的哪些函式）。
```

## 提示詞 2：合併對話

上傳 `Platter_v1_40_0.zip`，加上所有分支對話產出的 `<分支名稱>.patch` 與 `docs-fragments/<分支名稱>.md`。

```
我上傳了 Platter_v1_40_0.zip（基準 tag v1.40.0），以及多個分支對話產出的檔案：
- <分支名稱>.patch × N
- docs-fragments/<分支名稱>.md × N

請依下列步驟合併，每一步都回報結果：

1. 解壓縮，`git checkout -b merge/next v1.40.0`。
2. 依序用 `git am --3way` 套用每個 .patch（順序：
   （填入你希望的順序，建議先套用改動小、不碰共用檔案的））。
   遇到衝突不要硬蓋：列出衝突檔案與兩邊的意圖，用「兩邊功能都保留」的方式解決，
   解完要說明你怎麼取捨。
3. 針對同時被多個分支改過的檔案（特別是 lib/workflow.js、renderer/tray.js、
   renderer/tray.css、locales 三個 json、preload.js），合併後逐一檢查：
   - 沒有重複的函式、IPC channel、preload 方法、locale key
   - 三語系 key 完全對齊
4. 跑 `node --check`（動過的 js）、Prettier 檢查、`node --test`，
   並寫一個跨功能的整合測試，確認合併後各功能同時可用。
   既有因環境缺套件造成的失敗要與新失敗分開說明。
5. 版本號與文件由你統一處理：
   - package.json 升版（合併後為 1.41.0，若內容只有修正則 1.40.1）
   - 把各 docs-fragments 合併成「一個」CHANGELOG 條目，依功能分段
   - 把 PROJECT_SPEC.md、README 三語的相關段落依各 fragment 更新，
     內建提示詞數量若有變動，README、README.en、README.ja、PROJECT_SPEC 四處都要改
   - 刪除 docs-fragments 資料夾（不納入最終版本）
6. 保留 CRLF；最後 `git commit`、打 tag（v1.41.0），
   並產出完整 zip（含 .git，不含 node_modules）。
7. 回報：每個分支套用是否順利、衝突如何處理、最終測試結果、
   仍未實機驗證的項目清單。
```
