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
  在同一視窗內管理多個 AI 平台（Claude / ChatGPT / Gemini / Grok）帳號與
  本地端 AI 服務（Ollama／LM Studio／Stable Diffusion WebUI／ComfyUI 等
  自訂網址工具），各帳號 session 完全隔離；並附帶知識庫、虛擬團隊、專案
  管理、文件庫（含 Markdown／Word／PDF 預覽與 Word／PDF 基本編輯）、對話庫、
  日誌主控台等生產力工具。
- **目前版本**：`package.json` 與 `CHANGELOG.md` 都已同步在 `1.36.0`
  （每次新增功能記得繼續保持同步——版本號規則見本文件後段）。
- **原始 8 階段建置計畫全部完成並驗收，之後疊加到 Stage 16**（見
  `BUILD_PLAN.md`）：
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

  > ⚠️ **`BUILD_PLAN.md` 的 Stage 編號從 Stage 16（約對應 `1.16.0`）之後
  > 就沒有再繼續加新 Stage**，不代表開發停在那裡——`1.17.0` 到 `1.36.0`
  > 之間疊加的所有功能，實際紀錄都只落在 `CHANGELOG.md`（逐版本）跟
  > `PROJECT_SPEC.md`（對應章節），**沒有回頭補成 `BUILD_PLAN.md` 的新
  > Stage**。這是既成事實、不是建議的做法：`BUILD_PLAN.md` 原本的設計
  > 目的是「從零重現整個專案」用的分階段施工藍圖，對一個已經成熟的專案
  > 持續疊加小功能而言，`CHANGELOG.md` + `PROJECT_SPEC.md` 的更新成本
  > 低得多、也更貼近「這次到底改了什麼」。接續開發**預設照這個已經形成
  > 的慣例走**：改完功能更新 `PROJECT_SPEC.md` 對應章節 + `CHANGELOG.md`
  > 新增一筆版本 + 三份 `README`（如果使用者可見的功能有變化）即可，
  > **不用、也不建議回頭在 `BUILD_PLAN.md` 加 Stage 17、18...**。只有在
  > 新東西的規模大到「等於從零重建一塊全新子系統」（例如整個換掉帳號
  > session 隔離機制這種級別）才考慮要不要另開一份專屬的階段文件，一般
  > 功能增量不需要。
  >
  > `1.17.0` 到 `1.36.0` 之間的重點功能方向（細節一律以 `CHANGELOG.md`
  > 各版本條目與 `PROJECT_SPEC.md` 對應章節為準，這裡只列方向幫助快速
  > 定位）：OpenSpec 整合（§7.7）、本地端 AI 服務帳號類型（§3.2）、知識庫
  > 簡報製作範本＋專案「簡報橋接」（§7.8）、文件庫 `.docx`/`.pdf` 預覽與
  > 編輯（§8）、AI 短劇製作／遊戲設計專案範本（§7.6）、專案「關聯文件」
  > 與步驟產出存成文件（§7.8）、角色與選擇器的覆蓋安裝補種修正＋角色
  > 清單基本/延展分類（§4、§10）、打包體積優化（`build.files` 排除規則，
  > 不影響規格、沒有獨立章節）。
  >
  > **另一個持續存在、還沒清掉的技術債**：`1.17.0` 之後新增的多數功能
  > 都只做過 `node --check`／`npm test`／`npm run lint`／
  > `npm run format:check`，以及對新寫的 `lib/*.js` 純函式用 Node
  > 直接呼叫驗證過邏輯，**幾乎沒有一項在真正的 Electron 視窗環境
  > （`npm start`）實際點過畫面驗證**（CHANGELOG.md 各版本的「已知限制」
  > 小節幾乎都會誠實註明這點）。接續開發前，如果環境許可跑 `npm start`，
  > 第一件事應該是挑幾個標了「尚未實機驗證」的功能先實際操作一輪，確認
  > 沒有語法檢查抓不到的執行期問題（特別是 `renderer/vendor/pdfjs/` 那條
  > 動態 `import()` + Web Worker 的路徑——pdf 預覽功能完全沒有實機驗證
  > 過），再開始加新功能。

- **權威規格文件**：`PROJECT_SPEC.md`（完整最終狀態規格，每次加新
  功能都應該回頭補進對應章節，讓它永遠代表「目前最新」的樣貌）。
- **既有文件分工**：
  | 檔案                                  | 用途                                                                                                            |
  | ------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
  | `PROJECT_SPEC.md`                     | 目前為止的完整規格（唯一真相來源）                                                                              |
  | `BUILD_PLAN.md`                       | 原始 Stage 1～16（約到 `1.16.0`）的分階段施工藍圖，**之後的功能不會再往這裡加新 Stage**，僅供歷史參考           |
  | `CHANGELOG.md`                        | 逐版本紀錄「做了什麼」，**`1.17.0` 之後接續開發的第一站**                                                       |
  | `ROADMAP.md`                          | 明確排除的功能／未來可能方向                                                                                    |
  | `NEW_FEATURE_BUILD_PROMPT.md`（本檔） | 新功能開發提示詞模板                                                                                            |
  | `FIX_EXISTING_FEATURE_PROMPT.md`      | 既有功能修正提示詞模板                                                                                          |
  | `SPEC_ONLY_BUILD_PROMPT.md`           | 只附文件、不附原始碼時的提示詞模板                                                                              |
  | `CHECKLIST.md`                        | ⚠️ 舊草稿、階段命名跟目前 `BUILD_PLAN.md` 不一致，僅供歷史參考，**新開發不要照抄這份，以 `BUILD_PLAN.md` 為準** |

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
9. **內建預設值的「覆蓋安裝補種」一律用合併寫入**：任何新的「內建預設
   清單」（角色、知識庫提示詞／套餐、未來如果還有新的）記錄「已經種過
   哪些」都共用 `seeded-defaults.json` 這一個檔案，各自用自己的 key。
   **絕對不要用 `writeJSONSafe(seededDefaultsPath(), {...})` 整份覆蓋
   寫入**——這會把其他 key 洗掉（`1.36.0` 修正過兩次這個 bug，一次在
   升級補種路徑、一次在全新安裝路徑，兩次都是同一個錯誤模式）。一律呼叫
   `lib/stores.js` 的 `readSeededDefaultsRecord()`／
   `writeSeededDefaultsRecord(patch)`，由它負責讀出既有內容再合併寫回。
   新增補種邏輯之後，記得寫一個「呼叫順序互換」的回歸測試（見
   `test/roles-seeding.test.js` 的【回歸】系列），不要只測正向流程。
10. **只能在 renderer 跑（沒有 Node 環境）的瀏覽器函式庫，用
    `renderer/vendor/<套件名>/` 存放官方 prebuilt 檔案**，不要假設
    `node_modules` 裡的套件可以直接被 `renderer/*.js` 用 `<script src>`
    或 `import()` 載入——這裡沒有打包工具，`renderer/**` 下的每個檔案
    都是直接被瀏覽器讀取的最終檔案。對應的套件可以只放
    `package.json` 的 `devDependencies`（標註「只是用來複製檔案，執行期
    不需要」），不要放進 `dependencies` 膨脹實際打包體積（見
    `renderer/vendor/pdfjs/` 的 `pdfjs-dist` 範例）。main process 能用
    `require()` 的套件（`pdf-lib`／`mammoth`／`docx` 之類）才放
    `dependencies`。
11. **編輯已經存在、內容很大的種子資料 JSON（`default-*.json`）時，
    不要整份用 `JSON.parse` 讀出來、改完再 `JSON.stringify` 寫回去**，
    這會把整份檔案的換行符（這些檔案全部是 CRLF）跟 Prettier 既有的
    排版風格（例如短陣列保持單行）打散，產生一個幾百行、幾乎每行都
    「改了」的巨大 diff，審查困難、也容易在合併時衝突。改用純文字層級
    的字串拼接／插入（找到結尾的 `]`/`}` 位置，手動組出跟既有風格一致
    的新區塊文字，拼接進去），寫完一定要跑
    `git diff --stat <檔案>` 確認是純新增（只有 insertions、沒有大量
    deletions），`npx prettier --check <檔案>` 確認格式沒有被破壞。
12. **新增/調整大型內建參數清單（角色、知識庫、專案範本、選擇器…）
    之後，考慮是否要在對應管理畫面做「基本（內建）／延展（使用者自訂）」
    的分類顯示**，判斷方式優先用已經存在的穩定識別碼（角色的固定 `id`、
    知識庫項目的 `defaultId`）跟內建清單比對，不要另外新增一個
    `isBuiltIn` 布林欄位去維護兩份真相來源。這只是顯示分類，不代表
    「基本」的項目不能編輯或刪除。

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
2. **不需要在 BUILD_PLAN.md 新增 Stage**（這份文件從 Stage 16 之後就
   沒有再繼續編號，`1.17.0` 到現在的功能都只記在 PROJECT_SPEC.md／
   CHANGELOG.md，見前面「專案現況」的說明）。除非這次要做的事情規模
   大到等於新建一個全新子系統，否則直接進入下一步實作。
3. 依照上面的既有慣例（子視窗 helper、廣播 IPC、資料層 loadX/saveX、
   i18n、深色主題 CSS 變數、刪除連動清理懸空引用、內建預設值補種的
   合併寫入、renderer/vendor 存放瀏覽器專用函式庫、大型種子 JSON 用
   文字層級插入不要整份重新序列化、基本/延展分類顯示）實作程式碼，
   不要引入新的架構模式，除非既有模式明顯無法滿足需求（若是這種情況，
   先跟我說明原因跟你打算怎麼改，取得同意再動手）。
4. 完成後回頭更新 PROJECT_SPEC.md 對應章節（把新功能寫進「最終狀態」
   規格裡），並在 CHANGELOG.md 新增一筆版本紀錄（版本號規則：新功能
   minor +0.1.0，純修正 patch +0.0.1；同時記得同步更新 package.json
   的 version 欄位）。使用者可見的功能異動，三份 README（zh-TW／en／
   ja）對應的功能列表／檔案結構註記也要一併更新。
5. 如果這個功能牽涉備份／匯出格式，記得檢查是否要更新
   settings:exportBackup / importBackup 打包的物件內容，並在
   PROJECT_SPEC.md 第 13 節（IPC 事件總覽）或第 9.3 節（備份與還原）
   同步補上說明。
6. 寫新的 `lib/*.js` 純函式／資料異動邏輯時，比照既有風格在
   `test/*.test.js` 補對應的單元測試（不依賴 Electron 的部分可以直接
   `node --test`；需要 `app.getPath()` 等 API 的部分，比照
   `test/roles-seeding.test.js`／`test/projects-workflow-ipc.test.js`
   的做法，用假的 `electron` 模組＋暫存資料目錄）。完成後跑一次
   `npm test && npm run lint && npm run format:check` 全部過，再回報
   進度；沒有真正 Electron 畫面環境可以操作時，誠實在 CHANGELOG.md
   的「已知限制」註明「尚未實機驗證」，不要宣稱已經驗證過畫面行為。
7. 最後列出這次異動的驗證結果（測試數、lint/format 結果、有哪些地方
   還沒有實機驗證過）給我，我會實際操作驗證，確認沒問題才算完成，不要
   自己宣稱「完成」。

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
