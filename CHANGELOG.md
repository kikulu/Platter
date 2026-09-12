# Changelog

## [1.21.0]

### 整批套用 Prettier 排版

- 對整個專案跑了一次 `npm run format`（`prettier --write .`），純排版
  變動，不含任何邏輯修改。順便修掉這次一連串重構過程中不小心混進來的
  換行字元不一致問題：`.prettierrc.json` 設定 `endOfLine: "crlf"`，但
  之前用終端機工具新建/編輯的檔案（`main.js`、整個 `lib/**`、
  `.github/workflows/ci.yml`，以及少數用字串取代編輯過的既有檔案）都是
  純 LF 或 CRLF/LF 混雜，現在統一成 CRLF，跟專案其他檔案一致。
- `npm run format:check` 現在會回報「All matched files use Prettier
  code style!」。
- 驗證方式：排版前後都重新跑過 `npm run lint`（0 錯誤，
  `extractors/domCapture.js` 原本就有的 1 筆既有警告不受影響）跟
  `npm test`（17 個測試全過），確認純排版變動沒有改壞任何行為；也對每個
  `.js` 檔重新跑過 `node --check`，並在 mock 過 `electron` 的環境下重新
  `require` 過整條 `main.js`/`lib/ipc/**` 模組鏈，確認 80 個 IPC 頻道
  都還在。

## [1.20.0]

### 新增：GitHub Actions CI

- 新增 `.github/workflows/ci.yml`：`push`／`pull_request` 到 `main`
  分支時，在 Node `18.x`／`20.x` 兩個版本上各自跑一次
  `npm install`（設定 `ELECTRON_SKIP_BINARY_DOWNLOAD=1` 跳過 Electron
  平台安裝檔下載，因為 CI 只需要跑 lint/測試，不需要真的啟動 Electron
  App）→ `npm run lint` → `npm test`。
- **不含**實際啟動 Electron App 互動的測試：GitHub Actions 的 runner
  沒有顯示器，視窗操作永遠要靠 `npm start` 手動驗證（見
  `ROADMAP.md`「Stage 9～14 的手動驗證債務」）。
- 驗證方式：在本機實際跑過 `npm install`（同樣加
  `ELECTRON_SKIP_BINARY_DOWNLOAD=1`）→ `npm run lint`（0 錯誤，
  `extractors/domCapture.js` 原本就有 1 筆跟這次改動無關的既有警告）→
  `npm test`（17 個測試全過），確認 workflow 裡的指令組合真的會成功，
  不是只有 YAML 語法正確而已。另外用 Python `yaml.safe_load()` 驗證過
  `ci.yml` 本身的 YAML 語法。
- 詳見 `ROADMAP.md`。

## [1.19.0]

### 新功能：知識庫全文搜尋

- 知識庫視窗（提示詞／套餐兩個分頁）工具列新增搜尋框，輸入時即時篩選
  （`input` 事件，不用按 Enter），跟既有的標籤篩選下拉選單是 AND 關係，
  可以同時使用兩者縮小範圍。純前端記憶體內篩選，不需要新的 IPC 頻道。
- 提示詞項目比對範圍：標題、內容、標籤。
- 套餐比對範圍：標題、說明、標籤，另外也比對**套餐裡任一步驟引用的
  提示詞標題**——這樣可以直接搜某個提示詞的名字，找出它被用在哪些套餐
  裡，不用一個個套餐點開檢查步驟清單。
- 篩選後完全沒有符合的項目時，清單顯示「沒有符合搜尋條件的項目」，跟
  「這個分頁本來就還沒建立任何項目/套餐」的空狀態提示區分開來，避免
  誤導使用者以為清單本身是空的。
- 新增 `knowledge.searchPlaceholder`／`knowledge.searchNoResult` 兩組
  i18n 字串（zh-TW / en）。
- 詳見 `PROJECT_SPEC.md` 第 5.1 節。
- 驗證方式：`node --check` 語法檢查、兩份 locale JSON 格式驗證。這是純
  前端功能，沒有改動任何 IPC 或主程序邏輯，受限於純文字環境沒有真正
  視窗可以操作，建議實機開知識庫視窗、建幾筆測試資料後手動確認搜尋跟
  標籤篩選同時使用時的行為符合預期。

## [1.18.0]

### 新功能：選擇器「測試擷取」預覽

- 「設定 → 選擇器設定」新增「測試擷取」按鈕：不用先按「儲存」，直接用
  表單裡目前填的 selector 值，對「目前選擇的這個平台」跑一次真正的
  `extractors/domCapture.js` 擷取，結果就地顯示在設定視窗裡——成功的話
  列出擷取到的訊息數量與前 5 則預覽（🧑/🤖 + 截斷文字），失敗的話顯示
  錯誤原因跟 `matchedNodeCount`/`nonEmptyMessageCount` 診斷數字，不用真的
  匯出成檔案就能反覆調整、確認 selector 抓得對不對。
- 會優先用「目前作用中的帳號」（如果剛好是選擇的那個平台），不是的話
  找第一個開著的同平台帳號；一個都沒開會提示先新增/切換帳號，不會誤用
  其他平台的頁面去測試。
- 新增 IPC 頻道 `settings:testCaptureSelector`（`lib/ipc/settings.js` →
  `lib/conversationCapture.js` 新增的 `testCaptureSelector()`）。刻意
  **不寫檔、不登記文件庫、不記錯誤/稽核日誌**：調整 selector 本來就會
  反覆試錯，每次失敗都記錄只會洗版日誌表、稀釋掉真正該注意的錯誤。
- 新增 `settings.selectors.testCapture` 等 9 組 i18n 字串（zh-TW / en）。
- 詳見 `PROJECT_SPEC.md` 第 10 節「選擇器設定與滑鼠選取工具」。
- 驗證方式：對修改到的每個檔案跑 `node --check`；在 mock 過 `electron`
  的 Node 環境下重新跑一次 IPC 頻道註冊，確認新頻道存在、且原本 79 個
  頻道都還在（沒有改壞既有功能）；JSON 格式驗證兩份 locale 檔。受限於
  純文字環境沒有真正的視窗可以操作，仍建議實機開一個 Claude/ChatGPT 帳號
  後手動點一次「測試擷取」，確認畫面顯示如預期。

## [1.17.0]

### 重構：main.js 模組化

- `main.js` 原本是單一檔案、逼近 2200 行，拆成 `lib/**` 底下 17 個依
  職責分組的模組：`constants`（靜態設定值）、`state`（共用可變狀態單例）、
  `dataDir`（DATA_DIR 讀寫）、`broadcast`（跨視窗同步）、`console`（主控台
  攔截）、`logs`（錯誤/稽核日誌）、`stores`（各資料檔 loadX/saveX）、
  `windows`（視窗與帳號 View 管理）、`conversationCapture`（對話擷取/匯出）、
  以及 `lib/ipc/` 底下依業務領域拆開的 8 個 IPC handler 註冊檔。
  `main.js` 現在只剩 App 生命週期本身（單一實例鎖、`whenReady`、視窗全關/
  啟用），約 70 行。
- **這是純內部重構，沒有新增或改變任何使用者可見的行為**：所有 79 個
  IPC 頻道名稱、參數、回傳值都原樣保留，只是搬到不同檔案；跨模組共用的
  可變狀態集中放進 `lib/state.js` 這個單例物件，避免拆檔案後各模組各自
  持有一份過期的參照。
- 驗證方式：對每個新檔案跑 `node --check` 語法檢查；在 mock 過
  `electron` 模組的 Node 環境下實際 `require` 整條模組鏈與 `main.js`，
  確認沒有循環依賴、匯出缺漏、`__dirname` 相對路徑算錯的問題；並用
  腳本比對重構前後 `ipcMain.handle`/`ipcMain.on` 註冊的頻道名稱清單，
  確認 79 筆完全一致。受限於這是純文字環境、沒有實際視窗可以操作，
  仍建議實機跑一輪 `npm start`，把主視窗、8 個子視窗、帳號新增/切換/
  匯出對話都操作一次再放心發布。
- 詳見 `PROJECT_SPEC.md` 第 15 節「檔案結構」新增的 `lib/**` 模組共用慣例
  說明（狀態集中在 `state.js`、`broadcast.js` 刻意不依賴其他模組以避免
  循環依賴、IPC handler 只做註冊不塞商業邏輯）。

## [1.16.0]

### 新增：帳號清單拖曳排序

- 側邊欄帳號清單每個項目現在可以直接拖曳調整順序（原生 HTML5 drag &
  drop，沒有引入額外套件）：拖曳中的項目半透明顯示，滑鼠懸停的目標
  項目用頂部藍色邊框標示「放開後會插入這裡」。
- 新增 `accounts:reorder` IPC，把拖完之後的新順序整份寫回
  `app-state.json`（重開 App 順序還在）；角色下拉選單、目前作用中帳號、
  側邊欄「預設提示詞」等功能都是用帳號 id 查找，不受排序影響。
- 角色下拉選單、刪除按鈕都設定 `draggable="false"`，避免點擊這些控制項
  被誤判成拖曳排序的起手勢。

## [1.15.0]

### 新增：App 版本號顯示

- 主視窗側邊欄「設定」按鈕下方新增一行小字顯示目前版本號（側邊欄摺疊
  成純 icon 版時自動隱藏）；設定視窗最下面新增「關於」區塊，顯示完整
  版本號文字，語言切換時同步更新格式。
- 新增 `app:getVersion` IPC，直接讀 `app.getVersion()`（本質上就是
  `package.json` 的 `version`），不用在畫面上寫死版本字串。

### 修正：Windows 安裝程式預設路徑改到使用者應用程式資料夾

- `package.json` 新增 `build.nsis` 設定：`perMachine: false` 讓安裝程式
  預設安裝到 `%LOCALAPPDATA%\Programs\Platter`（使用者自己的 AppData
  底下），不再是需要系統管理員權限的 `C:\Program Files\Platter`；
  `oneClick: false` 顯示正常安裝精靈（不是靜默一鍵安裝）；
  `allowToChangeInstallationDirectory: true` 讓使用者仍然可以自己選
  別的安裝路徑；順便加上桌面/開始選單捷徑設定。單機單人的桌面工具沒有
  必要要求 UAC 提權，per-user 安裝也能降低使用者裝在權限受限資料夾、
  之後遇到檔案存取被拒這類問題的機率。

## [1.14.0]

### 新增：知識庫／對話庫可以匯入現成的 Markdown 檔案

- 知識庫「提示詞」分頁新增「匯入 Markdown」按鈕（切到「套餐」分頁時
  自動隱藏），對話庫新增「匯入 Markdown 檔案」按鈕：都可以一次多選
  `.md`/`.markdown`/`.txt` 檔案，每個檔案直接變成一則新項目（檔名去掉
  副檔名當標題、檔案全文塞進內容），不用手動複製貼上。
- 跟「擷取目前對話」不同，這個匯入動作**不會先預覽**——因為內容就是
  使用者自己選的既有檔案，直接寫進資料檔；匯入完自動把最後一個匯入的
  項目打開在編輯器裡，方便馬上檢視/編輯內容。
- 新增 `knowledge:importMarkdown`／`conversations:importMarkdown` 兩個
  IPC，個別檔案讀取失敗會記進錯誤日誌（`logError`），不會讓整批匯入
  卡住；成功匯入至少一個檔案會記一筆稽核紀錄。
- 這是跟既有「匯入」（知識庫 JSON 備份格式）完全獨立的新按鈕，處理
  不同的檔案格式，UI 上刻意分開，避免混淆。
- `BUILD_PLAN.md` 新增 Stage 14；`PROJECT_SPEC.md` 第 5、8.5 節同步補上
  說明。

## [1.13.0]

### 新增：日誌主控台改用 SQLite（sql.js）

- 「日誌主控台」的錯誤日誌/稽核日誌從 `logs.json` 改存進 `logs.sqlite`
  （用 `sql.js`——純 WebAssembly 版 SQLite，沒有原生模組，不需要
  `electron-rebuild`，選型取捨詳見 `PROJECT_SPEC.md` 第 9.7 節）。
- 新增 `lib/sqlite.js`：包裝 sql.js 的最小存取介面
  （`openDatabaseFile`/`saveDatabaseFile`/`queryAll`），之後其他模組要
  加 SQLite 表可以直接重用。
- 新增 `test/sqlite.test.js`：涵蓋開檔建表、寫入、依時間戳裁剪到上限
  筆數、清除、關檔重開後資料還在、從舊版 `logs.json` 搬遷資料共 5 項
  測試，`npm test` 現在共 17 項全過。
- **自動搬遷**：第一次用新版啟動時，如果偵測到舊版的 `logs.json` 而且
  新資料庫是空的，會自動把舊資料搬進 `logs.sqlite`，舊檔改名成
  `logs.json.migrated` 留底，不會讓使用者原本的日誌歷史憑空消失。
- 每次寫入日誌都會立刻把整個資料庫匯出存檔（sql.js 的資料庫整個活在
  記憶體裡，沒有落地存檔這個動作資料就只存在記憶體），退出前也補存一次
  當保險。

### 修正：electron-builder 打包設定漏掉 `lib/**/*`

- `package.json` 的 `build.files` 陣列一直沒列到 `lib/` 資料夾，
  `main.js` 卻用 `require('./lib/utils')`／現在也用
  `require('./lib/sqlite')`——這代表照舊設定打包出來的成品，理論上啟動
  就會直接噴 `Cannot find module './lib/...'` 崩潰（開發時因為都用
  `npm start` 跑原始碼、沒有經過打包，一直沒發現）。這次一併修正，並
  排除 `node_modules/sql.js/dist/` 裡用不到的 asm.js/worker/browser
  變體跟壓縮包，減少打包體積。

## [1.12.0]

### 修正：App 啟動時 Chromium 磁碟快取錯誤（`disk_cache` / `quota_database`）

- 新增單一實例鎖（`app.requestSingleInstanceLock()`）：兩個 Platter 進程
  同時指向同一個 `userData` 資料夾，共用同一份 Chromium 磁碟快取時，其中
  一個對快取檔案的讀寫會被另一個鎖住，這是 `Unable to create cache` /
  `Unable to move the cache`（Windows 常見錯誤碼 `0x5`）/ `Could not open
the quota database, resetting` 這類錯誤最常見的成因。現在拿不到鎖的
  進程會直接退出，並把已經開著的視窗 focus 過去。
- 「設定 → 設定檔存放位置」切換/還原後「立即重新啟動」的流程，把
  `app.exit()`（立刻強制終止，跳過正常收尾）改成 `app.quit()`（正常關閉
  流程），避免 Chromium 的磁碟快取/quota 資料庫在強制終止時來不及正常
  關閉、留下髒狀態，導致下次啟動又跳這類錯誤。
- 新增「設定 → 疑難排解 → 清除快取」：只清 HTTP 快取
  （`session.clearCache()`），不會登出任何帳號、不會刪除文件/專案/對話
  等資料，讓使用者自己就能嘗試修復快取問題，不用整個刪掉資料夾重灌。

## [1.11.0]

### 修正：對話匯出失敗完全沒有記錄

- 「匯出當前對話」跟「對話庫 → 匯出檔案」失敗時，現在會記一筆
  `conversation` / `exportFailed` 稽核紀錄，並在 `logError` 留一筆對應的
  錯誤日誌；寫檔本身失敗（例如權限不足）也補了 try/catch + `logError`。
  之前這類失敗只會跳一次 alert 就消失，日誌主控台裡完全查不到發生過
  什麼事。

### 新增：日誌主控台加入「主控台」分頁（即時 console 輸出）

- 新增一個「主控台」分頁：即時攔截 main process 的
  `console.log/info/warn/error`，逐行显示成終端機風格的即時輸出，只存在
  記憶體（上限 300 筆，不落地存檔、不算進備份），有「自動捲動」開關跟
  「清除主控台」按鈕。
- 每個帳號的 `WebContentsView` 現在會把自己的 `console-message`（頁面
  自己噴的 JS 錯誤/警告）跟 `did-fail-load`（頁面本身載入失敗）都轉送進
  這個即時主控台，不用另外開 DevTools 也能看到頁面發生什麼事。
- 新增 `console:list` / `console:clear` IPC 跟 `console:entry` 即時事件。

### 修正：對話擷取失敗診斷資訊不足（「各 AI 平台還是不能匯出對話」）

- `extractors/domCapture.js` 的擷取結果現在一律帶
  `debug: { selectorUsed, matchedNodeCount, nonEmptyMessageCount,
pageUrl }`：`matchedNodeCount = 0` 代表 selector 本身沒選到任何節點
  （網站 DOM 結構跟預設值對不上，需要用「設定 → 選擇器設定」重新框選）；
  `matchedNodeCount > 0` 但 `nonEmptyMessageCount = 0` 代表選到的是空容器
  而不是實際訊息氣泡。
- 每次擷取都會印一行完整診斷到主控台，失敗時額外記一筆錯誤日誌；「匯出
  當前對話」跟「對話庫 → 擷取目前對話」失敗時彈出的提示視窗也直接顯示
  這組診斷數字，不用特地開日誌視窗才看得到「到底是完全沒選到、還是選到
  空的」。
- 這類問題的根本原因是各 AI 平台網站的 DOM 結構會隨時間改版，寫死在
  `extractors/default-selectors.json` 的預設 selector 本來就無法保證長期
  有效；本次沒有猜測性地改動預設 selector 內容（沒有實際即時的頁面可以
  驗證），而是把診斷資訊做到位，讓使用者可以透過「設定 → 選擇器設定」
  的滑鼠選取工具，針對當下真正的頁面重新產生正確的 selector。

## [1.10.0]

### 新增：跨專案總覽（補完 1.9.0 的功能）

- 專案計畫視窗左側工具列新增「跨專案總覽」按鈕，把所有專案的月曆／
  甘特圖／Issue 疊在一起看（唯讀彙總畫面，資料來源是已存檔的專案，正在
  編輯中還沒儲存的變更不會出現）。
- 每個專案依序分配一個固定顏色，月曆色點、甘特圖色塊左側色條、Issue
  列表色點都用這個顏色標示來源專案；上方有圖例，點圖例或任一項目都能
  直接跳回該專案的編輯畫面（並自動切到對應分頁）。

### 新增：日誌主控台（錯誤日誌／稽核日誌）

- 側邊欄「內容工具」群組新增「日誌主控台」按鈕，開新視窗，兩個分頁：
  - **錯誤日誌**：main process 原本只寫進終端機的 `console.error`（擴充
    功能載入失敗、對話擷取失敗、選取器工具失敗、文件匯入/刪除失敗等）
    改成同時寫進 `logs.json`；另外掛了 `process.on('uncaughtException'/
'unhandledRejection')`，main process 任何沒被接住的例外也會自動記
    錄，不會只留在終端機。可依來源篩選、關鍵字搜尋，帶堆疊的項目可點開
    展開完整 stack trace。
  - **稽核日誌**：記錄關鍵動作——帳號新增/移除、專案建立/刪除、文件
    匯入/刪除、對話新增/刪除/匯出、備份匯出/匯入、設定檔存放位置搬遷、
    擴充功能安裝/移除，`detail` 直接是組好的可讀中文說明。可依類別篩選、
    關鍵字搜尋。
  - 兩種日誌各自最多保留最新 500 筆，超過自動裁掉最舊的；各自可以獨立
    「清除」（會問確認）；「匯出日誌」可把目前完整內容存成一份 JSON 檔。
  - 新增 `logs:list` / `logs:clear` / `logs:export` IPC，`logs:changed`
    事件供視窗即時刷新；不納入 `settings:exportBackup` 備份範圍（日誌是
    診斷用的執行紀錄，不是使用者資料）。

## [1.9.0]

### 新增：專案計畫加入月曆、甘特圖、Issue 管理

- 專案編輯畫面新增分頁：**任務清單／月曆／甘特圖／Issue 管理**，四個
  分頁共用同一份還沒儲存的編輯狀態，切分頁不會遺失正在編輯的內容。
- 任務新增 `startDate`（開始日期）欄位，跟原本的 `dueDate`（到期日）
  一起用在月曆與甘特圖上。
- **月曆檢視**：月曆格子用小圓點標示當天到期的任務（顏色對應任務狀態）
  與 Issue（顏色對應優先度），點任一天可在下方看到當天到期項目的明細；
  「‹ › 回到今天」切換月份。
- **甘特圖**：取任務的開始/到期日畫成橫向色塊時間軸，色塊顏色對應任務
  狀態，表頭標出月份分界，並畫一條「今天」豎線；純 CSS/DOM 實作，沒有
  引入額外圖表函式庫，也不支援拖曳調整日期。沒有任何任務帶日期時顯示
  提示文字。
- **Issue 管理**：每個專案有自己獨立的 issue 清單（`project.issues`），
  欄位含標題、描述、類型（錯誤/功能/任務/改善）、優先度（低/中/高/
  緊急）、狀態（待處理/處理中/已解決/已關閉）、指派對象、到期日、標籤；
  行內可編輯卡片（跟任務清單同一種操作模式），可依狀態篩選；狀態切換
  透過新增的 `projects:issue:setStatus` IPC 即時持久化。左側專案清單會
  顯示每個專案「待處理 + 處理中」的 issue 數量。
- `projects.json` 資料結構新增 `issues` 陣列（沿用 `tasks` 的正規化/
  預設值模式），備份與還原同步支援。

## [1.8.0]

### 新增：對話庫（`conversation.html`）

- 新視窗（側邊欄「內容工具」群組，新增「對話庫」按鈕開啟），新增
  `conversations.json` 資料檔：`{ id, title, tags, content(Markdown),
sourceAccountId, sourcePlatform, linkedDocumentIds, createdAt,
updatedAt }`。
- **新增對話 Markdown**：可「新增對話」手動輸入標題/標籤/貼上或編寫
  Markdown 內容；也可「擷取目前對話」重用既有的 DOM 擷取機制
  （`captureCurrentConversation` + `toMarkdown`）把目前作用中帳號畫面上
  的對話直接轉成 Markdown 帶入編輯器（只是預填內容、不會立刻寫檔），
  方便擷取後再編輯、加標籤，接著按「儲存」持久化。
- **匯出檔案**：可將一則對話匯出成 Markdown 或 JSON 檔案（沿用「使用
  預設路徑時不再詢問」設定），匯出成功後自動把檔案登記進第 8 節「文件
  管理」，並自動把新登記的文件 id 加進這則對話的 `linkedDocumentIds`。
- **將檔案與文件庫的文件檔案對應關聯**：編輯器「關聯文件」區塊可從文件
  庫既有的檔案裡手動選擇建立關聯（多對多），也可以「取消關聯」；文件
  被移除時，對話庫裡任何引用到它的關聯會一併清掉，避免懸空引用。
- 備份與還原（`settings:exportBackup` / `settings:importBackup`）同步
  支援對話庫資料，已存在的 id 略過，不覆蓋使用者後續的編輯。

## [1.7.0]

### 新增：真正可用的 `npm test` / `npm run lint` / `npm run format`

- 之前 `README.md` 的「開發」「貢獻」段落就已經寫著 `npm test`、
  `npm run lint`（還有藏在 HTML 註解裡、沒有渲染出來的 `npm run format`
  跟 GitHub Actions CI 說明），但 `package.json` 其實完全沒有對應的
  scripts，也沒有任何測試/lint/格式化設定檔——文件跟實際專案狀態不一致。
  這次把這幾個工具**真的做出來**，而不是只改文字騙過檢查：
  - 新增 `lib/utils.js`：把 `main.js` 裡不依賴 Electron API 的純函式
    （`genId`、`ensureUniqueFilePath`、`toMarkdown`、
    `deriveSelectorFromSamples`）抽出來，`main.js` 改成
    `require('./lib/utils')` 使用，行為完全不變。
  - 新增 `test/utils.test.js`，用 Node.js 內建的 `node:test` +
    `node:assert`（不需要額外安裝測試框架），涵蓋上述四個函式的正常
    案例與邊界案例，12 個測試全部通過。
  - 新增 `.eslintrc.json`（ESLint 8，`eslint:recommended`
    為基礎；`main.js`/`preload.js`/`lib/**`/`test/**` 用 Node 環境規則，
    `renderer/**` 用瀏覽器環境規則，`extractors/domCapture.js` 與
    `extractors/selectorPicker.js` 因為是被注入到第三方頁面執行的樣板
    程式碼，關閉 `no-undef`）。
  - 新增 `.prettierrc.json`（貼近現有程式碼風格：單引號、有分號、CRLF
    換行），並補上 `npm run format` / `npm run format:check` 兩個
    scripts。**目前只驗證過腳本本身能正確執行，沒有對整個專案跑過一次
    強制格式化**（那會產生大量非功能性 diff，刻意留給後續獨立處理，
    避免混進這次的修正裡）。
  - `package.json` 新增 `test`/`lint`/`format`/`format:check` 四個
    scripts，`devDependencies` 補上 `eslint`、`prettier`。

### 修正：`deriveSelectorFromSamples` 誤用瀏覽器專屬 API 導致的潛在崩潰

- 在幫 `deriveSelectorFromSamples` 補單元測試時發現：原本的實作用了
  `CSS.escape` 來跳脫樣本元素的 `id`，但這段程式碼實際執行在 Electron
  **主程序**（Node.js 環境），並沒有 `CSS` 這個全域物件——一旦使用者用
  「滑鼠選取範例」工具選到一個帶有 `id` 屬性的訊息元素，就會丟出
  `ReferenceError: CSS is not defined`，整個選取流程會失敗。
- 已改成 `lib/utils.js` 裡不依賴瀏覽器 API 的 `escapeCssIdentifier()`
  手刻實作，行為對「一般字元」沒有變化，只是不再依賴不存在的全域物件；
  新增對應的回歸測試（`test/utils.test.js` 裡帶有 id 的樣本案例）避免
  之後再度引入同樣的問題。

### 修正：`extractors/domCapture.js` 的 `no-inner-declarations` 問題

- 導入 ESLint 之後抓到 `isUserMessage` 是在 `try` 區塊內用
  `function isUserMessage(el) {...}` 宣告，屬於區塊內函式宣告，在不同
  JS 引擎的行為可能不一致。改成 `const isUserMessage = function (el) {
... }` 函式表達式，執行順序與行為完全不變（原本就是先宣告、後在同一個
  區塊內使用，不依賴 hoisting）。

### 文件：`CHECKLIST.md` 標記為棄用

- `CHECKLIST.md` 是專案早期的草稿式檢核表，階段編號/內容跟現行
  `BUILD_PLAN.md`（8 階段、已全部驗收）對不起來，且從建立以來所有檢核框
  都沒有被更新過。已在檔案開頭加上明確的棄用警示並指向正確的替代文件
  （`BUILD_PLAN.md`/`PROJECT_SPEC.md`/`NEW_FEATURE_BUILD_PROMPT.md`/
  `FIX_EXISTING_FEATURE_PROMPT.md`），暫不刪除以保留歷史紀錄。
- `README.md` 的「文件索引」表格移除 `CHECKLIST.md` 這一列，改為列出
  `NEW_FEATURE_BUILD_PROMPT.md` 與 `FIX_EXISTING_FEATURE_PROMPT.md`
  （新增功能／修正既有功能兩種情境各自的提示詞模板）；「開發」段落的
  文字同步更新成跟實際腳本行為一致，並移除還沒真的建置的 GitHub Actions
  CI 說明（改記錄在 `ROADMAP.md` 當作未來可能方向）。

### 新增文件

- `NEW_FEATURE_BUILD_PROMPT.md`：8 階段建置計畫完成後，要繼續加新功能時
  使用的提示詞模板，內含既有慣例清單與可直接複製貼上的提示詞本體。
- `FIX_EXISTING_FEATURE_PROMPT.md`：修正既有功能問題時使用的提示詞
  模板，強調「先判斷是程式碼錯還是規格描述錯」「不要順手改無關程式碼」。

## [1.6.1]

### 修正：知識庫/備份還原的即時刷新事件遺漏

- 對照 `BUILD_PLAN.md` 檢核表逐項驗證現有實作時發現：
  1. `knowledge:toggleChecklistEntry`、`knowledge:group:save/delete/
toggleStep/resetChecklist` 沒有廣播 `knowledge:changed`，已補上。
  2. `settings:importBackup` 還原備份時會改動知識庫/專案/文件庫，但只
     廣播了 `accounts:changed`，已補上 `knowledge:changed` 與
     `documents:changed`；同時修正還原知識庫項目時 `roleIds` 缺少預設值
     的問題。
- 新增 `PROJECT_SPEC.md`（完整專案規格，可供其他 AI 重現整個專案）與
  `BUILD_PLAN.md`（拆成 8 個階段的建置計畫，每階段附可操作的檢核表，
  並記錄本次對照現有程式碼的驗證結果）。

## [1.6.0]

### 新增：側邊欄「預設提示詞」區塊 + 知識庫提示詞的角色配置

- 知識庫提示詞項目編輯器新增「角色配置」區塊：勾選這個提示詞要當成
  哪些角色（沿用帳號角色機制）的預設提示詞，一個提示詞可以同時配置給
  多個角色，一個角色也可以配置多組預設提示詞。存在 `item.roleIds`。
- 側邊欄新增「預設提示詞」群組（在「帳號」群組之後），會依「目前選中
  帳號」的角色，自動列出該角色配置的所有預設提示詞，每一則旁邊有個
  複製按鈕（⧉），點一下就把提示詞內容複製到剪貼簿，方便貼到對話框
  裡使用。
  - 目前帳號沒有指定角色、或該角色還沒配置任何預設提示詞時，會顯示
    對應的引導文字。
  - 切換帳號、在知識庫編輯提示詞的角色配置、或在設定裡刪除角色時，
    這個區塊都會即時刷新（新增 `knowledge:changed` 廣播事件）。
- 角色被刪除時，除了原本會清掉帳號的角色指定，現在也會一併移除知識庫
  項目裡對這個角色的「角色配置」引用，不留下懸空 id。
- 側邊欄多層清單的群組展開狀態新增 `prompts` 這個群組，預設展開。

## [1.5.0]

### 變更：側邊欄改為多層可收合清單

- 側邊欄從一排平面按鈕改成「群組標題 + 可展開/收合子項目」的兩層清單：
  - **帳號**：新增帳號、帳號清單
  - **內容工具**：匯出當前對話、知識庫、文件管理
  - **團隊與專案**：虛擬團隊、專案計畫
  - 「設定」仍固定在最底部，不放進可收合群組。
- 每個群組標題可點擊展開/收合（chevron 圖示會跟著轉向），展開狀態存進
  `app-state.json`（`ui.sidebarGroups`），重開程式會記住上次的狀態；新增
  `ui:setGroupExpanded` IPC。
- 整個側邊欄摺疊成 56px 純 icon 版時（既有機制），會忽略各群組的展開/
  收合狀態，一律攤平顯示成單層 icon 列表，維持原本「摺疊側邊欄」的
  緊湊操作體驗不受影響。

## [1.4.0]

### 新增：文件管理（儲存對話中產生的文件或檔案的管理庫）

- 新視窗 `documents.html`（側邊欄「文件管理」按鈕開啟），新增
  `documents.json` 中繼資料檔 + `documents/` 檔案存放資料夾（都在
  DATA_DIR 底下，跟著設定檔存放位置一起搬移）。
- 兩種收錄方式：
  1. **自動登記**：每次「匯出當前對話」成功後，自動把匯出的檔案登記
     進文件庫（只記錄路徑引用，不複製，因為檔案已經在使用者選擇/預設
     的儲存位置），並帶入來源帳號、平台、以平台名稱當標籤。
  2. **手動匯入**：「匯入檔案」可一次選取多個任意檔案（程式碼、圖片、
     PDF 等），複製一份到文件庫的管理資料夾裡妥善保存（`managed: true`），
     不受原始檔案被移動/刪除影響。
- 每份文件可編輯名稱、標籤、備註；顯示原始檔名、來源（平台 + 帳號）、
  大小、建立時間、路徑；「開啟檔案」（`shell.openPath`）、「在資料夾中
  顯示」（`shell.showItemInFolder`）。
- 找不到原始檔案時（被移動/刪除）清單與詳細頁都會顯示「檔案遺失」警示，
  不會讓程式出錯。
- 移除文件時，若是「已管理」的複本，會另外詢問是否連同實體檔案一起刪除，
  或只移除紀錄保留檔案。
- 備份與還原同步支援文件庫中繼資料（已存在的 id 略過）；注意還原到不同
  機器/資料夾時，「已管理」複本的檔案本體不會被還原（本來就不打包實體
  檔案，只還原紀錄），會顯示為「檔案遺失」，需要重新匯入。

## [1.3.0]

### 新增：虛擬團隊主控台

- 新視窗 `team.html`（側邊欄「虛擬團隊」按鈕開啟）：把帳號依「角色」
  （沿用既有帳號角色機制）分組顯示成組織圖 —— 頂端「虛擬團隊」節點，
  下方一排角色欄位，每欄底下是套用該角色的帳號卡片；沒有角色的帳號
  歸在「未指派角色」欄位。
- 每張帳號卡片內嵌角色下拉選單，可直接在主控台重新指派角色
  （沿用 `accounts:setRole`），不用另外開設定視窗。
- 提供「新增帳號」「管理角色」快捷按鈕。

### 新增：專案計畫管理

- 新視窗 `project.html`（側邊欄「專案計畫」按鈕開啟），新增 `projects.json`
  資料檔：`project { id, name, description, status, startDate, endDate,
tasks: [...] }`、`task { id, title, assigneeId, status, dueDate }`。
- 左側專案清單（含狀態徽章與任務完成度）、右側編輯表單：名稱/狀態
  （規劃中/進行中/暫停/已完成）/起訖日期/說明，以及任務清單（可新增、
  行內編輯標題、指派給團隊裡的帳號、設定到期日、移除）。
- 任務狀態（待辦/進行中/已完成）切換即時透過 `projects:task:setStatus`
  持久化，不用等按「儲存專案」；結構性變更（新增/移除/編輯任務內容）
  才需要按儲存。
- 備份與還原（`settings:exportBackup` / `settings:importBackup`）同步支援
  專案資料，匯入時已存在的專案 id 略過。

## [1.2.0]

### 新增：帳號角色機制

- 角色是可重複套用到多個帳號的共用定義：`{ id, name, description, color }`，
  `description` 可當成角色提示詞 / system prompt 使用。
- 設定視窗新增「帳號角色管理」區塊：新增/編輯/刪除角色、8 色色票、
  「複製提示詞」一鍵複製角色描述到剪貼簿方便貼到平台的自訂指令欄位。
- 新增帳號視窗（`account.html`）加入「角色（可選）」下拉選單，建立帳號
  時可直接指派角色。
- 側邊欄帳號項目：
  - 頭像用角色顏色描邊，一眼識別帳號角色。
  - 內嵌一個小型角色下拉選單，不用開設定視窗就能直接切換/移除帳號的
    角色（`accounts:setRole` IPC，即時持久化並廣播 `accounts:changed`）。
- 角色被刪除時，原本套用它的帳號自動改回「無角色」，不留下懸空引用。
- 備份與還原（`settings:exportBackup` / `settings:importBackup`）同步支援
  角色資料，匯入時已存在的角色 id 略過。

## [1.1.0]

### 新增：知識庫 —— 群組順序提示詞套餐 + 檢核表機制

- 知識庫視窗新增「提示詞 / 套餐」分頁切換。
- **群組順序提示詞套餐**：可將多個已存在的提示詞項目依指定順序組成一個
  「套餐」（`groups`），每個套餐有名稱、說明、標籤，內含依序排列的
  `steps`（可用 ↑↓ 調整順序、單步複製、移除）。「複製全部內容」會依序
  串接所有步驟的提示詞內容（以 `---` 分隔）。
- **檢核表機制**（雙重應用）：
  1. 套餐裡每個步驟都有一個勾選框，用來追蹤「這個步驟是否已經使用/
     完成」，勾選狀態即時透過 IPC 持久化（不用等按「儲存套餐」），並提供
     「重置進度」讓使用者下次重新走一輪流程。
  2. 單一提示詞項目也能自帶一份獨立檢核表（例如「發布前檢查清單」），
     可新增/勾選/移除檢核項目，隨項目一起儲存。
- 知識庫資料結構由純陣列改為 `{ items, groups }`，`loadKnowledgeBase()`
  自動相容舊版只有 `items` 陣列的資料檔。
- 匯出全部（Markdown/JSON）與匯入、備份/還原都同步支援套餐與檢核表；
  匯入時套餐 `steps` 裡的 `itemId` 會依新舊 id 對照表自動轉換，找不到
  對照的步驟會被捨棄（不留下懸空引用）；項目被刪除時，任何套餐裡引用
  到它的步驟也會一併移除。

## [1.0.0]

### 新增

- 主視窗左側側邊欄，可摺疊為純 icon 版（220px / 56px）。
- 每個帳號使用 `session.fromPartition('persist:<accountId>')` 完全隔離
  Cookie / LocalStorage / IndexedDB，並用 `WebContentsView` 疊加顯示。
- 新增 / 切換（`setVisible`，不銷毀 view）/ 刪除帳號（含垃圾桶 icon
  hover 顯示、確認對話框）。
- 帳號清單持久化（`app-state.json`，僅存 id / platform / name，不含登入
  資料）。
- 「新增帳號」「知識庫」「設定」由疊在主視窗裡的彈窗改為三個獨立的
  `BrowserWindow`（`parent` 但非 `modal`），解決 `WebContentsView` 疊層
  蓋住彈窗、鍵盤焦點遺失的問題。共用 `openChildWindow()` helper。
- 知識庫：兩欄式版面、標籤篩選、複製內容、匯出（Markdown/JSON）、匯入
  （JSON，重新產生 id、不覆蓋既有項目）。
- 設定：語言切換、設定檔存放位置搬移（含重啟確認）、擴充功能管理
  （僅限已解壓縮格式，即時套用到所有已開啟的帳號 session）、檔案預設
  儲存路徑與略過存檔對話框（含檔名衝突處理）、備份與還原、選擇器設定
  （含滑鼠選取工具，自動比對兩個範例產生 selector）、疑難排解
  （開啟 DevTools）。
- 多國語系（繁體中文 / English），`renderer/i18n.js` 共用於所有視窗。
- 對話擷取邏輯（`extractors/domCapture.js`）不內建任何 selector，一律由
  `selectors.json` 讀出後當參數傳入，只讀取當前 DOM。

### 設計決策記錄

- 彈窗改成獨立視窗而非疊在主視窗裡：`WebContentsView` 是原生疊層，不受
  CSS z-index 控制。
- 子視窗 `modal: false`：modal 視窗會在 OS 層級鎖住主視窗，跟「滑鼠選取
  selector」這種需要切回主視窗互動的功能會衝突。
