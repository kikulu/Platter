# Changelog

## [1.47.0]

專案範本匯入／匯出提到「專案計畫」這一層（專案清單左側），改善介面，並新增多檔批次匯入（檔案對話框多選＋整個視窗拖拉）。同時補完上一版遺留的「匯出範本」功能。

### 入口與介面

- **不用先進「從範本建立」**：專案清單工具列（新增專案／從範本建立／跨專案總覽）下方新增「專案範本」區：
  - 「匯入範本檔」：虛線框的點擊／拖放區（圖示＋說明文字），點擊開檔案對話框。
  - 「匯出全部自訂範本」。
  - 原本在範本選擇頁底部的匯入／匯出按鈕移除（該頁只剩「取消」「建立專案」）。
- **單一範本匯出**：範本卡片右上角新增 ↥ 按鈕（內建與自訂範本都有），匯出該範本。
- **拖拉匯入**：把一個或多個 `.json` 拖進專案視窗的任何位置，拖著檔案時整個視窗蓋上「放開滑鼠以匯入範本檔」提示遮罩
  （只處理檔案拖曳，拖文字不理會；一律 `preventDefault`，避免 Electron 把視窗導向被放開的檔案）。
- **匯入結果面板**：範本選擇頁上方顯示總數（幾個範本、幾個檔案、略過幾個無效範本）與逐檔結果（✓ 匯入 N 個／✕ 失敗原因），可關閉；
  成功時自動選取第一個新範本。失敗原因分 5 種：不是有效範本檔／超過 10 MB／沒有可用範本／不是 .json／無法讀取。
- **不打斷編輯**：拖拉時若正在編輯專案或看跨專案總覽，不會跳頁，改在底部顯示通知列（附「查看範本」按鈕）；
  按工具列匯入鈕、或範本選擇頁已開著／沒有開任何專案時，直接進範本選擇頁顯示結果。匯出結果（成功／失敗）一律用通知列。

### 批次匯入（主行程）

- 新增純函式 `lib/workflow.js` 的 `importTemplateFiles(files)`：`files = [{ name, text } | { name, error }]`，
  每個檔案各自剝 BOM → 解析 → `sanitizeImportedTemplates()`，**一個壞檔不影響其他檔案**；回傳
  `{ templates, skipped（每筆多一個 file 欄位）, files: [{ name, ok, imported, skipped, error? }] }`。
  上限常數 `IMPORT_FILE_LIMITS`：一次 50 個檔案、每檔 10 MB。
- `projectTemplates:import`：檔案對話框改為可多選；回傳新增 `files[]`（逐檔結果），其餘欄位相容 1.46.0
  （單一檔案失敗時仍回該檔的錯誤碼 `invalid-file`／`too-large`；多檔全部失敗回 `no-valid-template`）。
- 新 IPC `projectTemplates:importFiles`（`preload.js`：`importProjectTemplateFiles(files)`）：給拖拉用。renderer 讀檔
  （只收 `.json`、超過 10 MB 不讀；非 `.json`／過大／讀取失敗的檔案帶 `error` 一起送回報），主行程只收字串、限制數量，
  不信任 renderer 的任何欄位，其餘交給 `importTemplateFiles()` 驗證；寫一筆稽核日誌（沿用 `main.projects.log.templatesImported`）。
- 匯入仍一律產生新 `id`、新增自訂範本、不覆蓋既有範本。

### 匯出範本（原 1.47.0 半成品，這版補完並加測試）

- 新 IPC `projectTemplates:export`（`preload.js`：`exportProjectTemplates(ids)`）：`ids` 指定範本（內建或自訂），省略／`null`
  則匯出全部自訂範本；存檔對話框、寫一筆稽核日誌；回傳 `{ ok, exported, filePath }` 或 `{ ok: false, error }`
  （`canceled`／`nothing-to-export`／`write-failed`）。
- 純函式 `buildTemplateExport(templates, resolveItem)`：輸出格式與匯入相同（`{ format, formatVersion, exportedAt, templates }`）；
  引用知識庫的步驟（`itemDefaultId`）**展開成內嵌的標題＋提示詞**，所以檔案拿到別台電腦也能用；不輸出 `id`／`createdAt`／`builtIn`；
  解析不到的步驟、沒有任何有效步驟的階段、沒有任何有效階段或沒有名稱的範本都不輸出。匯出檔可直接用匯入讀回。

### 語系

- 新增 `project.tplLibTitle`／`tplDropHint`／`tplOverlay`／`tplOverlaySub`／`tplResult*`（7 個）／`tplReason*`（5 個）／`tplToastView` 共 17 個鍵；
  移除不再使用的 `project.tplImportDone`、`project.tplExportHint`；調整 `tplImport`／`tplImportHint`／`tplExport`／`tplExportAll(Hint)`／`tplExportErrNone` 文字。
  三語系各 711 個鍵（zh-TW／en／ja 一致）。

### 文件

- `docs/PROJECT_TEMPLATE_FORMAT.md`：匯入方式改寫（工具列入口、多檔、拖拉、結果面板），新增匯出說明。
- `PROJECT_SPEC.md` §7.6：IPC 清單加 `importFiles`／`export`，新增「專案範本匯入／匯出（1.47.0）」畫面段落。
- `README.md`／`README.en.md`／`README.ja.md`：專案範本列補上匯入／匯出與拖拉匯入說明。
- `ROADMAP.md` 拆成兩份：`ROADMAP.md` 只留「明確排除」、待辦檢核表（P0／P1／P2，`- [ ]`）與已發布版本檢核表（`- [x]`）；各版改動摘要與舊項目搬到新檔 `docs/ROADMAP_HISTORY.md`。
- `ROADMAP.md`、`NEW_FEATURE_BUILD_PROMPT.md`、`FIX_EXISTING_FEATURE_PROMPT.md`：版本與功能方向同步到 1.47.0（ROADMAP 版本表 1.45.0／1.46.0 順序一併修正）。

### 測試

- `test/project-template-import.test.js` 新增 6 項：`importTemplateFiles`（多檔各自驗證與統計、壞輸入與上限）、
  對話框多選、`projectTemplates:importFiles`（多檔成功、全部失敗不寫入、惡意形狀不丟例外）、`buildTemplateExport`
  （展開知識庫引用、丟棄無效項目、可被匯入讀回）、`projectTemplates:export`（取消、單一內建範本、全部自訂、找不到 id）。共 320 項測試。
- 另用 Chromium＋假的 `workspaceAPI` 載入 `project.html` 做了一次前端冒煙驗證（拖拉遮罩、多檔匯入、結果面板、編輯中不跳頁只出通知、
  通知列「查看範本」、文字拖曳被忽略），**過程中抓到並修正一個 bug**：遮罩與通知元素若放在 `<script>` 之後，
  `project-templates.js` 載入時找不到元素會讓整個專案頁初始化失敗；現在放在 script 之前。此驗證用的腳本沒有加進 repo。

### 已知限制

- **尚未在真正的 Electron 視窗驗證**（沒有顯示器）：檔案對話框多選、從系統檔案管理員實際拖檔進視窗只由單元測試與 Chromium 模擬事件驗證，
  Electron 版本差異（拖入檔案的 `File` 物件行為）未實測。
- 匯入不支援覆蓋或合併同名範本；匯出檔不含範本的 `id`，重新匯入會變成新範本。
- 範例範本沒有 `en`／`ja` 版本（內容為繁體中文）。
- `npm run lint` 在這份專案裡找不到 `eslint.config.*`（zip 內沒有），因此本版沒跑 ESLint，只做了 `node --check`＋`npm test`；
  `prettier --check` 在變更前就有既有檔案不合格（含 CRLF 換行相關），本版沒有重新格式化。

## [1.46.0]

專案範本檔匯入：可以從 `.json` 檔匯入自訂專案範本，並附上格式說明文件與 6 個企業行銷／教育訓練／財務會計範本檔。

### 匯入範本檔（專案 › 從範本建立 › 匯入範本檔…）

- 新 IPC `projectTemplates:import`（`preload.js`：`importProjectTemplates()`）：選一個 `.json`（上限 10 MB，可含 BOM），
  驗證後以**自訂範本**加進清單並自動選取第一個；回傳 `{ ok, imported, skipped, firstId }`，失敗回 `{ ok: false, error }`
  （`canceled`／`too-large`／`invalid-file`／`no-valid-template`）。寫一筆稽核日誌。
- 驗證是純函式 `lib/workflow.js` 的 `sanitizeImportedTemplates()`：匯入檔是外部輸入，只留白名單欄位
  （`name`／`description`／`stages[].title／steps／relatedPrompts`、步驟的 `title`／`prompt`／`itemDefaultId`／`artifact`／
  `useBaseContext`）、一律重新產生 `id` 與 `createdAt`（重複匯入不會覆蓋既有範本）、長度與數量設上限
  （50 範本／30 階段／50 步驟／20 相關提示詞／提示詞 50,000 字）、`artifact` 只接受不含 `..` 的 `.md` 相對路徑。
  能用的留下、不能用的略過並回報原因（`no-name`／`no-steps`／`too-many`／`not-object`），不會因一個壞步驟讓整份失敗。
  最上層接受 `{ format, formatVersion, templates }`（建議）、範本陣列、單一範本物件三種。
- 畫面：範本選擇頁新增「匯入範本檔…」按鈕與結果提示（匯入幾個、略過幾個）；新增語系鍵 `project.tplImport*` 6 個＋
  `main.projects.templateImportTitle`／`main.projects.log.templatesImported`（三語系各 687 個鍵）。

### 文件與範本檔

- 新增 [`docs/PROJECT_TEMPLATE_FORMAT.md`](./docs/PROJECT_TEMPLATE_FORMAT.md)：匯入方式、檔案結構與欄位表、上限、
  `{{topic}}`／`[請填入]`／`[待確認]` 標記、提示詞寫法建議、驗證規則與常見錯誤、「請 AI 幫你產生範本檔」的提示詞、範例檔索引。
- 新增 6 個可直接匯入的範本檔（`docs/project-templates/`，每個 3～4 個階段、8～11 個步驟，提示詞統一用
  「角色與目標／輸入資訊／輸出要求／補充」骨架，並要求缺資料標 `[待確認]`、不編造數據、金額或法規）：
  - 企業行銷：`marketing-integrated-campaign.json`（整合行銷活動企劃與執行）、`marketing-content-social.json`（內容行銷與社群經營規劃）
  - 教育訓練：`training-course-development.json`（企業內訓課程開發，ADDIE）、`training-new-hire-onboarding.json`（新人到職訓練計畫）
  - 財務會計：`finance-month-end-close.json`（月結與財務報表作業）、`finance-annual-budget.json`（年度預算編製與預測）
- 這些是通用骨架，不是內建範本：不影響內建範本數量與三語系內建內容；稅務與會計準則相關步驟都提醒
  「依當地法規與公司會計政策確認，由會計師或主管覆核」。

### 測試

- 新增 `test/project-template-import.test.js`（10 項）：三種最上層格式、格式錯誤、新 id、壞步驟／空階段／無名範本、
  `artifact` 路徑白名單、上限、IPC（取消／壞檔／成功含 BOM／重複匯入／匯入後建立專案並確認 `{{topic}}` 被代換），
  以及 `docs/project-templates/*.json` 每個範本檔都必須完整匯入（零略過、步驟數不變、提示詞含四個必要區塊）。共 302 項測試。

### 已知限制

- **尚未在真正的 Electron 視窗驗證**（沒有顯示器）：檔案選擇對話框與匯入按鈕版面只做了單元測試。
- 匯入的範本沒有匯出對應功能（要分享範本請直接複製 JSON 檔）；匯入不支援覆蓋或合併同名範本。
- 範例範本沒有 `en`／`ja` 版本（內容為繁體中文）。

## [1.45.0]

內部整理，沒有新功能、沒有畫面變化：專案視窗的大檔拆分，以及資料檔 schema 版本號與集中式 migration。

### 大檔拆分：`renderer/project.js`（2,595 行）→ `renderer/project/*.js`

- 原本包在單一 IIFE 裡的 `project.js` 依功能拆成 14 支檔（全部在 `renderer/project/`）：`project-core`
  （DOM 參照／共用狀態／日期工具／專案清單／分頁）、`project-tasks`、`project-calendar`、`project-gantt`、
  `project-issues`、`project-overview`、`project-templates`、`project-linked-docs`、`project-workflow`、
  `project-stage-prompts`、`project-workflow-detail`、`project-pitch`、`project-openspec`、`project-main`
  （專案編輯＋初始化，必須最後載入）。最大的一支約 410 行。
- **做法**：不用 ES module，改成多支一般 `<script>`，彼此共用全域詞法作用域（頂層 `const`／`let`／`function`
  互相看得到）；`project.html` 依原本的區段順序列出 14 個 `<script src>`，載入順序與原本檔案內的宣告順序相同，
  所以暫時性死區（TDZ）與事件接線順序都沒變。CSP（`script-src 'self'`）不需要改。每支檔案開頭有
  `/* global … */`／`/* exported … */` 註解列出跨檔使用的名稱，避免 ESLint 的 `no-undef`／`no-unused-vars` 誤報。
- 已逐一確認這 149 個頂層名稱不會跟瀏覽器 `window` 既有屬性撞名。
- `test/i18n-keys.test.js` 的中文白名單改指向 `renderer/project/project-pitch.js`（簡報製作標籤的三種寫法）。

### 資料檔 schema 版本號與集中式 migration（新增 `lib/migrations.js`）

- 8 種資料檔（`app-state.json`、`knowledge-base.json`、`selectors.json`、`projects.json`、`project-templates.json`、
  `documents.json`、`conversations.json`、`seeded-defaults.json`）最上層新增整數 `schemaVersion`（目前都是 `1`）；
  沒有這個欄位的舊檔視為版本 0。
- 原本散在 `loadProjects()`／`loadKnowledgeBase()`／`loadConversations()` 的「舊資料補欄位」（任務 `timeEntries`、
  `linkedDocumentIds`、`systemPrompt`／`userPrompt`、`step.stage`、壞掉的 `workflow` 丟棄……）全部集中成
  `lib/migrations.js` 的 v0→v1 步驟（純函式、冪等）。之後新增欄位只要在 `MIGRATIONS[kind]` 補一個步驟＋一個測試。
- **讀檔**（`lib/stores.js` 的 `loadVersionedFile()`）：版本比較舊就升級並寫回磁碟，升級前先把原檔留成
  `<檔名>.v<舊版本>.bak`（只留第一次升級前的原貌）；已是最新版的檔案不會重寫；檔案版本比程式新（降版）時不動檔案、
  只在主控台警告。
- **寫檔**（`writeVersionedFile()`）：一律先過一遍 migration 再寫，等於補齊欄位並蓋上版本，所以各處 IPC 新建的紀錄
  就算沒帶齊欄位，磁碟上的檔案也永遠是最新形狀。
- `selectors.json` 最上層本來就是「平台 → 選擇器」對照表，`schemaVersion` 與平台鍵並列；讀進來就拿掉，其餘程式碼看到
  的仍是純對照表。
- **備份**：匯出的備份新增 `schemaVersions`（各資料種類當下的版本）。匯入時備份是外部輸入、宣告的版本不可信，
  所以每種資料都從版本 0 完整重跑 migration（只有備份宣告的版本比程式新時才原樣保留），取代原本各處的
  `{ tasks: [], issues: [], ...p }` 式補欄位。
- 「清除備份檔」（設定頁）同步改成也清掉 `*.json.v<N>.bak`，避免升級前的舊資料殘留。
- UI 預設值的深合併（`loadAppState()` 的 `ui`／`sidebarGroups`）與內建內容補種不屬於一次性格式升級，維持原本做法。

### 測試

- 新增 `test/migrations.test.js`（17 項）：版本表與連號、各資料種類舊形狀→新形狀、冪等、壞輸入、降版不動資料、
  舊檔升級＋`.v0.bak`、最新版不重寫、各種 save 蓋版本並補欄位、`selectors` 版本鍵不外洩、`app-state` 與
  `seeded-defaults` 升級、清除備份檔涵蓋升級前備份。`test/backup-sanitize.test.js` 新增 1 項（舊備份匯入補齊欄位）。
  共 292 項測試（原 274）。
- 拆分前後用 Chromium（假 `workspaceAPI`＋真實範本資料）載入 `project.html` 走過所有分頁、階段流程、派發面板、總覽與新增
  專案，15 個畫面快照逐字一致。

### 已知限制

- **尚未在真正的 Electron 視窗驗證**（沒有顯示器），只做了上述 Chromium 冒煙比對與單元測試。
- 這個環境無法安裝 npm 套件，`npm run lint`／`npm run format:check` 沒有跑過；新檔案已照 Prettier 設定（CRLF、單引號、
  90 欄）手動排版，請在有網路的環境跑一次 `npm run format:check`。
- 降版（用舊版程式開新版資料檔）不受支援：只保證不改檔，舊版的 `loadX()` 看到的 `schemaVersion` 欄位會被忽略。

## [1.44.0]

專案流程新增「派發」：把某一步交給指定的 AI 帳號，一鍵完成「指派負責人 → 複製提示詞 → 切到該帳號」。

### 派發（專案 › 階段流程）

- **流程頁新增「派發…」按鈕**：展開面板後選一個帳號（選項顯示帳號名稱、平台與角色；預選順序為上次派發的對象、
  這一步任務目前的負責人、現在正在用的帳號），按「派發並切換帳號」：
  1. 這一步記下**派發紀錄**（`step.dispatch = { accountId, accountName, at }`，名稱是當下的快照，帳號之後被刪除
     仍看得出當時派給誰）；
  2. 對應任務的**負責人**設成該帳號（任務清單、甘特圖、到期提醒與浮動托盤的「已指派」區塊都跟著動）；
  3. 還是待辦的步驟轉成進行中並同步任務狀態（已完成的步驟可再派發重做，狀態不變），目前步驟移到這一步；
  4. 把這一步的**完整提示詞**（已帶入主題與前面步驟的產出）複製到剪貼簿；
  5. **切換到該帳號**並把主視窗帶到前景。
- **不會自動貼上或送出**：提示詞由使用者在該帳號的輸入框貼上、自行送出（不碰各平台 DOM，符合核心原則）。
- 步驟清單上，派發過的步驟會顯示「→ 帳號名稱」標籤；詳細面板顯示「上次派發：帳號（時間）」。
- 新 IPC `projects:workflow:dispatch`（`{ projectId, stepId, accountId }`，回傳 `{ ok, projects, copied, switched,
  accountName }`；專案／步驟／帳號任一不存在回 `{ ok: false, error: 'NOT_FOUND' }`，不改資料也不複製）。
  資料邏輯是 `lib/workflow.js` 的 `applyDispatch()`／`normalizeDispatch()`（純函式）；`lib/windows.js` 新增
  `bringMainWindowToFront()`。派發成功後廣播 `projects:changed` 與 `accounts:changed`，並寫一筆稽核日誌。
- 語系鍵：`project.wfDispatch*` 10 個＋`main.projects.log.dispatched`（三語系各 679 個鍵）。

### 測試

- 新增 `test/dispatch.test.js`（6 項）：`applyDispatch`（紀錄、負責人、狀態、重做、缺資料）、`normalizeDispatch`、
  IPC 的成功與找不到對象兩種情況。

### 已知限制

- **尚未實機驗證**（沒有顯示器）：派發後主視窗是否確實帶到前景、專案視窗是子視窗，在部分平台會一直疊在主視窗上方，
  可能需要使用者把專案視窗移開才看得到帳號畫面。
- 派發只切換帳號並複製提示詞，不會自動新開對話；要不要在該帳號開新對話由使用者決定。
- 備份匯入的專案若帶有派發紀錄，帳號 id 可能對不上目前環境；畫面會用紀錄裡的名稱快照並標示「帳號已移除」。

## [1.43.0]

多語系補完：內建角色、提示詞、套餐、專案範本與主程序文字都支援繁體中文／英文／日文，沒有新增其他功能。

### 內建內容多語系

- **內建內容三語系**：8 個角色、85 則提示詞、9 組分階段套餐、7 個專案範本（名稱、說明、標籤、階段名、步驟名與提示詞全文）
  都有英文與日文版，放在 `extractors/i18n/<lang>/{roles,knowledge-base,project-templates}.json`，只含可翻譯欄位，
  以 `id`／`defaultId` 對應（`roleIds`、`itemDefaultId`、`artifact` 等結構欄位永遠取自原始檔）。原始繁中仍在
  `extractors/default-*.json`。
- **切換介面語言時自動換**（`lib/builtinContent.js`）：使用者資料裡的內建項目逐欄位比對——欄位內容等於任一語言的
  內建原文才換成新語言；使用者改過的欄位保持不動，自建項目與自訂標籤不受影響，來回切換可還原。
  全新安裝與升級補種的新內建項目一律依目前語言種入；專案範本展開成專案時也用目前語言。
- **填空標記與解析標記固定譯法**：`[請填入]`／`[Please fill in]`／`[ご記入ください]` 等三語一致；OpenSpec 提案的
  「建議變更名稱」標記行三種語言（`建議變更名稱：`／`Suggested change name:`／`変更名の提案：`）都能被
  `lib/openspec.js` 解析；`=== FILE: ... ===`、`constitution.md`／`spec.md`／`plan.md`／`tasks.md`／`proposal.md`／
  `design.md` 等檔名與路徑不翻譯。
- **標籤相關邏輯**：專案頁「簡報橋接」原本只認標籤「簡報製作」，改為三種語言的寫法都認得。

### 主程序與畫面文字

- 新增 `lib/i18n.js`（主程序用的 `t(key, vars, lang)`，跟 renderer 共用同一份 `renderer/locales/<lang>.json`）；
  對話框、錯誤訊息、稽核日誌文字、預設檔名（例如專案步驟產出存成文件的檔名）、對話匯出標題、OpenSpec 與階段流程
  組出來給 AI 的說明文字等，原本寫死的中文都改用 `main.*` 鍵（共 134 個，三語系各一份）。
- 10 個頁面的視窗標題改為 `<title data-i18n>`，隨語言切換更新；知識庫的「未命名」預設標題改用語系鍵。
- `docs`：PROJECT_SPEC 第 11 節補內建內容與主程序多語系的規範。

### 測試

- `test/builtin-content.test.js`（疊加檔結構與佔位符一致、OpenSpec 標記、切換語言與使用者修改保留）、
  `test/i18n-main.test.js`、`test/i18n-keys.test.js`（引用的鍵三語系都存在、視窗標題、**程式碼不得新增寫死的中文**）。
  語系檔鍵數：三語系各 668 個。

### 已知限制

- 已建立的專案（`workflow.steps`）與使用者自己另存的專案範本是使用者資料，建立當下的語言就固定，不會隨語言切換。
- 英文／日文提示詞為翻譯成品，建議使用者實際用過後再微調；翻譯後的措辭差異不影響結構（有測試比對標題、項目符號、
  佔位符、程式碼圍欄數量）。
- 沒有在真實 Electron 視窗環境驗證語言切換後的重繪（單元測試涵蓋資料層與主程序）。


## [1.42.0]

資安修補版：依 [`docs/SECURITY_AUDIT_REPORT.md`](./docs/SECURITY_AUDIT_REPORT.md)（對象 `1.41.0`）的發現逐項修補，
逐項紀錄與驗證狀態見 [`docs/SECURITY_FIX_CHECKLIST.md`](./docs/SECURITY_FIX_CHECKLIST.md)。沒有新增使用者功能。

### 修補

- **導覽與開窗限制（H-1）**：主視窗、各子視窗、托盤只允許停在 `renderer/` 底下的頁面，其餘導覽與
  `window.open` 一律拒絕；帳號視圖擋掉 `file:` 等非網頁協定（http(s) 照舊，OAuth 彈窗不受影響）。
  文件庫預覽內的連結改為攔截點擊，只接受 `http(s):`／`mailto:`，確認後交給系統瀏覽器
  （新增 IPC `app:openExternal`，主程序再驗一次）。
- **IPC 來源檢查（L-2）**：所有 IPC handler 統一檢查 `event.senderFrame.url`，不是自己的頁面就拒絕並寫入錯誤日誌。
- **備份匯入驗證（M-1）**：逐筆驗證欄位型別；帳號只留白名單欄位；文件的 `filePath` 只接受 `documents/`
  底下的路徑，其餘清空（**取捨**：指向外部檔案的未管理文件，還原後需重新匯入）。刪除文件時
  `alsoDeleteFile` 只刪「已管理且位於 `documents/` 底下」的檔案。
- **本地服務網址（M-4）**：主程序驗證，只接受 `http(s):`（新增、更新、連線測試皆是）；`addAccount`
  只接受已知平台與 `local`。
- **可執行檔（M-3）**：`documents:openFile` 對 `.exe .bat .ps1 .sh .lnk .jar .html .svg`、巨集文件等副檔名拒絕開啟，
  提示改用「在資料夾中顯示」。
- **`.docx` 預覽淨化（M-2）**：改為標籤與屬性白名單（tokenizer），屬性值先解碼 HTML 實體再判斷網址協定；
  `<form>`、`<meta>`、`<svg>`、無引號／單引號屬性、`java&#9;script:` 等繞過都不再通過。`safeUrl()` 補強：
  先去控制字元，擋 `//` 與反斜線開頭的網址。
- **CSP（L-3）**：10 個頁面補上 `base-uri 'none'; form-action 'none'; object-src 'none'; frame-src 'none'`，
  `img-src` 改為 `'self' data:`（`.docx` 內嵌圖片因此能顯示）。pdf.js 的 `getDocument` 加 `isEvalSupported: false`（L-5）。
- **擴充功能（M-5）**：新增前顯示 `manifest.json` 宣告的權限並請使用者確認（可存取所有網站會警告）；
  `loadExtension` 改為 `allowFileAccess: false`（**取捨**：需要讀本機檔案的擴充功能會失效）。
- **備份檔與 console（L-1、L-4）**：「設定 → 疑難排解」新增「清除備份檔（.bak）」；刪除對話庫項目後立刻清掉
  `conversations.json.bak`；第三方頁面的 console 輸出預設不再收進主控台，設定裡新增開關。
- **CI（L-6）**：workflow 加 `permissions: contents: read`、`npm install --ignore-scripts`；新增 `.github/dependabot.yml`。

### 新增檔案

- `lib/security.js`（不依賴 Electron：網址／路徑／副檔名判斷、視窗加固、`guardIpc`、擴充功能權限摘要、`.bak` 清除）、
  `lib/backupSanitize.js`（備份匯入資料驗證）。
- 測試：`test/security.test.js`、`test/backup-sanitize.test.js`、`test/docx-sanitize.test.js`、`test/csp.test.js`、
  `test/settings-hardening.test.js`。三語系各新增 8 個鍵（共 534 個）。

### 這一版刻意沒有處理

Electron 30 升級（H-2）、`package-lock.json`、GitHub Actions 釘 commit SHA、替換 `pdf-lib`、程式碼簽章：
都需要網路或真實環境，原因與後續安排見 `docs/SECURITY_FIX_CHECKLIST.md` 的 F 組與 `ROADMAP.md`。

### 已知限制

- 沒有在真實 Electron 視窗環境驗證；清單末尾的「人工驗證」項目（連結攔截、子視窗與 IPC 沒被誤擋、OAuth
  彈窗、`.docx` 圖片顯示、PDF 預覽、新增的設定項目）仍待逐項勾選。
- 本版開發環境無法安裝依賴，`npm audit` 與完整的 `npm run lint` 沒有跑；ESLint 以等效的暫時設定檢查過，
  Prettier 只格式化本次新增與修改的檔案（其餘舊檔的格式落差本來就存在）。

## [1.41.0]

合併 `docs/parallel-dev/` 的四項功能（A～D），加上資料保護與文件一致性修補。

### 修補：資料檔原子寫入、文件一致性檢查、CI

- **原子寫入**：`writeJSONSafe` 改為「寫暫存檔 → rename」並保留上一份 `.bak`
  （`lib/utils.js` 的 `writeFileAtomicSync`）；讀取時主檔損毀會改讀 `.bak` 並寫入錯誤日誌
  （`readJsonFileWithBackup`）。寫到一半當機或斷電不再留下被截斷的 JSON。
- **`scripts/check-docs.js`（`npm run check:docs`）**：檢查 `package.json` 版本＝CHANGELOG 最新版本、
  接續開發提示詞的「目前版本」、三語系鍵集合一致、README／規格寫的內建資料數量、README 索引連結
  指向的檔案存在；`test/docs-consistency.test.js` 讓 `npm test` 一併檢查。
- **CI**：新增 `npm run format:check` 步驟；測試步驟改稱含文件一致性檢查。
- 缺少 `sql.js`／`mammoth` 套件時，`sqlite`／`docxEditor` 測試明確 `skip`（附原因），不再以失敗呈現。
- 移除過時的 `yarn.lock`（缺 `docx`／`mammoth`／`pdf-lib`，文件與 CI 都用 npm）。**注意**：專案目前沒有
  `package-lock.json`，CI 的 `npm install` 仍會每次解析最新符合範圍的版本；要鎖版本請在有網路的環境跑
  `npm install` 產生並提交 `package-lock.json`。

### 功能 A：對話擷取預覽與重複儲存提示

- 擷取後、存檔前，對話庫視窗顯示預覽：訊息總數、使用者／AI 各幾則、前幾則的前 80 字，以及「文字與
  同角色其他訊息完全相同」的則數（內容異常重複的徵兆）。
- 對話內容（先正規化空白）算 sha256 存進 `contentHash`；儲存時若對話庫已有內容相同的另一則，跳確認
  （只提示，可選擇仍要儲存）。舊資料沒有 `contentHash` 時由內容現算，所以舊對話也能被偵測。
- 新增 IPC `conversations:checkDuplicate`、preload `checkConversationDuplicate()`；純函式
  `buildConversationPreview()`／`hashConversationContent()`／`findDuplicateConversation()`（`lib/utils.js`）。

### 功能 C：階段提示詞可編輯與從知識庫更新

- 專案流程頁「本階段相關提示詞」可**新增**（從知識庫挑一個，或自訂標題＋內容）、**編輯**、**移除**；
  只影響這個專案的快照。
- **從知識庫重新整理**：對來源是知識庫的項目（`sourceItemId`／`sourceDefaultId`），比對差異並讓使用者
  逐項選擇要不要更新；來源已被刪除的會提示；自訂項目不受影響。舊專案沒有來源欄位時照常運作。
- 新增 IPC `projects:workflow:stagePrompt:add／update／remove／checkUpdates／applyUpdates`。
  **`projects:save` 現在一律忽略傳入的 `workflow`**，避免過期副本蓋掉進度（`workflow` 只能透過
  `projects:workflow:*` 頻道修改）。

### 功能 B：托盤專案區塊顯示範圍可設定

- 「設定 → 浮動托盤」新增「專案區塊顯示範圍」：**只顯示已指派的未完成任務**（預設，維持原行為）或
  **顯示每個進行中專案的目前步驟**（不論有沒有指派）。
- 區塊為空時，托盤顯示一行說明原因（`unassigned`：有進行中專案但任務沒指派；`allDone`：流程步驟都完成），
  並指出怎麼改。
- 設定存在 `appState.ui.tray`（`normalizeTrayPrefs()`，舊資料走預設）；新增 IPC `settings:getTrayPrefs`／
  `settings:setTrayPrefs`、廣播 `tray:prefsChanged`；`buildTrayProjectGroups()` 以參數接收模式，維持純函式。

### 功能 D：托盤全域快捷鍵與最近使用

- **全域快捷鍵**（預設**關閉**，預設組合 `CommandOrControl+Shift+P`，可在設定頁用「按鍵錄製」改）：
  Platter 有焦點視窗時切換托盤展開／收合；Platter 在背景或主視窗最小化時，**先把主視窗帶到前景再展開托盤**。
  托盤本身的顯示規則（`syncTrayVisibility()`，1.39.0）不變，所以不會蓋在其他應用前面。註冊失敗（被佔用、
  格式無效、系統不允許）只在設定頁顯示狀態，不影響其他功能（`lib/trayHotkey.js`）。
- **最近使用**：托盤清單最上方新增「最近使用」區，記錄最近複製的知識庫提示詞 id（預設 5 筆，0～20，0＝關閉）；
  已被刪除的項目自動略過；設定頁可調筆數與清除。專案階段提示詞不記入（它們不是知識庫項目）。
- 新增 IPC `tray:recordRecent`／`tray:clearRecent`、事件 `tray:hotkey`；三語系鍵 480 → 526（三語一致）。

### 測試與限制

- 新增測試：`atomic-write`、`docs-consistency`、`conversation-preview`、`stage-prompts-edit`、
  `tray-project-mode`、`tray-hotkey-recent`。完整測試 175 個：173 通過、2 個因環境缺套件而 skip、0 失敗。
- **全部沒有在真實 Electron 環境驗證**：預覽與重複提示的畫面、階段提示詞的編輯介面、設定頁的快捷鍵錄製、
  托盤「最近使用」區；**Linux／Wayland 的全域快捷鍵與焦點行為尤其未驗證**（Wayland 可能直接不允許註冊）。
- 沒有跑 `npm run lint`／`npm run format:check`（開發環境無法安裝 ESLint／Prettier）。

---

## [1.40.1]

### 文件與工程一致性整理（無功能變更，程式碼行為與 1.40.0 相同）

- **ROADMAP.md 重寫**：加上更新日期；整理成「明確排除／下一步（P0～P2）／已完成索引（1.16.0～1.40.1）」；
  把四項已有提示詞的候選功能（`docs/parallel-dev/` 的 A～D）與實機驗證債務、資料檔寫入保護列入待辦。
- **新增 `docs/OPTIMIZATION_PROPOSAL.md`**：優化與改版建議（可靠性與安全、文件維護成本、產品方向、
  不建議整個改寫成前端框架的理由、建議版本節奏）。三份 README 的文件索引已加入。
- **修正 CI 觸發分支**：`.github/workflows/ci.yml` 原本只監聽 `main`，但倉庫預設分支是 `master`，
  CI 實際上不會觸發；現在 `push`／`pull_request` 都監聽 `main` 與 `master`。**尚未在 GitHub 上實際
  確認 Actions 有跑起來。**
- **README（繁中／英／日）**：Electron 徽章 `^31` → `^30`（對齊 `package.json`）；授權徽章
  `Unlicensed` → `MIT`（對齊 `LICENSE.txt`）；License 連結的壞掉語法修正；移除指向不存在檔案
  `PARTIAL_FILES_BUILD_PROMPT.md` 的索引列；「目前還沒有接 CI」改為實際狀況；刪掉過時的「尚未
  套用 Prettier」說明（`1.20.0` 已套用）；專案結構補上 `conversation.*`、`log.*`、`team.*`、
  `project.*`、`tray.*`、`test/`、`docs/parallel-dev/`（英文版原本把 tray 檔案誤放在
  `extractors/` 底下）；`BUILD_PLAN.md` 的描述改成 Stage 1～16。
- **PROJECT_SPEC.md**：第 15 節內建提示詞數量 68 → 85（一般 69＋角色 16），套餐 8 → 9；檔案結構補上
  `tray.*`、`test/`、`docs/parallel-dev/`。
- **NEW_FEATURE_BUILD_PROMPT.md／FIX_EXISTING_FEATURE_PROMPT.md**：目前版本 `1.36.0` → `1.40.1`；
  補上 `1.37.0`～`1.40.0` 的功能方向；`openChildWindow` 位置改為 `lib/windows.js`（原寫 `main.js`，
  `1.17.0` 模組化後已搬走）；廣播頻道清單補 `projects:changed`、`reminders:changed`。
- **`docs/parallel-dev/` 的基準維持 `v1.40.0`**：`1.40.1` 沒有程式碼變動，各分支的 patch 可直接套用在
  `1.40.1`；合併時再統一把版本號升到 `1.41.0`。

### 驗證與限制

- 已驗證：全部 `.js` 通過 `node --check`；三語系鍵集合一致（各 480）；內建資料數量
  （提示詞 85、套餐 9、角色 8、專案範本 7）與文件一致；`node --test` 為 146 個測試、140 通過、
  6 失敗，與 `1.40.0` 的紀錄相同（失敗原因是這次整理的環境無法安裝 `sql.js`／`mammoth`，
  不是程式問題）。
- **未驗證**：這次環境連不上 npm 套件庫，沒有跑 `npm run lint` 與 `npm run format:check`。
  README 表格新增／修改了幾列，Prettier 可能要求重新對齊欄寬，請在有完整依賴的環境跑一次
  `npm run format` 並單獨提交。
- 尚未在真實 Electron 環境驗證的項目，沿用 `1.40.0`／`1.39.0` 的「已知限制」。

---

## [1.40.0]

### 新增 1：專案範本各階段補上「相關提示詞」

- 內建 7 個專案範本（SDD／Scrum／瀑布／MVP／OpenSpec／AI 短劇／遊戲設計）的**每個階段**
  都新增 `relatedPrompts`：階段做事時可用的輔助提示詞（不是步驟、不建任務、不影響進度）。
  多數重用既有知識庫提示詞（例如風險評估、Code Review、PR 說明、狀態報告），缺口則新增
  **11 組內建提示詞**（`kb-default-075`～`085`）：短劇開場鉤子與結尾懸念優化、角色與場景
  一致性檢查表、AI 生成素材品質檢查、短劇發佈合規與版權檢查、參考遊戲拆解、遊戲經濟平衡
  檢查、新手教學（FTUE）設計、Playtest 回饋整理、Sprint Review、使用者訪談腳本、變更請求
  影響評估。內建提示詞總數 74 → 85（舊安裝透過既有的增量補種自動補進）。
- 建立專案時快照成 `workflow.stagePrompts`；專案視窗流程頁新增可摺疊的「本階段相關提示詞」
  區塊（每個一顆複製鈕）；另存為範本、舊專案正規化都已處理。

### 新增 2：快速提示詞托盤加入「專案任務與階段提示詞」區塊

- 托盤清單最上方新區塊，顯示專案計畫中**已指派且未完成**的流程任務，並依階段附上該階段的
  相關提示詞。點任務複製完整步驟提示詞（並把待辦標成進行中），點 📎 複製階段提示詞；
  搜尋框同時過濾；專案／帳號／知識庫變動即時刷新。
- 新增 IPC `tray:projectPrompts`、preload `trayProjectPrompts()`／`onProjectsChanged()`，
  純函式 `buildTrayProjectGroups()`（`lib/workflow.js`）。三語系（zh-TW／en／ja）已補。
- **注意**：沒有指派帳號的任務不會出現；從範本建專案時任務預設未指派。

### 測試與限制

- `test/workflow.test.js` 新增 4 組測試（每階段都有相關提示詞且不重複、快照不多建任務、
  另存範本保留、托盤分組規則）。完整測試 140 通過；仍有 6 個失敗屬環境缺 `sql.js`／
  `mammoth`，與本次無關。
- 11 組新提示詞的內容、托盤與專案視窗的畫面**沒有在真實 Electron 環境驗證**，請實機看一次
  版面與複製行為。

---

## [1.39.0]

### 修正 1：儲存/匯出對話時 md 內容重複疊加

- **原因**：`extractors/domCapture.js` 用 `querySelectorAll(selector.turn)`
  取得訊息節點，但 selector 是聯集（例如 claude 的
  `[data-testid="user-message"], [data-testid="conversation-turn"]`），
  外層容器與內層訊息會同時符合；外層的 `innerText` 又包含內層全部
  文字，同一段內容就被重複擷取、越疊越多。
- **修正**：擷取時先過濾掉「內含其他符合節點的外層容器」，只保留最內層
  節點；另外合併相鄰、角色與文字完全相同的訊息。
- 新增 `test/domCapture.test.js`（用最小假 DOM + `vm` 驗證去重邏輯）。

### 修正 2：應用在背景時，浮動小托盤跑到其他前景應用前面

- **原因**：托盤視窗設了 `alwaysOnTop: true`，這個旗標會蓋過**所有**
  應用程式，Platter 退到背景時圓鈕仍浮在別人前面。
- **修正**：`lib/windows.js` 移除 `alwaysOnTop`，改由新的
  `syncTrayVisibility()` 控制：只有 Platter 任一視窗是焦點視窗、且主視窗
  可見未最小化時才 `showInactive()` 顯示，否則 `hide()`。掛在主視窗
  `show`／`hide`／`restore`、`app` 的 `browser-window-focus`／
  `browser-window-blur`（延遲 80ms 避免切換視窗時閃爍）上。
- **已知限制**：兩項修正都只做了程式碼推理與 Node 單元測試，**沒有在
  真正的 Electron／真實平台頁面實機驗證**；Claude 實際 DOM 結構是否就是
  上述巢狀情況，需要使用者實測確認。若仍重複，請用「設定 → 選擇器
  設定 → 測試擷取」回報數字。

---

## [1.38.0]

### 浮動小托盤：提示詞清單拆成「角色提示詞」與「其他」兩區

- `renderer/tray.js` 的 `renderList()` 依 `item.roleIds` 是否非空分成
  **角色提示詞**（企業角色範本那批）跟**其他**（一般任務型提示詞）
  兩個區塊顯示，各自依搜尋字串獨立過濾；篩完整區沒有結果就整個標題
  一起不顯示，不會留一個空標題卡在清單裡。排序沿用 `kb.items` 原始
  順序，沒有額外排序規則。
- 新增 CSS `.tray-section-heading`；三語系（zh-TW／en／ja）各新增 2 個
  鍵（`tray.roleSection`／`tray.otherSection`，471 → 473，鍵集合一致）。
- 這個改動純粹是 renderer 端的分組顯示邏輯，沒有新增 IPC、沒有動資料
  結構，所以沒有新增對應的單元測試（跟托盤本身其他 UI 邏輯一致，純
  前端 DOM 操作不另外寫測試）。
- 三份 README 的浮動小托盤功能列同步更新；`PROJECT_SPEC.md` 第 9.0 節
  補上分區說明。
- **已知限制**：跟上一版一樣，這個功能沒有在真正的 Electron 視窗環境
  實機驗證過畫面效果。

---

## [1.37.0]

這次依序處理了四件事：擴充知識庫範例、新增一組分階段工作流、右下角浮動
小托盤、修正「匯出當前對話沒有反應」的回報問題。

### 1＋2. 擴充知識庫範例／新增工作流架構：求職與職涯

- 「擴充範例庫」「新增工作流架構」兩項需求沒有指定具體方向，這次選定
  **求職與職涯**作為新領域（原因：通用性高、前面幾輪還沒碰過，且剛好
  能同時滿足「擴充範例」跟「工作流」兩個面向），新增 6 組提示詞
  （`kb-default-069` ~ `074`：自我優勢與職涯定位盤點、履歷健檢與優化、
  求職信／自我推薦信撰寫、LinkedIn／個人品牌檔案優化、面試問題模擬與
  準備、薪資談判準備）＋ 1 組分階段套餐 `kb-group-default-009`「求職
  準備全流程」（階段 1 自我盤點與履歷、階段 2 求職文件與個人品牌、
  階段 3 面試與談判，各 2 步）。
- 跟先前幾個套餐一致的原則：需要具體數字或成果佐證的地方（市場薪資
  行情、過往績效數據）一律要求使用者提供真實資料，明確禁止 AI 編造。
- 內建提示詞總數 68 → 74（一般範本 52 → 58），分階段套餐總數 8 → 9，
  知識庫分類 9 → 10。資料異動純新增（56 insertions, 0 deletions，保留
  CRLF 與原排版）。

### 3. 新增右下角浮動小托盤

- 主視窗啟動即常駐、不用使用者自己開：一個釘在主視窗右下角的小圓鈕，
  點一下展開成搜尋框＋提示詞清單（只列知識庫的**單一提示詞項目**，不含
  分階段套餐——套餐是多步驟操作，留給完整知識庫視窗），點項目直接複製
  到剪貼簿，滿足「不用在使用過程中還要開知識庫視窗」的需求。
- **架構上不是一般子視窗**：另外 8 個子視窗都是用 `openChildWindow()`
  開的「使用者按按鈕才開、置中」對話框；這個是跟著主視窗常駐、固定釘在
  右下角、永遠蓋在最上面的獨立 `BrowserWindow`——無邊框、透明背景（收起
  狀態是圓形不是方形）、`alwaysOnTop`、`parent: mainWindow`（主視窗關閉
  會自動一併關閉）。收起（56×56 圓鈕）／展開（340×440 面板）是整個 OS
  視窗本身變大變小，不是 CSS 切換；主視窗 `move`/`resize`/`minimize`/
  `restore` 都會連動（見 `lib/windows.js` 的 `openTrayWindow()`／
  `trayBoundsFor()`／`repositionTrayWindow()`）。
- 新增 `renderer/tray.html`／`tray.js`／`tray.css`，新增 IPC
  `tray:setExpanded`（`preload.js` 的 `trayToggleExpanded()`）。
- **已知限制**：收起狀態的圓形視窗本身是方形，四個直角落雖然視覺透明
  但仍會吃掉那幾個像素的滑鼠事件（影響範圍極小，沒有實作
  `setIgnoreMouseEvents` 去摳掉）；`transparent: true` 視窗在不同作業
  系統的合成器行為沒有完全一致過，**這個功能完全沒有在真正的 Electron
  視窗環境實機驗證過**；目前沒有讓使用者關閉/停用托盤的設定。

### 4. 修正「匯出當前對話沒有反應」

- **找到真正的原因**：`index.html` 自己的 `#export-options-overlay`
  是 `position: fixed; inset: 0` 的 DOM 全螢幕遮罩，但目前帳號的
  `WebContentsView` 是原生畫面層、不受 CSS z-index 影響，一直都蓋在
  `index.html` 自己的 DOM 上面——使用者點「匯出當前對話」時 IPC 其實有
  正常執行、遮罩的 `open` class 也真的加上去了，只是整個對話框畫面被
  帳號視窗蓋住、完全看不見，看起來就像「點了沒反應」。
- **審查後發現第二個一模一樣的案例**：命令面板（跨模組快速搜尋，
  `#command-palette-overlay`）是完全相同的架構，同樣的問題，只是使用者
  沒有特別回報。
- **修法**：沒有把這兩個改成獨立視窗（那樣會犧牲「瞬間彈出/收起」的
  輕量體驗），而是新增 `lib/windows.js` 的
  `setActiveAccountViewVisible(visible)`，開啟遮罩前呼叫 `false` 把
  目前帳號的 `WebContentsView` 暫時隱藏（跟切換帳號時彼此顯示/隱藏用
  同一個 `setVisible()` API），遮罩關閉時呼叫 `true` 恢復。
  `openExportDialog()`／`closeExportDialog()`、`openPalette()`／
  `closePalette()`（`renderer/renderer.js`）都已經接上。新增 IPC
  `window:setActiveAccountViewVisible`（`preload.js` 的
  `setActiveAccountViewVisible()`）。
- 新增 `test/account-view-visibility.test.js`（3 項）驗證
  `setActiveAccountViewVisible()` 本身的邏輯（只動作用中帳號的 view、
  沒有帳號時安全地什麼都不做）。**畫面行為本身（遮罩開啟後真的看得到）
  沒有在真正的 Electron 視窗環境實機驗證過**，只驗證了會呼叫正確的
  API——如果問題還在，代表根因可能不只這一個。

### 其他

- 新增測試共 3 項（`test/account-view-visibility.test.js`，見上方第 4
  項；求職套餐沒有獨立測試，沿用既有知識庫套餐資料完整性測試自動涵蓋；
  托盤 UI 本身是純前端 DOM 邏輯，比照其他 renderer 檔案不另外寫單元
  測試）；`npm test` 147 項全過、lint/format 全過。
- 三份 README（zh-TW／en／ja）、`PROJECT_SPEC.md`（第 5 節知識庫計數、
  第 9 節新增浮動小托盤小節＋z-index 坑的說明、第 12 節匯出對話框加
  cross-reference）同步更新。

---

## [1.36.0]

### 修正：角色覆蓋安裝補種失效；審查並修正選擇器的同一類問題；角色清單拆分基本／延展；新增遊戲設計範本

- **修正角色覆蓋安裝不補種的回報問題**：`loadAppState()` 舊版只在 `app-state.json` 完全
  不存在時套用一次 `extractors/default-roles.json` 的 8 個內建角色，覆蓋安裝／版本升級
  永遠不會補進新版新增的角色。新增 `applyIncrementalDefaultRoleSeeds()`，每次
  `loadAppState()` 都比對一次（用 `seeded-defaults.json` 的 `roles` 清單記錄「已經種過的
  內建角色 id」），只補缺少的、不動使用者已刪除/編輯過的角色；角色 `id` 本身是固定值，
  不需要像知識庫項目那樣額外存一個 `defaultId`。
- **順便修的既有 bug**：`seeded-defaults.json` 是知識庫跟角色共用的同一個檔案，兩邊各自
  獨立呼叫、順序不固定，舊版整份覆蓋寫入，先跑的那次會把後跑的那次寫的 key 蓋掉。新增
  `readSeededDefaultsRecord()`／`writeSeededDefaultsRecord(patch)` 合併寫入小工具，兩邊
  種子函式都改用它——這個 bug 是在幫角色補種寫回歸測試時，用「反過來的呼叫順序」測試案例
  抓到的。
- **審查其他內建預設參數，找到並修正同一類問題**：`loadSelectors()`（PDF/DOCX 以外，每個
  AI 平台的對話擷取 CSS selector）也只在 `selectors.json` 完全不存在時套用預設值，升級
  新增的平台或欄位既有使用者拿不到。新增 `applyIncrementalSelectorDefaults()`：缺的平台
  整組補上、平台裡缺的欄位個別補上，使用者已存在的值（包含刻意清空的空字串）一律不碰，用
  `hasOwnProperty` 判斷缺少而不是看值是否為假值。
- **角色清單拆分「基本」與「延展」**：設定視窗「帳號角色管理」依角色 id 是否為內建角色
  （`defaultRoleIds()`，即時讀 `default-roles.json` 算出來，不是另存的欄位）拆成「基本
  角色（內建）」「延展角色（自訂）」兩個小節顯示；純粹是分類顯示，兩種角色的編輯/刪除操作
  完全一樣。新增 IPC `roles:defaultIds`（`preload.js` 的 `listDefaultRoleIds()`）。
- **新增「遊戲設計」專案範本**（`proj-tpl-game-design`，4 階段 11 步，提示詞全部內嵌、
  不綁定特定引擎或工具）：
  - 階段 1 企劃與設計文件：核心玩法與市場定位 → GDD 大綱 → 核心迴圈與進程曲線設計
  - 階段 2 系統與數值設計：核心系統設計 → 數值平衡與公式設計 → 關卡／內容規劃清單
  - 階段 3 美術、音效與介面：美術風格指南 → UI/UX 介面設計規劃
  - 階段 4 原型、測試與迭代：MVP 規劃 → Playtest 計畫與回饋收集框架 → 數據分析與下一輪
    迭代方向
  - 設計取捨跟「AI 短劇製作」範本一致：資訊不足標「待確認」不編造數據/規格、不使用真實
    遊戲或既有 IP 的角色/美術/商標。
- **新增測試**：`test/roles-seeding.test.js`（5 項，含兩個順序互換的回歸測試）、
  `test/selectors-seeding.test.js`（4 項）、`test/workflow.test.js` 補 2 項（遊戲設計範本
  結構與產出接力）。資料異動（`default-project-templates.json`）純新增（71 insertions,
  0 deletions，保留 CRLF 與原排版）。
- 三份 README（zh-TW／en／ja）專案範本功能列、檔案結構註記同步更新為 7 組範本；
  `PROJECT_SPEC.md` 第 4 節（角色）、第 10 節（選擇器）更新說明，第 7.6 節新增遊戲設計
  範本列。
- **已知限制**：遊戲設計範本的提示詞內容只做了資料完整性與展開／接力的單元測試，沒有
  實際拿去跑過任何一家 AI 驗證產出品質；角色/選擇器的補種修正邏輯已有完整單元測試覆蓋，
  但跟前幾輪一樣沒有在真正的 Electron 視窗裡實機跑過一次「覆蓋安裝升級」流程驗證。

---

## [1.35.0]

### 專案計畫新增：關聯文件、把步驟產出存成文件、簡報橋接

- **背景**：對話庫跟文件庫之間已經有手動關聯（多對多，`linkedDocumentIds`），但專案沒有
  這條路；階段流程的步驟產出（例如「AI 短劇製作」範本的角色聖經、分集大綱）只存在專案自己
  的 `workflow.steps[].output` 裡，離開這個專案就看不到，也沒辦法快速套進知識庫的簡報範本
  去提案。這次補上三件事，都是延伸既有機制、不是新架構。
- **關聯文件**（跟對話庫同一套機制）：專案新增 `linkedDocumentIds: string[]`（`lib/stores.js`
  `loadProjects()` 正規化）。新分頁「關聯文件」（`panel-linked`）：清單顯示已關聯文件（含
  遺失偵測）＋下拉選單挑文件庫裡還沒關聯的文件、按「關聯」。新 IPC
  `projects:linkDocument`／`projects:unlinkDocument`（`lib/ipc/projects.js`），對應
  `preload.js` 的 `linkProjectDocument()`／`unlinkProjectDocument()`。
- **把步驟產出存成文件**：階段流程步驟輸出框旁邊多一個「存成文件」按鈕，呼叫新 IPC
  `projects:workflow:saveStepOutputAsDocument`：寫成 `.md`、存進 `documentsDir()`（文件庫
  「已管理」複本，跟 PDF「擷取頁面」同一套），`registerDocument()` 註冊，**自動**加進這個
  專案的 `linkedDocumentIds`，不用使用者手動再關聯一次。輸出還是空的會回
  `{ ok: false, error: 'EMPTY_OUTPUT' }`，不會產生空文件。
- **簡報橋接**（`wf-pitch-bridge`，純 `renderer/project.js` 端邏輯，**沒有新增 IPC**）：階段
  流程分頁勾選任意數量已填產出的步驟，選一個知識庫裡標籤含「簡報製作」的項目（1.32.0 的簡報
  製作全流程套餐＋場景化範本），組成「勾選步驟標題＋產出」接上範本 `content` 的完整提示詞，
  複製到剪貼簿。刻意設計成**不綁定任何特定專案範本**——「AI 短劇製作」的角色聖經、分集大綱
  是最初動機，但任何範本、任何有產出的專案都能用。
- 新增 5 項 IPC 測試（`test/projects-workflow-ipc.test.js`）：連結/取消連結（含重複連結不
  重複、操作不存在的專案不丟例外）、存成文件的正常路徑與兩種錯誤路徑（空輸出、專案或步驟
  不存在）。三份 README（zh-TW／en／ja）功能列、`PROJECT_SPEC.md` 第 7.8 節（新增）同步更新。
- 三語系（zh-TW／en／ja）各新增 19 個鍵（440 → 459，鍵集合一致）：`project.tabLinked`、
  `project.linkedDocuments` 系列、`project.wfSaveAsDocument` 系列、`project.pitchBridge*` 系列。
- **已知限制**：簡報橋接目前只是「複製到剪貼簿」，不會自動開啟任何 AI 聊天視窗或貼上；
  「存成文件」目前只支援整份步驟輸出存一份 `.md`，不支援拆成多份或選擇性存部分內容；
  跟前幾輪一樣，**沒有在真正的 Electron 視窗裡點過這些新按鈕**，只驗證了 IPC handler 本身
  （`node --test`）跟前端程式碼的語法/lint，畫面實際點擊流程尚待手動驗證。

---

## [1.34.0]

### 專案計畫新增：AI 短劇製作範本

- **新增內建專案範本** `proj-tpl-ai-drama`「AI 短劇製作（企劃 → 劇本 → 分鏡 → 生成 → 剪輯發佈）」，
  4 階段 11 步（內建範本從 5 組增為 6 組，也是第一組非軟體開發的範本）：
  - 階段 1 企劃與劇本：題材定位與集數規劃 → 世界觀與角色設定（角色聖經）→ 分集大綱與鉤子 → 單集劇本（含對白）
  - 階段 2 分鏡與視覺設定：分鏡腳本（Shot List）→ 角色與場景生圖提示詞
  - 階段 3 AI 影像與聲音生成：鏡頭影片生成提示詞 → 配音、旁白與配樂提示詞
  - 階段 4 剪輯與發佈：剪輯節奏與字幕 → 標題、封面、簡介與發佈規劃 → 數據回顧與下一集優化
- **設計取捨**：提示詞全部內嵌在範本（不引用知識庫，所以不動 `default-knowledge-base.json`）；不綁定特定 AI 工具，
  會請使用者填入自己用的生圖／影片／配音工具，不確定的功能標「待確認」、不替工具編造規格；用「角色聖經」的固定
  視覺描述維持跨鏡頭一致；鏡頭以 3-5 秒短片段規劃；每步都要求不使用真人或既有作品角色、資訊不足不編造。
- 資料異動是純新增（`extractors/default-project-templates.json` +71 行、0 刪除，保留 CRLF 與原排版）；不需要改任何程式碼——
  範本載入（`loadDefaultProjectTemplates()`）、建立專案、產出接力、`{{topic}}` 替換都沿用既有機制。
- 新增 2 項測試（`test/workflow.test.js`）：範本結構（4 階段、每階段步數、步驟順序、皆內嵌提示詞且含「待確認」防編造）、
  以及專案主題帶進第一步＋前面步驟產出接力到後面步驟。三份 README 與 `PROJECT_SPEC.md`（第 7.6 節表格與說明、
  檔案結構註記）同步更新。
- **已知限制**：提示詞只做了資料完整性與展開／接力的單元測試，**沒有實際拿去跑過各家 AI 驗證產出品質**，也沒有在
  App 視窗裡看過範本卡片；不會自動呼叫任何生成工具。

---

## [1.33.1]

### 打包體積優化

- **背景**：1.33.0 新增 `pdf-lib`／`mammoth`／`docx` 之後，打包出來的
  `app.asar` 是 36.6MB（沒有排除規則時，這三個套件連同它們的瀏覽器版
  bundle、ESM/UMD 重複 build、型別檔、sourcemap 全部被打包進去）。
- **做法**：只改 `package.json` 的 `build.files`，加排除規則，**不動任何
  程式碼**。排除的都是「Node／Electron main process 用
  `require('套件名')` 永遠不會載入」的檔案：`pdf-lib` 的 `dist/`（UMD
  瀏覽器版，13.8MB）／`es/`／`ts3.4/`／`src/`（`main` 指向 `cjs/`）；
  `docx/dist/` 除了 `index.cjs` 以外的 `.mjs`／`.iife`／`.umd`／
  型別檔，以及沒用到的 `charts`／`math`／`shapes`／`watermarks` 子路徑
  （`require('docx')` 依 `exports` 只會解析到 `dist/index.cjs`）；
  `mammoth` 的瀏覽器版 bundle 跟 `test/`；`jszip`／`pako`／`xml-js` 的
  `dist/` 瀏覽器版；`underscore` 的 `modules/`／`amd/`／ESM 版；
  `@pdf-lib/standard-fonts`、`@pdf-lib/upng` 的 `dist/`／`es/`；
  `@types`、`undici-types`；`sql.js` 的 `*-debug.*`；以及所有
  `node_modules` 裡的 `*.map`／`*.d.ts`／`*.md`／`yarn.lock`／
  `CHANGES*`／`CHANGELOG*`。
- **結果**（用 `electron-builder --dir --linux` 實際打包量測 `app.asar`）：
  **36.6MB → 7.2MB（−80%）**。
- **驗證方式**：實際打包後，用打包出來的 Electron 執行檔
  （`ELECTRON_RUN_AS_NODE=1`）從 `app.asar` 內以套件名稱
  `require('docx'|'mammoth'|'pdf-lib'|'sql.js')`，並實際跑
  `saveHtmlAsDocx()`→`getDocxPreviewHtml()`、`addWatermarkToPdf()`→
  `getPdfPageCount()`，全部正常；另外在一份只裝 production 依賴、
  並手動刪掉同一批檔案的副本上跑 `pdfEditor`／`docxEditor` 測試
  （19 項）全過。**已知注意**：不能改成用「路徑」直接 `require`
  `node_modules/docx`（會解析 `main` → 已被排除的 `index.umd.cjs`），
  程式碼一律用套件名稱載入（目前就是這樣）。**尚未在有畫面的環境啟動
  整個 App 驗證**（只驗證了 main process 端模組載入）。
- 沒動的部分：`renderer/vendor/pdfjs/` 的 1.7MB（PDF 檢視必要）、
  `sql.js` 的 wasm、`docx` 的 `index.cjs`（1.2MB，必要）。

---

## [1.33.0]

### 文件庫新增：`.docx`／`.pdf` 預覽與編輯

- **背景**：文件庫原本只有 `.md`/`.markdown` 能就地預覽，其他格式一律
  只能「開啟檔案」丟給系統預設程式。這次補上 `.docx`（Word 文件）跟
  `.pdf` 兩種最常見格式的就地預覽，`.docx` 還能直接在畫面上編輯文字/
  格式後存回原檔，`.pdf` 能做基本的頁面管理（旋轉、刪除、加水印、
  合併、擷取頁面範圍）。**不支援舊版二進位 `.doc`**（97-2003 格式）——
  純 JS 沒有可靠的 parser，`.doc` 維持現狀用系統預設程式開啟。
- **新增三個 runtime dependency**：`pdf-lib`（PDF 頁面操作）、
  `mammoth`（`.docx` → HTML）、`docx`（HTML → `.docx` 寫回），皆為純 JS
  無原生模組。另外把 `pdfjs-dist`（v6，PDF 檢視畫面用）的官方 build
  （`pdf.min.mjs`／`pdf.worker.min.mjs`）複製進
  `renderer/vendor/pdfjs/`，用動態 `import()` 在 renderer 端載入到
  `<canvas>` 上渲染——這個套件只放在 `devDependencies`（單純拿來複製
  這兩個檔案，執行期不需要整包裝進 `node_modules`），升版要手動重新
  複製檔案。
- **新增 `lib/pdfEditor.js`**（pdf-lib）：`rotatePdfPage()`／
  `deletePdfPage()`（擋掉刪到只剩 0 頁）／`addWatermarkToPdf()`
  （對角半透明文字戳章）／`mergePdfInto()`（接另一份 PDF 的頁面到
  最後）／`extractPdfPages()` + `parsePageRange()`（1-based 範圍字串
  如「1-3,5」解析、非破壞性——存成新檔案不動原檔）。旋轉/刪除/水印/
  合併都是**直接覆寫原檔，沒有版本歷史／復原機制**，UI 呼叫前都會跳
  確認對話框。
- **新增 `lib/docxEditor.js`**（mammoth + docx）：
  - `getDocxPreviewHtml()` 用 mammoth 轉 HTML，額外帶
    `styleMap: ['u => u']`（mammoth 預設不轉底線），回傳前用新的
    `lib/utils.js` `sanitizeDocxHtml()` 淨化，並偵測
    `hasComplexContent`（有沒有表格/圖片）。
  - `saveHtmlAsDocx()` 用一個簡單的 tokenizer（不是完整 HTML
    parser，只認得 mammoth 輸出跟 `execCommand` 會產生的標籤集合）把
    編輯後的 HTML 轉成 docx.js 的 `Paragraph`/`TextRun`，支援標題/
    粗體/斜體/底線/`<br>` 換行/單層項目清單跟編號清單。**已知限制**：
    表格降級成攤平純文字（保留內容、不保留結構）；圖片直接拿掉換成
    文字提示（要正確嵌回 `.docx` 得先解出圖片尺寸，這版刻意不做）；
    只支援單層清單。
- **新增 `lib/utils.js` `sanitizeDocxHtml()`**：正規表達式層級的黑名單
  淨化（拿掉危險標籤/on\* 事件屬性/行內 style；href 限制安全 scheme，
  src 圖片額外放行 `data:image/`，跟 `markdownToHtml()` 的
  `safeUrl()` 全面擋掉 `data:` 不一樣）——不是完整 HTML sanitizer，
  風險評估見 `lib/utils.js` 內的說明註解。
- **新增 IPC**（`lib/ipc/documents.js`）：`documents:getDocxPreview`／
  `documents:saveDocxEdit`／`documents:getPdfBytes`／
  `documents:pdfRotatePage`／`documents:pdfDeletePage`／
  `documents:pdfAddWatermark`／`documents:pdfMerge`／
  `documents:pdfExtractPages`，`preload.js` 對應曝露成
  `getDocxPreview`/`saveDocxEdit`/`getPdfBytes`/`pdfRotatePage`/
  `pdfDeletePage`/`pdfAddWatermark`/`pdfMerge`/`pdfExtractPages`。
- **`renderer/documents.js`／`documents.html`／`documents.css`**：原本
  單一的「預覽 Markdown」按鈕擴充成依副檔名顯示對應文字跟功能；`.docx`
  多一排格式化按鈕（粗體/斜體/底線/H1/H2/清單/段落，全部用
  `document.execCommand()`）+ 儲存按鈕；`.pdf` 多一個 `<canvas>` +
  上一頁/下一頁/縮放 + 編輯按鈕列；含表格/圖片的 `.docx` 會顯示警示
  banner，編輯／儲存前多一次確認對話框。
- 三語系（zh-TW／en／ja）各新增 27 個鍵（413 → 440，鍵集合一致）。
- **新增測試**：`test/pdfEditor.test.js`（11 項）、
  `test/docxEditor.test.js`（9 項，含完整 round-trip 驗證：docx →
  HTML → docx → HTML 後標題/粗體/斜體/底線/清單都還在）、
  `test/utils.test.js` 補 5 項 `sanitizeDocxHtml` 測試。這幾個模組都
  不依賴 Electron（純 fs + npm 套件），可以直接用真正的檔案在一般
  Node.js 環境下測試，不需要假 electron。
- **已知限制／尚待驗證**：
  - PDF 編輯（旋轉/刪除/水印/合併）沒有版本歷史或復原機制，操作前的
    確認對話框是唯一的安全網。
  - `.doc`（舊版二進位格式）不支援預覽/編輯。
  - `.docx` 編輯不保留表格結構、不保留圖片、只支援單層清單——內容跟
    格式複雜的文件不適合在這裡編輯，建議用 Word 之類的完整工具。
  - `pdf-lib`／`mammoth`／`docx` 三個新 dependency 讓 `node_modules`
    多了約 30MB（`pdf-lib` 24MB 是最大宗，主要是它同時打包了
    esm/cjs/瀏覽器版），沒有特別優化過打包後的體積，之後如果要瘦身可以
    考慮。
  - **尚未在真正的 Electron 視窗打開文件庫實際點過這些按鈕**——pdf.js
    的動態 `import()`／Web Worker 在 Electron 打包後（asar）環境下的
    行為，跟 CSP `worker-src` fallback 到 `script-src 'self'` 是否真的
    允許同源 worker 建立，都只做了程式碼層級的推理跟 Node.js 環境下的
    單元測試，**沒有實機驗證**。下次有辦法跑 `npm start` 時應該優先
    驗證這個功能，特別是 PDF 檢視畫面。

---

## [1.32.0]

### 知識庫新增：簡報製作提示詞範本（支援各家 AI、多場景）

- **背景**：知識庫目前有 5 組通用分類（含一個單獨的「簡報大綱生成」提示詞，
  `kb-default-005`）跟一批專案類的分階段套餐，但沒有一套完整的「從定位到
  上台」的簡報製作流程，也沒有針對不同簡報場合（提案、募資、學術、教學…）
  的專用範本。這次補上，刻意設計成**跟任何 AI 聊天工具都無關**——輸出一律
  是可以貼進任何簡報工具的結構化文字（大綱、逐頁重點、講者稿），不假設
  對話對象是 Claude／ChatGPT／Gemini／Grok 裡的哪一個，也不要求對方有
  「生成 pptx 檔案」這種特定平台功能。
- **新增 12 組提示詞**（`kb-default-057` ~ `068`，皆帶「簡報製作」標籤）：
  - 6 組通用流程（`057`~`062`）：簡報定位與觀眾分析 → 大綱與敘事結構規劃
    → 逐頁投影片內容撰寫 → 圖表與視覺化呈現建議 → 講者稿撰寫 → Q&A
    預演與內容審查。
  - 6 組場景化範本（`063`~`068`，各自再加一個既有分類標籤方便交叉篩選）：
    商業提案／銷售簡報（業務銷售）、產品發表簡報（行銷企劃）、投資人
    募資簡報 Pitch Deck（高階主管）、學術研究成果簡報（論文寫作）、
    專案進度報告簡報（專案經理）、教學／內部訓練簡報（人力資源）。這
    6 組是獨立的 `items`、不在任何 `groups` 套餐裡，場合已經很明確時
    可以直接單獨使用，跳過分階段流程。
- **新增分階段套餐**：`kb-group-default-008`「簡報製作全流程（定位 →
  大綱 → 內容 → 定稿）」，把上面 6 組通用流程串成 3 個階段（定位與大綱
  / 內容與視覺 / 講稿與預演），跟既有的論文寫作、SDD、OpenSpec 等套餐
  是同一套機制（`stages: [{ title, itemDefaultIds }]`，種入時展開成
  `steps`）。
- **資料異動方式**：直接對 `extractors/default-knowledge-base.json` 做
  文字級插入（保留既有的 2 空格縮排、CRLF 換行、單行 `tags` 陣列格式），
  沒有用 `json.dump` 整檔重新序列化——原本試過直接重新序列化，會因為
  Python 對短陣列的預設排版跟原檔手動維護的風格不一致，導致整個 68KB
  檔案被判定成「整份改寫」，這裡刻意避開。最終 diff 是純新增（92
  insertions, 0 deletions）。
- **升級路徑**：不用改任何程式碼——`lib/stores.js` 既有的
  `seeded-defaults.json` 增量補種機制（見 `PROJECT_SPEC.md` 第 3 節
  「內建預設範本」／「覆蓋安裝／升級補種」）會在既有使用者下次開啟知識庫
  時自動比對 `defaultId`、補進這 12 組新提示詞跟 1 組新套餐，不會動到
  使用者刪除/編輯過的既有範本。
- 內建提示詞範本總數 56 → 68（一般範本 40 → 52，企業角色範本維持 16 組
  不變），分階段套餐總數 7 → 8。三份 README（zh-TW／en／ja）跟
  `PROJECT_SPEC.md`（第 3 節「內建預設範本」與「內建分階段套餐範本」、
  檔案結構註記）同步更新對應數字與分類清單。
- 驗證方式：`extractors/default-knowledge-base.json` 通過 JSON 解析、
  無重複 `defaultId`、套餐引用的 `itemDefaultIds` 全部存在；`npm test`
  103 項全過（既有測試從檔案動態讀取項目/套餐數量，不是寫死的數字，
  所以這次資料量變動不需要改測試）；`npm run format:check` 全過。
  **尚未在真正的 Electron 視窗打開知識庫畫面確認排版跟複製功能**，也
  沒有實際拿這些提示詞去試跑過任何一家 AI 驗證產出品質——下次有辦法跑
  `npm start` 時應該優先驗證這個功能。

---

## [1.31.0]

### 新增：本地端 AI 服務支援（Ollama／LM Studio／Stable Diffusion WebUI／ComfyUI 等自訂網址工具）

- **背景**：Claude/ChatGPT/Gemini/Grok 這四個平台的網址是固定的（`lib/constants.js` 的
  `PLATFORM_URLS`），但接本機或內網跑的 AI 工具（LLM 聊天介面、文生圖 WebUI）沒有固定網址，
  是使用者自己起的服務、port 也常常不一樣（例如 Ollama 預設 `11434`、Stable Diffusion
  WebUI 預設 `7860`、ComfyUI 預設 `8188`）。這次新增第五種帳號類型 `platform === 'local'`，
  跟現有四個平台共用同一套 Session 隔離／`WebContentsView` 懶載入機制，差異只在網址是
  帳號自己存的 `url` 欄位、不是查固定表。
- **資料模型**：帳號物件新增選填欄位 `url`（使用者自訂網址）、`serviceType`
  （`'llm' | 'image' | 'custom'`，純顯示分類用），只有 `platform === 'local'` 才會有這兩個
  欄位；一般平台不受影響。`lib/windows.js` 新增 `resolveAccountUrl(account)` 統一決定
  `loadURL()` 目標；`addAccount()` 多接一個選填的 `extra: { url, serviceType }` 參數。
- **編輯與連線測試**：新增 `updateLocalService(accountId, patch)`——改網址不用刪掉帳號重建
  （session partition、Cookie、登入狀態都保留），若這個帳號的 `WebContentsView` 已經載入過，
  直接對現有 view 呼叫 `loadURL()` 導到新網址。新增 `testLocalServiceConnection(url)`，用
  Electron 的 `net.request`（main process 的 Chromium 網路層，不受頁面 CORS 限制），4 秒
  逾時，只看「連得上」不管 HTTP 狀態碼（本地服務常見的根路徑回 404 也算連得上）。新增對應
  IPC：`localServices:update`、`localServices:test`；`preload.js` 曝露
  `updateLocalService()`、`testLocalService()`。
- **新增帳號視窗**（`account.html`/`account.js`）：平台下拉選單多一個「本地端 AI 服務」
  選項，選了之後多顯示「服務類型」（LLM／文生圖／自訂）跟「本地服務網址」輸入框（附
  Ollama／SD WebUI／ComfyUI 範例網址），確認前檢查網址格式（必須 `http://` 或 `https://`
  開頭）。`window:openAccountWindow` IPC 與 `openAccountWindow()` 多接一個選填的
  `presetPlatform` 參數，透過 `win.loadFile(file, { query })` 帶 `?platform=local`
  查詢字串開窗，`account.js` 讀 `URLSearchParams` 直接預選平台、focus 到網址欄，不用使用者
  自己從下拉選單找。
- **側邊欄**：新增獨立群組「本地端 AI 服務」（跟「帳號」群組分開，同一份
  `appState.accounts` 資料，只是分開顯示），列出所有本地服務帳號，各自顯示服務類型 icon、
  連線狀態燈（🟢已連線／🔴連不上／⚪尚未檢查，開啟時自動測一次）、編輯（依序彈出三個
  `prompt()` 改名稱/類型/網址）、刪除；「＋ 新增本地服務」按鈕開新增帳號視窗並預選平台。
  點擊項目切換帳號，跟一般帳號共用同一套 `switchAccount()`。
- **設定視窗**：新增「本地端 AI 服務」管理區塊（集中列表，跟側邊欄是同一份資料，訂閱
  `accounts:changed` 廣播互相同步），每列顯示名稱、網址、連線狀態，可測試連線／編輯／
  刪除，「新增本地服務」按鈕同樣預選平台。
- **已知限制**：帳號清單拖曳排序（`accounts:reorder`）目前只在側邊欄「帳號」群組實作，
  「本地端 AI 服務」群組還沒有拖曳排序 UI；排序雲端帳號時，任何不在傳入順序清單裡的帳號
  （本地服務都屬於這種）會被整批接到 `appState.accounts` 陣列最後面，彼此相對順序不受
  影響，但不能反過來排到雲端帳號前面。不會自動偵測本機常見服務的預設 port，新增時要自己
  填網址。對話擷取／匯出（`extractors/domCapture.js`）沒有針對本地服務的 selector，套用到
  本地服務帳號會走一般的失敗路徑（擷取失敗訊息），不會壞掉但也抓不到內容——這些工具的介面
  差異太大，之後如果要支援得個別加 selector。
- 三語系（zh-TW／en／ja）各新增 24 個鍵（389 → 413，鍵集合一致）。三份 README 與
  `PROJECT_SPEC.md`（第 3.2、3.3、9.1、9.3、15 節）、`ROADMAP.md` 同步更新。
- 驗證方式：所有修改過的 JS 檔案通過 `node --check`；`npm test`（103 項，沿用既有測試，
  沒有新增本地服務相關的自動化測試——`lib/windows.js` 依賴 Electron runtime，既有測試策略
  是只測不依賴 Electron 的純函式，見 `test/utils.test.js` 開頭說明）；`npm run lint`
  0 錯誤（1 個既有、跟這次改動無關的警告：`extractors/domCapture.js` 的
  `capturePlatformConversation` 未使用）；`npm run format:check` 全過。**尚未在真正的
  Electron 視窗手動操作過**，也沒有接一個真正在跑的 Ollama/SD WebUI/ComfyUI 驗證過連線
  測試跟畫面顯示——下次有辦法跑 `npm start` 時應該優先驗證這個功能。
- 詳見 `PROJECT_SPEC.md` 第 3.2 節「本地端 AI 服務」與第 9.3 節第 5 項。

---

## [1.30.0]

### 新增：整合 OpenSpec（提示詞範本、專案範本、匯出成 openspec/changes/、匯入現有規格）

- **背景**：OpenSpec（[Fission-AI/OpenSpec](https://github.com/Fission-AI/OpenSpec)）是輕量的規格驅動
  開發框架，特別適合在既有專案上逐步修改行為：每個變更（change）放在
  `openspec/changes/<變更名稱>/`，內含 `proposal.md`、差異規格 `specs/<capability>/spec.md`
  （`ADDED`／`MODIFIED`／`REMOVED Requirements`，每個需求底下用 `#### Scenario:` 寫
  GIVEN／WHEN／THEN）、`design.md`、`tasks.md`；實作後封存，把差異合併進 `openspec/specs/`。
  Platter 不執行 OpenSpec CLI、不修改使用者專案的程式碼，整合的方式是「產生規格文件」與
  「和使用者專案的 OpenSpec 資料夾交換檔案」，之後由使用者用 OpenSpec 自己的指令驗證、實作、封存。
- **知識庫：8 組 OpenSpec 提示詞＋第 7 組分階段套餐**（`kb-default-049` ~ `056`，標籤「OpenSpec」；
  `kb-group-default-007`）：探索想法（Explore）、變更提案（proposal.md）、差異規格（Delta Specs）、
  技術設計（design.md）、任務清單（tasks.md）、依任務實作（Apply）、實作驗證（Verify）、封存前預演
  （Archive），分 4 個階段。提案／差異規格／設計／任務四組直接要求輸出 OpenSpec 的檔案格式且「只輸出
  檔案內容」；差異規格要求 MODIFIED 貼完整需求（封存時整段取代）、需求名稱與現有規格一字不差（找不到就標
  「待確認」、不杜撰）；探索、驗證、封存預演都是唯讀，封存預演明確聲明只是預演、實際封存要用
  `/opsx:archive`（或 `openspec archive`）。既有安裝升級後由增量補種自動補進。內建提示詞 48 → 56
  （一般 32 → 40），內建套餐 6 → 7。
- **專案管理：第 5 組內建專案範本「OpenSpec 變更流程」**（4 階段 8 步，重用上述提示詞）。
- **匯出成 `openspec/changes/<變更名稱>/`**：把提案、差異規格、設計、任務的產出寫成 OpenSpec 的資料夾
  結構。預設整份產出寫到步驟的預設檔案；產出裡用 `=== FILE: specs/<capability>/spec.md ===` 標記行
  拆成多個 capability；自動拿掉 AI 包在最外層的 ``` 圍欄與提案末尾的「建議變更名稱」行；沒有標記的差異
  規格寫到 `specs/general/spec.md` 並警告；沒有產出的步驟略過並回報。變更名稱建議值優先用 AI 在提案
  裡建議的名稱，否則由專案主題轉 kebab-case，全中文退回 `change-YYYYMMDD`。目標已有同名檔案時列出清單、
  確認才覆蓋；成功後提醒尚未 `openspec init` 的專案先初始化。
- **安全**：AI 的產出是不可信輸入。所有匯出路徑經 `sanitizeRelativePath()`（只允許相對 `.md` 路徑、片段
  只含英數與 `._-` 且不以點開頭所以沒有 `..`、深度與長度上限），不合法的標記記入 `rejected` 並在畫面顯示、
  不寫；寫檔前再確認最終路徑仍在變更資料夾內；變更名稱必須是 kebab-case。
- **匯入現有規格**（brownfield）：選專案資料夾（根目錄、`openspec` 或 `specs` 皆可），讀
  `openspec/specs/<capability>/spec.md`（單檔 > 200KB 略過），組成「既有規格」（上限 6 萬字，放不下的
  capability 註明未帶入）。標了 `useBaseContext` 的步驟（差異規格、封存預演）的提示詞會自動帶入，
  MODIFIED／REMOVED 才對得上現有需求名稱；其他步驟不帶。可隨時清除。
- **畫面**：帶匯出步驟的流程，「階段流程」分頁多一個「OpenSpec 整合」區塊（既有規格狀態與匯入／清除、
  變更名稱與匯出、即將匯出的檔案預覽、警告）；SDD／Scrum／瀑布式／MVP 範本不顯示。
- **資料模型**：範本步驟新增選填旗標 `artifact`、`useBaseContext`（建立專案時複製進
  `workflow.steps[]`、另存為範本時保留）；workflow 新增選填 `baseContext`。舊專案與舊備份不受影響。
  新增 `lib/openspec.js`（純函式與 `fs`，不依賴 Electron）與 4 個 IPC：`projects:workflow:openspecInfo`／
  `importOpenSpecSpecs`／`clearBaseContext`／`exportOpenSpec`。
- 三語系新增 19 個鍵（zh-TW／en／ja 各 389 個，鍵集合一致）。三份 README 與 `PROJECT_SPEC.md`（第 5 節、
  第 7.6 節範本表、新增第 7.7 節、第 15 節）同步更新。
- 驗證方式：新增 `test/openspec.test.js`（22 項：路徑檢查含各種穿越與怪字元、FILE 標記解析、匯出計畫、
  寫檔與穿越防護、匯入、內建範本與套餐完整性）與 `test/openspec-ipc.test.js`（8 項，假 dialog 直接呼叫
  真正 handler：建議名稱、匯入、匯出、覆蓋確認、穿越路徑）；`npm test` 103 項全過、lint 0 錯誤、
  `format:check` 全過。專案視窗另用 jsdom 載入真正的 `project.html` + `project.js` 並接上真實主行程
  handler 做端到端冒煙測試，全數通過。**尚未在真正的 Electron 視窗手動操作過**，也未用真正的 OpenSpec
  CLI 驗證過匯出的資料夾——下次請優先在一個裝了 OpenSpec 的專案上實測 `openspec validate` 是否能
  通過匯出的差異規格，並確認資料夾選擇對話框。
- 已知限制：不自動把提示詞送進 AI 帳號視窗；不做 OpenSpec 語法驗證（請用 `openspec validate`）；不處理
  `openspec/config.yaml` 與 `changes/archive/`；匯出不寫 `.openspec.yaml`（選填檔）。提示詞與流程依
  OpenSpec 官方文件（2026-09 查閱）撰寫，OpenSpec 更新格式或指令名稱時請同步調整
  `kb-default-049` ~ `056`。
- 詳見 `PROJECT_SPEC.md` 第 7.7 節。

---

## [1.29.0]

### 新增：專案管理支援專案範本與 SDD 階段流程（輸入主題，依各階段提示詞逐步執行）

- **需求**：在專案管理裡加入 SDD（規格驅動開發）的功能，支援專案範本（提供多組軟體
  開發預設），輸入主題後可以依各階段的提示詞逐步執行專案。
- **從範本建立專案**：專案清單工具列新增「從範本建立」，選一組範本、輸入專案主題（必填）
  與專案名稱（選填，預設用主題）即可建立。內建 4 組軟體開發範本：**SDD 規格驅動開發**（原則與
  規格 → 規劃與任務 → 檢查與實作，重用知識庫 7 組 SDD 提示詞）、**敏捷 Scrum 迭代開發**、
  **傳統瀑布式開發**、**MVP 快速原型（精實驗證）**。
- **階段流程**：從範本建立的專案多一個「階段流程」分頁。左側依階段列出步驟與進度，右側依序執行：
  預覽「已帶入專案主題與前面步驟產出」的完整提示詞 → 複製（順便標成進行中）→ 把 AI 的產出貼回
  來（離開輸入框即存檔）→ 標記完成並前往下一步。可選擇前面產出「全部帶入／只帶入上一步／
  不帶入」，可隨時修改專案主題、編輯單一步驟的提示詞原文，上一步／重設為待辦；重開視窗會停在
  上次的步驟。
- **每個步驟同步成一個專案任務**，狀態雙向一致（步驟 ↔ 任務清單），所以既有的任務清單、月曆、
  甘特圖、進度、到期提醒都直接可用。
- **專案範本可自訂**：專案的「另存為專案範本」把目前流程（含在專案內改過的提示詞，不含產出與
  狀態）存成自己的範本，之後可在「從範本建立」選用或刪除；內建範本唯讀。自訂範本納入備份匯出與
  還原。
- **資料模型**：專案新增選填欄位 `workflow`（`topic`、`contextMode`、`currentStepId`、
  `steps[{ id, stage, title, prompt, output, status, taskId }]`）；階段沿用套餐的 `stage`
  字串做法。提示詞在建立專案時「快照」進專案，之後改動或刪除知識庫項目不影響已建立的專案；
  但範本引用知識庫內建提示詞時，會優先用**使用者知識庫裡**調整過的版本，被刪掉才退回內建檔。
  舊專案沒有 `workflow`，完全不受影響；一般「儲存專案」不會蓋掉 `workflow`。
- **邏輯**：新增 `lib/workflow.js`（範本展開、組合提示詞、步驟/任務狀態同步、另存範本，純函式）；
  組合提示詞只在主行程做，畫面端只顯示與複製。新增 IPC：`projectTemplates:list`／`delete`、
  `projects:createFromTemplate`、`projects:workflow:setMeta`／`updateStep`／`setStepStatus`／
  `compose`／`saveAsTemplate`；快速搜尋的專案比對涵蓋專案主題。
- 三語系新增 39 個鍵（zh-TW／en／ja 各 370 個，鍵集合一致）。三份 README 與 `PROJECT_SPEC.md`
  （新增第 7.6 節、更新第 15 節）同步更新。
- 驗證方式：新增 `test/workflow.test.js`（14 項：純函式、內建範本資料完整性——每個步驟都能
  解析出提示詞、SDD 範本與 SDD 套餐順序一致）與 `test/projects-workflow-ipc.test.js`（12 項：
  建立、狀態雙向同步、組合提示詞、儲存專案不蓋掉流程、另存/刪除範本、舊資料載入、搜尋主題）；
  `npm test` 73 項全過、lint 0 錯誤、`format:check` 全過。專案視窗另用 jsdom 載入真正的
  `project.html` + `project.js`、並把 `workspaceAPI` 接到真正的主行程 handler 做端到端冒煙測試
  （建立 → 複製 → 貼產出 → 完成 → 下一步帶入產出 → 帶入方式 → 儲存專案 → 另存/刪除範本），
  全數通過。**尚未在真正的 Electron 視窗手動操作過**（開發環境沒有顯示器），下次能跑
  `npm start` 時請優先確認「階段流程」分頁兩欄版面（步驟清單 230px + 詳情）與捲動。
- 已知限制：沒有內建範本編輯器（要客製就「從範本建立 → 在專案內改提示詞 → 另存為範本」）；
  提示詞由使用者手動複製到 AI 網頁帳號並手動貼回產出，不會自動送進任何帳號視窗。
- 詳見 `PROJECT_SPEC.md` 第 7.6 節。

---

## [1.28.0]

### 新增：SDD（規格驅動開發）提示詞範本與分階段套餐

- **需求**：想在知識庫直接有一套 SDD（Spec-Driven Development）的提示詞
  範本套餐——先把「做什麼／為什麼」寫成可檢驗的規格，再由規格驅動技術
  規劃、任務拆解與實作，不用每次自己從零寫這一串提示詞。
- **新增 7 組提示詞**（`extractors/default-knowledge-base.json`，標籤
  「SDD規格驅動開發」，`kb-default-042` ~ `048`，流程參考 GitHub Spec
  Kit）：專案原則（Constitution）、功能規格撰寫（Specify）、規格釐清
  （Clarify）、技術規劃（Plan）、任務拆解（Tasks）、一致性分析
  （Analyze）、依任務實作（Implement）。格式沿用一般範本的「角色與目標／
  輸入資訊／輸出要求」，資訊不足時要求明確標示、不自行編造。幾個刻意的
  設計：規格只談做什麼、不談技術棧；釐清最多問 5 題且使用者回答前不擅自
  改規格；分析是唯讀、不修改文件；實作遇到與規格衝突要停下來詢問。
- **新增第 6 組內建分階段套餐「SDD 規格驅動開發流程（規格 → 規劃 →
  實作）」**（`kb-group-default-006`）：階段 1 原則與規格（3 步）、階段 2
  規劃與任務（2 步）、階段 3 檢查與實作（2 步）。建議在同一段 AI 對話裡
  依序貼上，並把每份產出存成 `constitution.md`／`spec.md`／`plan.md`／
  `tasks.md`。
- **升級**：沿用 1.26.x／1.27.0 的增量補種機制，已安裝的使用者升級後會
  自動補進這 7 組提示詞與這 1 組套餐；其他內建套餐若使用者先前刪除過，
  不會被補回來，使用者自己建立或修改過的內容完全不動。內建提示詞總數
  41 → 48（一般 25 → 32、企業角色範本 16），內建套餐 5 → 6。
- 三份 README（繁中／English／日本語）與 `PROJECT_SPEC.md` 第 5 節、第 15
  節檔案結構的數量與說明同步更新。
- 驗證方式：`test/knowledge-bundles.test.js` 新增 3 項（SDD 套餐的階段與
  步驟順序、7 組提示詞都有被套餐引用、從上一版升級只補 SDD 提示詞與
  套餐並正確引用新補進來的提示詞）；`npm test` 47 項全過、lint 0 錯誤、
  `format:check` 全過。純資料／文件變更，沒有修改任何程式邏輯。

---

## [1.27.0]

### 新增：提示詞套餐支援「分階段」組合，並內建 5 組分階段套餐範本

- **需求**：知識庫的「套餐」原本只是一份依序執行的扁平步驟清單，沒辦法表達
  「先規劃、再撰寫、最後潤色投稿」這種分階段的工作流程，也沒有任何內建
  套餐範本可以直接用。這次讓套餐可以把步驟分成多個階段，每個階段是一組
  可以一次複製、貼進同一段 AI 對話的提示詞組合，並內建 5 組現成範本。
- **套餐 step 新增選填欄位 `stage`（階段名稱）**：相鄰且 `stage` 相同的步驟
  屬於同一階段，順序仍完全由 `steps` 陣列決定。舊資料沒有這個欄位（或空
  字串）代表沒有分階段，`loadKnowledgeBase()` 載入時補成空字串，畫面與
  行為跟以前一模一樣；JSON 匯出／匯入、備份還原都原樣帶著這個欄位。
  `lib/utils.js` 新增純函式 `groupStepsByStage()`（依 `stage` 切成連續區段）
  與 `buildGroupFromDefault()`（把內建範本展開成套餐）。
- **內建 5 組分階段套餐範本**（`extractors/default-knowledge-base.json` 新增
  `groups`，標籤都帶「分階段範本」，全部用既有內建提示詞的 `defaultId`
  組成，沒有新增提示詞）：論文寫作全流程（規劃 → 撰寫 → 投稿）、研究計畫
  申請書（問題 → 規劃 → 成果與經費）、軟體專案開發（需求 → 評估 → 驗收）、
  醫療器材軟體合規流程（需求 → 風險 → 隱私）、專案例行溝通循環（會議 →
  回報 → 彙報）。範本用 `stages: [{ title, itemDefaultIds }]` 描述，種入時
  對照使用者知識庫實際的 item id 展開成步驟。
- **種子與升級補種**：全新安裝時提示詞與套餐一起種入；覆蓋安裝／升級沿用
  `seeded-defaults.json` 機制，新增 `knowledgeGroups` 記錄已種過的內建套餐
  `defaultId`。從 1.26.x 升級（沒有這個紀錄）會補進全部 5 組內建套餐一次，
  之後使用者刪除或編輯都不會被補回來；引用的內建提示詞已被使用者刪掉的
  步驟略過，整份套餐一步都對不上就不種。使用者自己建立的套餐完全不動。
- **套餐編輯器（`knowledge.html` / `knowledge.js`）**：步驟清單改為「階段
  標題列 + 步驟列」混排。步驟屬於上方最近的階段標題，用 ↑↓ 越過標題列即可
  把步驟移到別的階段；新增「＋ 階段」按鈕；階段標題可直接改名（清空退回
  「階段 N」）、顯示該階段完成進度、可「複製本階段」（一次複製該階段所有
  提示詞）、可移除標題（步驟保留）。儲存時標題攤平成每個步驟的 `stage`；
  沒有步驟的空階段不會被存下。
- **複製行為**：「複製全部內容」有分階段時每個階段前加一行
  `=== 階段名稱 ===`，沒有分階段的套餐輸出跟原本完全相同。單步複製與整份
  複製改為「有 `content` 用 `content`，空的就組合系統＋使用者提示詞」，修正
  只填系統／使用者兩欄的項目在套餐裡複製出空字串的問題。
- **其他**：套餐清單顯示階段數；套餐全文搜尋（知識庫視窗與 `Ctrl/⌘+K` 命令
  面板）也比對階段名稱；Markdown 匯出在每個階段前加 `### 階段名稱`（步驟
  編號跨階段連續）；勾選／移動步驟後保留清單捲動位置。
- 三語系（`zh-TW.json`/`en.json`/`ja.json`）同步新增 9 個鍵
  （`knowledge.addStep`／`addStage`／`stageHint`／`stageNamePlaceholder`／
  `stageDefaultName`／`copyStage`／`removeStage`／`stageCount`，並調整
  `knowledge.groupSteps` 文字），三個檔案鍵數維持一致（331 個）。
  三份 README（繁中／English／日本語）與 `PROJECT_SPEC.md` 第 5 節同步更新。
- 驗證方式：新增 `test/knowledge-bundles.test.js`（13 項：純函式、內建範本
  資料完整性、以假 electron 直接執行 `lib/stores.js` 種子邏輯——全新安裝、
  從 1.26 升級補種、刪除後不重複補種、舊資料補欄位）與
  `test/knowledge-bundles-ipc.test.js`（5 項：儲存、Markdown 匯出、JSON 匯入、
  命令面板搜尋）；`npm test` 44 項全過、`npm run lint` 0 錯誤、
  `npm run format:check` 全過。套餐編輯器另用 jsdom 載入真正的
  `knowledge.html` + `knowledge.js` 做互動冒煙測試（跨階段移動、勾選持久化、
  改名、加階段、空階段儲存、複製內容、搜尋階段名稱）全數通過。**尚未在真正
  的 Electron 視窗手動操作過**（開發環境沒有顯示器），下次能跑 `npm start`
  時請優先確認階段標題列的版面與捲動。
- 詳見 `PROJECT_SPEC.md` 第 5 節（內建預設範本、覆蓋安裝／升級補種、內建
  分階段套餐範本）與第 5.3 節（群組順序提示詞套餐，可分階段）。

---

## [1.26.0]

### 新增：企業角色預設提示詞範本庫（系統提示詞／使用者提示詞拆分）

- **需求**：知識庫原本內建的 25 組提示詞範本都是單一 `content` 欄位、
  沒有跟任何角色綁定，使用者想要「一開機就能針對某個企業職務（HR／
  行銷／業務……）直接套用一組現成提示詞」得自己從零建立角色、自己
  寫提示詞、自己想怎麼拆系統設定跟當次任務。這次補上這一塊：內建
  企業角色清單 + 每個角色配好的多組任務範本，並且範本本身拆成
  「系統提示詞（人設／規則）」跟「使用者提示詞（這次要做的事）」
  兩段，對應大部分 AI 平台「System Prompt / Custom Instructions」跟
  「對話輸入框」是分開欄位的實際用法。
- **新增 `extractors/default-roles.json`**：8 種常見企業職務角色——
  人力資源（HR）、行銷企劃、業務銷售、客服支援、專案經理、軟體工程師、
  財務會計、高階主管，`id` 用固定字串（`role_hr` 等），`color` 沿用
  第 4 節既有的 8 色色票（剛好一色一個角色）。`lib/stores.js` 的
  `loadAppState()` 在 `app-state.json` **完全不存在**時（全新安裝）
  用這份檔案當 `roles` 的起始內容，跟 `seedDefaultKnowledgeBase()`／
  `loadSelectors()` 是同一套「只在檔案不存在時種子一次，之後永遠讀
  使用者版本」的慣例——即使使用者把角色刪光，重開程式也不會被種子
  資料覆蓋回來。
- **`extractors/default-knowledge-base.json` 從 25 組擴充到 41 組**：
  新增 16 組「企業角色範本」（每個角色 2 組，標籤 `企業角色範本` +
  角色名稱），例如 HR 的「職缺說明（JD）撰寫」「面試問題設計」、
  業務的「業務開發信（Cold Email）」「業務提案大綱」、工程師的
  「Pull Request 說明撰寫」「Bug 回報整理」等。每組都帶：
  - `roleIds`：對應到上面 8 個角色的固定 id，讓側邊欄「預設提示詞」
    （第 3.1、8 節）一開機就依角色分好內容，不用手動配置。
  - `systemPrompt` / `userPrompt`：知識庫項目schema 新增的拆分欄位
    （見下），系統提示詞定義這組範本的人設跟輸出規範，使用者提示詞是
    帶 `[請填入]` 占位符的具體任務範本，沿用既有 25 組範本「資訊不足
    要求使用者補、不自己編造」的風格。
  - `content`：兩者合併起來的版本，向下相容既有只認 `content` 的
    全文搜尋／Markdown 匯出／側邊欄單顆複製按鈕邏輯，不用同時改一輪
    所有消費端才能上線這個功能。
- **知識庫項目 schema 新增 `systemPrompt`／`userPrompt`（第 5.1 節）**：
  不只企業角色範本能用，任何提示詞項目現在都可以選擇拆成這兩欄。
  `knowledge.html` 編輯器新增對應的兩個 textarea，各自有獨立的
  「複製內容」按鈕（`btn-copy-system`／`btn-copy-user`）；原本的
  `content` 欄位保留（標示「若已填寫上方兩欄可留空」），主要的
  「複製內容」按鈕在 `content` 為空時自動改複製系統＋使用者提示詞
  組合版本。全文搜尋（`itemMatchesQuery`、`lib/ipc/search.js` 的
  跨模組快速搜尋）、Markdown 匯出（`knowledge:exportAll`）都同步支援
  比對／輸出這兩個新欄位；JSON 匯出／匯入、備份還原（`lib/ipc/
settings.js`）也都補齊欄位預設值，舊資料檔案（沒有這兩個欄位）
  一律視為空字串，不影響既有項目的顯示與編輯。
- **側邊欄「預設提示詞」（第 3.1、8 節）**：項目有拆分系統／使用者
  提示詞時，清單每一列改成顯示兩顆小按鈕（`S`／`U`，各自有 tooltip
  「複製系統提示詞」「複製使用者提示詞」），可以分別一鍵複製到剪貼簿；
  沒有拆分的舊式項目維持原本單顆 `⧉` 複製按鈕不變，兩種項目可以在
  同一份清單裡混用。
- 三語系（`zh-TW.json`/`en.json`/`ja.json`）同步新增
  `knowledge.systemPrompt`/`knowledge.userPrompt`/
  `knowledge.systemPromptPlaceholder`/`knowledge.userPromptPlaceholder`/
  `knowledge.contentHint`/`knowledge.splitPromptBadge`/
  `sidebar.copySystemPrompt`/`sidebar.copyUserPrompt`，三個檔案 key
  數量維持一致（323 個），確認過沒有語系互相缺 key。
- 驗證方式：獨立寫一段腳本直接呼叫跟 `lib/stores.js` 種子邏輯等價的
  程式碼（不依賴 Electron），確認全新安裝情境下 8 個角色會被種進
  `roles`、41 組知識庫項目會被種進 `items`、16 組企業角色範本的
  `roleIds` 全部對得到剛種好的角色 id（沒有懸空引用）、16 組都同時
  帶有非空的 `systemPrompt`／`userPrompt`。另外用 `node --check` 確認
  所有修改過的 `.js` 檔語法正確、用 `python3 -m json.tool` 等價方式
  確認所有修改過的 `.json` 檔仍是合法 JSON、`npm test`（26 個測試，
  跟修改前一樣 21 過 5 個既有失敗——這 5 個失敗跟這次改動無關，
  是既有環境缺少 Electron/原生模組造成的，修改前後結果一致）、
  `npx prettier --check` 對所有修改過的檔案（含新增的 2 份 JSON）全過。
- 詳見 `PROJECT_SPEC.md` 第 4 節（帳號角色機制：內建預設角色段落）、
  第 5 節（知識庫：內建預設範本、5.1 提示詞項目、5.6 匯出／匯入）。

---

## [1.25.1]

### 修正：帳號沒有真正懶載入，多帳號時拖累滾動流暢度

- **根因**：`createMainWindow()` 開機時會呼叫 `rebuildAllAccountViews()`，
  這個函式原本對**每一個**帳號都立刻建立 `WebContentsView` 並
  `loadURL()`——README/文件宣稱的「懶載入：開機只載入上次選中的帳號，
  其他帳號等你點了才載入」從來沒有真正落實。帳號數量一多（例如 7
  個），就是 7 個完整的 Claude/ChatGPT 等級 React SPA 同時在背景跑，
  吃掉可觀的 CPU/記憶體/GPU 合成資源，容易拖累目前正在用的那一個的
  滾動流暢度，就算其他 6 個都沒有顯示在畫面上也一樣。
- **修正**：帳號的 `WebContentsView` 建立拆成兩階段——
  `registerAccountMeta()` 只登記平台/名稱，不建立任何頁面；
  `ensureAccountViewLoaded()` 才是真正的 `loadURL()`，只在這個帳號
  **第一次**被切換過去時觸發（`switchAccount()` 內部呼叫）。開機時
  只會懶載入一個帳號：`state.appState.ui.lastActiveAccountId`（新增
  的欄位，`switchAccount()` 每次呼叫都會更新並存檔）指到的那個，不是
  每次都固定回到帳號清單第一個，也不是全部帳號都載入。
- 已經載入過的帳號切換時不會重新建立或重新整理，行為跟修正前一樣是
  單純 `setVisible()` 切換，不影響切換帳號的無縫體驗，只是「第一次
  用到才載入」。
- 連動調整：備份還原時的帳號還原、`settings:addExtension`/
  `toggleExtension`/`removeExtension`/`clearCache` 這幾個原本會遍歷
  「所有帳號的 WebContentsView」的地方，現在都會跳過還沒載入頁面的
  帳號（不會噴錯，等那個帳號真正載入時會自動套用當時最新的擴充功能
  清單）；「測試擷取」功能找同平台帳號時，也只會找已經載入頁面的，
  找不到會提示先開一個該平台的帳號，跟原本文件描述的「找第一個開著
  的同平台帳號」意圖一致（懶載入之前所有帳號永遠都是「開著」的，
  這個防呆之前沒有實際意義，現在才真正生效）。
- 驗證方式：用 mock 過 `electron` 的環境直接呼叫 `lib/windows.js` 的
  真正 production 函式，模擬 7 個帳號的情境，確認開機後只有 1 個帳號
  真的載入頁面（不是 7 個）、切換帳號時才觸發載入、切回已載入過的
  帳號不會重新建立、重開機會回到上次使用的帳號而不是固定第一個、
  移除未載入/已載入/當前帳號三種情況都正常運作、擴充功能相關 IPC 跟
  「測試擷取」在有未載入帳號時不會噴錯。`node --check`、88 個 IPC
  頻道確認（沒有新增/減少）、`npm run lint`（0 錯誤）、`npm test`
  （26 個測試全過）、`npm run format:check` 都重新跑過確認。
- 詳見 `PROJECT_SPEC.md` 第 3.2、3.3 節（這兩節原本描述的也是「開機
  全部載入」的舊行為，這次一併修正成跟實作一致）。

## [1.25.0]

### 新功能：知識庫內建 25 組跨領域提示詞範本

- 新增 `extractors/default-knowledge-base.json`：涵蓋 5 個領域各 5 組
  提示詞範本——企業日常作業（會議紀要整理、週報/月報撰寫、商務電子
  郵件草稿、SOP/操作手冊撰寫、簡報大綱生成）、醫療軟體研發（IEC
  62304 需求規格、HL7/FHIR 資料介接說明、ISO 14971 風險管理分析、
  臨床決策支援邏輯審查、病患資料隱私合規檢查）、論文寫作（文獻綜述
  架構、摘要撰寫、研究方法章節、段落潤色、審稿意見回覆）、研究計畫
  （背景動機、目的與具體目標、方法與時程、預期成果、經費編列）、
  專案開發（需求訪談整理、技術選型評估、Code Review 檢查清單、專案
  風險評估、測試計畫與驗收標準）。
- 每組範本都用 Markdown 格式撰寫（標題／角色與目標／輸入資訊／輸出
  要求），並刻意在輸出要求裡加入「資訊不足就明確指出來問使用者，
  不要自己編造/假設」的指示，避免範本教使用者產出看起來有依據、
  實際上是 AI 憑空編造的內容（醫療、學術、研究計畫這幾個領域尤其
  重要）。
- `lib/stores.js` 的 `loadKnowledgeBase()`：`knowledge-base.json`
  完全不存在時（全新安裝、第一次開啟知識庫）才會用這份範本當起始
  內容，寫入磁碟後之後永遠讀使用者自己的版本——跟 `loadSelectors()`
  用 `default-selectors.json` 當起手式是同一套慣例。使用者可以自由
  編輯、刪除、或增加更多範本，內建範本不是唯讀的；就算使用者刪光
  所有項目再存檔，之後也不會又跑出範本（因為檔案已經存在過了）。
- 驗證方式：用 mock 過 `electron` 的環境直接呼叫
  `lib/stores.js` 的真正 production 函式，驗證全新安裝時的種子邏輯、
  第二次載入時 id 保持一致（不是每次重新生成）、使用者刪光後存檔
  不會重新種入三種情境。`node --check`、`npm run lint`（0 錯誤）、
  `npm test`（26 個測試全過）、`npm run format:check` 都重新跑過
  確認。
- 詳見 `PROJECT_SPEC.md` 第 5 節。

## [1.24.1]

### 調整：子視窗寬度不超過主視窗寬度的 80%

- 八個獨立子視窗（新增帳號/知識庫/設定/虛擬團隊/專案計畫/文件庫/
  對話庫/日誌主控台）原本開窗寬度是每個視窗各自寫死的固定值（例如
  專案計畫視窗固定 1040px），主視窗開得比較小的時候，子視窗反而會比
  主視窗還寬，看起來很不協調。
- `lib/windows.js` 的 `openChildWindow()` 現在會取「各視窗原本設計的
  寬度」跟「主視窗目前寬度的 80%」兩者較小值，`minWidth` 仍然是最終
  下限（主視窗開得極窄時，子視窗會停在 `minWidth`，比 80% 主視窗寬度
  還寬一點，這是刻意接受的取捨，不然版面會擠爆）。只限制寬度，高度
  維持各視窗原本依內容調校過的設計值不變。
- 驗證方式：用 mock 過 `electron` 的環境（另外補上 `getBounds`/
  `setBounds`）直接呼叫 `lib/windows.js` 的真正 production 函式，測了
  三種主視窗寬度（很寬/中等/很窄）下專案計畫視窗跟新增帳號視窗各自
  算出來的寬度是否符合預期，以及 `mainWindow` 不存在時的防呆回退、
  視窗已開著時二次呼叫不受影響。`node --check`、`npm run lint`（0
  錯誤）、`npm test`（26 個測試全過）、`npm run format:check` 都重新
  跑過確認。
- 詳見 `PROJECT_SPEC.md` 第 9 節。

## [1.24.0]

### 新功能：匯出對話時可以另存路徑、同時加入知識庫

- 主視窗側邊欄「匯出當前對話」按鈕改成先跳一個選項對話框，不是直接
  匯出：選 Markdown/JSON 格式、可以按「另存到其他路徑」這次額外跳
  存檔對話框自己選位置（即使「設定 → 儲存路徑」開了「使用預設路徑時
  不再詢問」，這次按了也還是會跳，不會被全域設定蓋過去）、可以勾選
  「同時加入知識庫」把這次匯出的對話內容另外存一份成知識庫項目
  （固定存成 Markdown，跟這次選的檔案格式無關）。
- 「同時加入知識庫」的勾選狀態會記住，下次打開對話框預設沿用上次
  選的值（`settings:setAutoAddToKnowledgeOnExport`）；「另存到其他
  路徑」是單次選擇，不持久化。
- `export:current` IPC 頻道的參數從單一 `format` 字串改成
  `{ format, forceChoosePath, addToKnowledge }` 物件。
- 驗證方式：用 mock 過 `electron` 的環境直接呼叫
  `lib/conversationCapture.js` 的真正 production 函式，驗證 5 種情境
  （預設跳對話框且取消、開啟略過對話框後自動存檔、`forceChoosePath`
  即使在略過對話框時仍會跳出、`addToKnowledge` 確實新增知識庫項目、
  不勾選則不新增），以及 `setAutoAddToKnowledgeOnExport` 確實寫入
  磁碟持久化。
- 詳見 `PROJECT_SPEC.md` 第 12 節。

## [1.23.0]

### 新功能：跨模組快速搜尋（命令面板）

- 主視窗按 `Ctrl/⌘+K`（或點側邊欄「快速搜尋」按鈕）開啟命令面板，
  即時橫跨知識庫（提示詞＋套餐）、文件庫、對話庫、專案（含任務、
  issue）搜尋，方向鍵選、Enter 跳到選中的項目，Esc 或點背景關閉。
- 新增 IPC 頻道 `search:global`／`search:jumpTo`／
  `search:consumePendingSelection`，以及只送給單一視窗的
  `search:select` 事件。「跳到項目」用主動拉取（視窗剛開啟時）+
  即時推送（視窗已經開著時）雙路徑處理，避開「訊息在 renderer 開始
  監聽之前就送達、直接遺失」的 race condition，詳見
  `PROJECT_SPEC.md` 第 9.8 節。
- 驗證方式：用 mock 過 `electron` 的環境直接呼叫
  `lib/ipc/search.js` 的真正 production handler，驗證搜尋涵蓋四個
  模組的比對準確性，以及 `jumpTo`/`consumePendingSelection` 「拉取
  一次就清空」的行為。

### 新功能：任務到期日提醒

- 側邊欄「專案計畫」按鈕新增紅色角標，顯示所有專案裡「還沒完成、
  到期日 ≤ 今天」的任務與 issue 加總。有新的到期項目時另外跳一次
  系統原生通知（三語文案，依語言設定顯示）。
- App 開機立刻檢查一次，之後每小時再檢查一次；任何一次專案存檔／
  狀態切換／工時紀錄異動之後也會立刻重算一次，不用等下一次排程。
- 用「這批到期項目 id ＋逾期/今天到期狀態」組出的指紋比對是否跟上次
  通知過的內容相同，避免同一批到期項目每小時排程檢查都彈一次重複
  通知。
- 新增 `lib/reminders.js`、IPC 頻道 `projects:getDueSummary`、廣播
  `projects:changed`／`reminders:changed`。
- 驗證方式：用 mock 過 `electron` 的環境驗證逾期/今天到期/已完成
  三種任務狀態的判斷邊界、通知去重指紋邏輯（新增到期項目才會再通知）、
  以及標記任務完成後角標數字立刻反映。

### 新增：日文語系（UI 實際可用，不只是 README）

- 新增 `renderer/locales/ja.json`，完整翻譯全部 key（跟 `en.json`／
  `zh-TW.json` 的 key 集合與 `{變數}` 佔位都逐一比對過完全一致）。
  「設定 → 語言」下拉選單新增「日本語」。

### 修正：補上被靜默吞掉的錯誤

- `lib/windows.js` 的 `removeAccount()` 清除 session 資料失敗、
  `lib/ipc/settings.js` 的 `settings:addExtension`／
  `settings:toggleExtension` 套用擴充功能失敗，這三處原本都是
  `.catch(() => {})`，失敗了使用者完全不知道、也查不到任何紀錄。
  現在都會 `logError()`，可以在日誌主控台的錯誤日誌分頁看到。

### 文件

- `PROJECT_SPEC.md` 補上第 7.1 節到期日提醒說明、第 9.8 節命令面板
  完整規格、第 11 節日文語系說明、第 13 節新增的廣播事件，第 15 節
  檔案結構補上 `lib/reminders.js`／`lib/ipc/search.js`。
- 三個語系的 `README.md`／`README.en.md`／`README.ja.md` 功能總覽表格
  跟檔案結構樹一併同步更新（順便把英文版原本缺漏的「虛擬團隊主控台」/
  「文件庫」項目補齊，這兩份 README 之前就已經比中文版落後一截）。
- 全部驗證：`node --check`、mock `electron` 環境下的 87 個 IPC 頻道
  確認、`npm run lint`（0 錯誤）、`npm test`（26 個測試全過）、
  `npm run format:check`。

## [1.22.0]

### 新功能：專案加入工時紀錄

- 專案計畫管理的每個任務新增「工時紀錄」：任務列上的「⏱」按鈕展開/
  收合面板，列出已記錄的工時（日期＋小時數＋備註，可個別移除），下方
  是新增一筆的小表單（日期預設今天）。任務清單上方顯示這個專案所有
  任務加總的總工時。
- 跟任務狀態切換一樣，新增/移除工時紀錄透過獨立的
  `projects:task:addTimeEntry`／`removeTimeEntry` 即時持久化，不用等按
  「儲存專案」——工時紀錄本質上是「事件」，即時存檔可以避免記完工時
  忘記按儲存就白做工。新建立、還沒儲存過的任務暫時不能記工時（面板會
  提示「請先儲存專案」），因為後端還沒有對應的任務 id 可以掛。
- **特別留意的地方**：`projects:save` 原本用「白名單重建」的寫法組出
  儲存後的 task 物件（只列出明確要保留的欄位），這次加欄位時如果沒把
  `timeEntries` 加進這個白名單，就會重現跟對話庫 `linkedDocumentIds`
  一模一樣的 bug（見 1.21.1）——使用者改個任務標題存檔，工時紀錄就會
  被清空。這次已經加進白名單並用重現腳本實際驗證過存檔後工時紀錄還在。
- 詳見 `PROJECT_SPEC.md` 第 7.1 節。

### 新功能：文件管理改名為「文件庫」，支援 Markdown 預覽

- UI 上「文件管理」統一改名為「文件庫」（側邊欄按鈕、視窗標題、
  `PROJECT_SPEC.md`／`README.md` 對應段落）——英文版 `documents.title`
  本來就已經是 "Document Library"，這次讓中文版跟既有的英文命名一致，
  順便把 `sidebar.documents` 的英文也統一成 "Document Library"（原本是
  "Documents"）。
- 副檔名是 `.md`/`.markdown` 的文件，編輯區多一個「預覽 Markdown」
  按鈕，點下去就地顯示轉換後的 HTML，不用另外開外部程式。
- 新增 `lib/utils.js` 的 `markdownToHtml()`：刻意手刻的極簡 Markdown→
  HTML 轉換器（不是引入 npm 套件——CSP 本來就不允許載入外部 CDN 函式庫，
  自己刻也讓安全邊界完全可控），涵蓋標題／粗體斜體／行內程式碼／
  fenced code block／有序無序清單／引言／連結圖片／分隔線／段落，
  不支援表格、巢狀清單、原始 HTML 穿透。
- **安全性**：來源文字一律先做 HTML escape，只有轉換器自己產生的標籤
  是未跳脫的——來源文字裡任何看起來像標籤的內容（例如 `<script>`）都
  會被當成純文字顯示；連結／圖片網址限制只接受 `http(s)://`、
  `mailto:` 或相對路徑，`javascript:`/`data:` 一律擋掉換成 `#`。這是
  這個 renderer 目前唯一會用 `innerHTML` 插入動態內容的地方，安全邊界
  完全建立在主程序這邊的轉換器上。
- 新增 IPC 頻道 `documents:getMarkdownPreview`：只接受 `.md`/`.markdown`
  副檔名，找不到文件或檔案遺失會回傳對應錯誤。
- 驗證方式：`test/utils.test.js` 新增 10 筆 `markdownToHtml` 測試，
  涵蓋語法覆蓋跟三個安全性案例（`<script>` 逸出、`javascript:`／
  `data:` 連結被擋）；另外用 mock 過 `electron` 的環境直接呼叫真正的
  production handler，驗證成功／找不到文件／非 Markdown 副檔名三種
  情況。`npm run lint`（0 錯誤）、`npm test`（26 個測試全過）、
  `npm run format:check` 都重新跑過確認。
- 詳見 `PROJECT_SPEC.md` 第 8 節。

## [1.21.1]

### 修正：對話庫的文件關聯每次儲存都會被清空

- **根因**：`renderer/conversation.js` 的 `currentDraft()`（「儲存」按鈕
  組出來要送給後端的資料）從來不包含 `linkedDocumentIds`——這個欄位是
  「新增關聯」/「取消關聯」按鈕各自透過獨立的
  `conversations:linkDocument`/`unlinkDocument` 頻道維護的，編輯表單本來
  就不該碰它。但後端 `conversations:save` 遇到沒帶這個欄位的情況會直接
  預設成空陣列 `[]`，而且是用 `{...原本資料, ...明確覆蓋的欄位}` 的寫法、
  `linkedDocumentIds` 又剛好列在「明確覆蓋」那一組裡，蓋掉了展開運算子
  帶出來的原始值。結果就是：只要在對話庫按「儲存」（不管是改標題、標籤
  還是內容，跟文件關聯完全無關的操作），已經建立好的文件關聯就會被
  整個清空。
- **修正**：`conversations:save` 遇到既有對話、且 payload 沒有明確帶
  `linkedDocumentIds` 時，一律沿用資料庫裡已經存的版本，不再預設成空
  陣列去覆蓋。只有新建對話（原本就沒有舊資料可以沿用）才會用空陣列
  當初始值。
- 驗證方式：寫了一支重現腳本，透過 mock 過的 `electron` 模組直接呼叫
  `lib/ipc/conversations.js` 的真正 production handler（不是另外模擬
  邏輯）——新增對話 → 關聯一份文件 → 只改標題後存檔 → 確認關聯還在。
  修正前的版本重新跑一次同一支腳本，先實際重現「存檔後關聯變成空陣列」
  來確認腳本真的抓得到這個問題，再換回修正後的版本確認通過。另外重新
  跑過 `npm run lint`（0 錯誤）、`npm test`（17 個測試全過）、
  `npm run format:check`。

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
