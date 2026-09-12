# NEW_FEATURE_BUILD_PROMPT.md — 新功能開發提示詞模板

> 這份文件是給「下一個 AI／開發者」用的**啟動提示詞**，專門用在
> Stage 1～8（見 `BUILD_PLAN.md`）都已完成之後，要繼續替 Platter
> 加新功能的場景。跟 `PROJECT_SPEC.md`／`BUILD_PLAN.md` 不同：那兩份是
> 「重現整個專案」用的，這份是「在既有專案上疊加新功能」用的。
>
> 用法：複製下方【提示詞本體】整段（含你要新增的功能描述），貼給任何一個
> AI 開發助理（Claude / GPT / Cursor...）開新對話即可接續開發。

---

## 專案現況（先讀這段，掌握全貌）

- **專案**：Platter（AI Workspace Aggregator）——Electron 桌面應用，讓使用者
  在同一視窗內管理多個 AI 平台（Claude / ChatGPT / Gemini / Grok）帳號，
  各帳號 session 完全隔離；並附帶知識庫、虛擬團隊、專案管理、文件管理、
  對話庫、日誌主控台等生產力工具。
- **目前版本**：`package.json` 與 `CHANGELOG.md` 都已同步在 `1.16.0`
  （每次新增功能記得繼續保持同步）。
- **原始 8 階段建置計畫已全部完成並驗收，之後又疊加了 Stage 9～16**
  （見 `BUILD_PLAN.md`）：
  1. 專案骨架與 Session 隔離
  2. 帳號管理三視窗化
  3. 對話匯出機制
  4. 設定視窗完整功能
  5. 知識庫（提示詞＋套餐＋檢核表）
  6. 帳號角色機制＋虛擬團隊主控台
  7. 專案計畫管理＋文件管理
  8. 側邊欄多層選單重構＋角色預設提示詞整合
  9. 對話庫（新增對話 Markdown、匯出、跟文件庫互相關聯）
  10. 專案計畫進階功能（月曆／甘特圖／Issue 管理／跨專案總覽）
  11. 日誌主控台（錯誤日誌／稽核日誌／即時主控台）
  12. App 穩定性修正（單一實例鎖、`app.quit()` vs `app.exit()`、打包
      設定漏洞）
  13. 日誌主控台改用 SQLite（`sql.js`）
  14. 知識庫／對話庫新增「匯入 Markdown 檔案」
  15. App 版本號顯示 + 安裝程式預設路徑改到應用程式資料夾
  16. 帳號清單拖曳排序

  > ⚠️ **Stage 9～16 目前只做過 `node --check` 語法檢查跟邏輯層面的
  > 單元測試，還沒有在真正的 Electron 視窗環境（`npm start`）操作驗證
  > 過**。接續開發前，第一件事應該是先跑一次 `npm install && npm
  > start`，照 `BUILD_PLAN.md` Stage 9～16 的檢核表實際操作一遍，確認
  > 沒有語法檢查抓不到的執行期問題，再開始加新功能——不要假設這幾個
  > 階段「跟前 8 個階段一樣已經驗收過」。
- **權威規格文件**：`PROJECT_SPEC.md`（19 節，完整最終狀態規格，每次加新
  功能都應該回頭補進對應章節，讓它永遠代表「目前最新」的樣貌）。
- **既有文件分工**：
  | 檔案 | 用途 |
  |---|---|
  | `PROJECT_SPEC.md` | 目前為止的完整規格（唯一真相來源） |
  | `BUILD_PLAN.md` | 把規格拆成可驗收的階段＋檢核表，**接續開發的第一站** |
  | `CHANGELOG.md` | 逐版本紀錄「做了什麼」 |
  | `ROADMAP.md` | 明確排除的功能／未來可能方向 |
  | `NEW_FEATURE_BUILD_PROMPT.md`（本檔） | 新功能開發提示詞模板 |
  | `FIX_EXISTING_FEATURE_PROMPT.md` | 既有功能修正提示詞模板 |
  | `SPEC_ONLY_BUILD_PROMPT.md` | 只附文件、不附原始碼時的提示詞模板 |
  | `CHECKLIST.md` | ⚠️ 舊草稿、階段命名跟目前 `BUILD_PLAN.md` 不一致，僅供歷史參考，**新開發不要照抄這份，以 `BUILD_PLAN.md` 為準** |

---

## 開發時必須遵守的既有慣例（不要重新發明）

1. **核心原則（`PROJECT_SPEC.md` 第 2 節、`ROADMAP.md`）不可違反**：
   - 不呼叫任何平台未公開 API，對話擷取永遠是「讀取當前畫面已渲染 DOM」。
   - 不做任何繞過網站保護機制的事（不自動下載解壓瀏覽器擴充功能商店、
     不剝除 `X-Frame-Options` 之類安全性標頭）。
   - 不把 cookie / localStorage / session token 打包進任何備份／匯出／
     文件庫檔案；可攜資料只放中繼資料與使用者自產內容。
2. **子視窗一律用共用 helper**：`main.js` 的 `openChildWindow({ getWindow,
   setWindow, htmlFile, width, height, minWidth, minHeight })`，
   `parent: mainWindow`、**`modal: false`**（modal 會鎖死主視窗，跟
   selector 選取工具這類需要切回主視窗互動的功能衝突）。
3. **跨視窗即時同步一律用廣播 IPC**，不要用輪詢：新增/修改任何會影響
   其他視窗顯示的資料後，呼叫 `broadcastToAllWindows(channel, ...)`。
   現有頻道：`accounts:changed`、`knowledge:changed`、`documents:changed`、
   `conversations:changed`、`logs:changed`、`console:entry`（單筆即時
   推送，不是「資料變了重新整批拉取」的語意，跟其他頻道用法不同）、
   `language:changed`。新功能如果需要新的同步場景，比照這個模式新增頻道，
   並更新 `PROJECT_SPEC.md` 第 13 節的事件總覽表。
4. **資料層慣例**：每種資料一個 JSON 檔（放 `DATA_DIR`），主程序提供
   `loadX()`/`saveX()`，IPC 用 `namespace:action` 命名（例如
   `knowledge:group:toggleStep`）；「結構性變更」才需要按儲存鍵，
   「單純狀態切換」（勾選、任務狀態）走即時持久化 IPC，不用等儲存。
5. **匯入／備份一律「已存在 id 略過」**，不覆蓋使用者後續編輯；角色 id
   等跨資料引用欄位在匯入時不帶入來源環境的值。
6. **i18n**：所有畫面文字用 `data-i18n` / `window.i18n.t(key, vars)`，
   新增字串要同時補 `renderer/locales/zh-TW.json` 與 `en.json`
   （若有 `README.ja.md` 對應日文版，也一併確認是否要補 `ja.json`）。
7. **深色主題**沿用 `renderer.css` 既有 CSS 變數，不要在新視窗裡另外
   定義一套顏色。
8. **刪除／清理一律連動處理懸空引用**（比照角色刪除清知識庫 `roleIds`、
   項目刪除清套餐 `steps` 的模式），不要留下壞掉的 id。

---

## 【提示詞本體】——複製這一段開新對話使用

```
你是要接續開發「Platter（AI Workspace Aggregator）」這個 Electron 專案的
工程 AI。這個專案的原始 8 個建置階段已經全部完成並通過驗收，現在要在既有
基礎上加新功能。

請先讀專案根目錄下的這幾份文件建立完整認知，不要憑空猜測既有架構：
1. PROJECT_SPEC.md（完整最終規格，唯一真相來源）
2. BUILD_PLAN.md（既有 8 階段的交付項目與檢核表，特別注意其中提到的
   共用慣例：openChildWindow helper、broadcastToAllWindows 廣播模式、
   資料層 loadX/saveX 慣例、i18n 慣例）
3. CHANGELOG.md 最新幾筆（了解最近做了什麼）
4. ROADMAP.md（哪些事「明確不做」，新功能不能違反這些原則）
5. 實際原始碼（main.js / preload.js / renderer/**）

【核心原則，任何新功能都不能違反】
- 不呼叫平台未公開 API，對話擷取永遠只讀取當前畫面已渲染的 DOM。
- 不寫任何繞過網站保護機制（如 X-Frame-Options）的程式碼，不做自動安裝
  瀏覽器擴充功能之類的事。
- 不把使用者的登入憑證（cookie/localStorage/session token）放進任何
  備份、匯出、文件庫檔案。

【我要新增的功能】
<在這裡描述新功能需求：目的、使用情境、預期 UI 行為、跟既有哪些模組
（帳號/角色/知識庫/團隊/專案/文件/設定/i18n）有關聯。愈具體愈好，
不確定的地方可以先列出來讓我補充。>

【請你依序做這幾件事】
1. 先確認這個新功能不違反上述核心原則；如果有疑慮，先指出來跟我確認，
   不要直接動手做。
2. 比照 BUILD_PLAN.md 現有階段的格式，在該檔案後面新增下一個編號的
   「Stage <下一個數字，目前最新是 13，所以下一個是 14>：<功能名稱>」
   章節，包含：目標、前置需求（列出依賴哪些既有
   階段/資料結構）、交付項目（檔案層級列清楚要新增/修改哪些檔案）、
   檢核表（可勾選、可實際操作驗證的項目，不要寫抽象敘述）。
3. 依照上面的既有慣例（子視窗 helper、廣播 IPC、資料層 loadX/saveX、
   i18n、深色主題 CSS 變數、刪除連動清理懸空引用）實作程式碼，不要
   引入新的架構模式，除非既有模式明顯無法滿足需求（若是這種情況，
   先跟我說明原因跟你打算怎麼改，取得同意再動手）。
4. 完成後回頭更新 PROJECT_SPEC.md 對應章節（把新功能寫進「最終狀態」
   規格裡，不是只寫在 BUILD_PLAN.md），並在 CHANGELOG.md 新增一筆版本
   紀錄（版本號規則：新功能 minor +0.1.0，純修正 patch +0.0.1；同時
   記得同步更新 package.json 的 version 欄位）。
5. 如果這個功能牽涉備份／匯出格式，記得檢查是否要更新
   settings:exportBackup / importBackup 打包的物件內容，並在
   PROJECT_SPEC.md 第 13 節（IPC 事件總覽）或第 9.3 節（備份與還原）
   同步補上說明。
6. 最後列出這個 Stage 的檢核表給我，我會實際操作驗證，全部打勾之後才算
   完成，不要自己宣稱「完成」。

現在開始，如果你需要我補充任何細節再問我，不要用預設值硬猜業務邏輯。
```

---

## 附註：什麼時候不用開新對話、直接沿用現有對話即可

如果你正在跟同一個 AI 助理的既有對話串（已經看過整份程式碼、還記得上下文）
裡繼續開發，不需要整段貼上面的提示詞本體，只要提醒它：

> 「接下來要加新功能：<描述>。請照 BUILD_PLAN.md 既有的 Stage 格式幫我
> 加一個新階段，並遵守 PROJECT_SPEC.md 第 2 節的核心原則，做完記得更新
> PROJECT_SPEC.md、CHANGELOG.md。」

這樣就夠喚回既有慣例，不用整份文件都貼一次。
