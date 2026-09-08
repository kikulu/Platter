# 分階段建置計畫（給沒有檔案系統工具的模型用）

`PROJECT_SPEC.md` 適合拿來理解「這個專案長什麼樣子」，但直接整份丟給
Gemini / Grok / ChatGPT 要求「一次生成全部」，很容易只做出一小部分——這不是
模型能力問題，是**單次回覆的輸出長度裝不下 25+ 個檔案**，模型會不自覺地
挑一部分做、把其他部分含糊帶過或乾脆漏掉。

解法：**拆成多輪，一輪只要求做得完的量**，做完驗收再進下一輪。這份文件
把整個專案拆成 1 個開場白 + 8 個階段，每一段都是可以直接複製貼上的完整
提示詞，並且要求模型每次回覆都用固定格式回報一份檢核表，方便你不用逐行
讀程式碼、一眼就能看出有沒有漏做。用法：

1. 先貼「階段 0：開場白」，讓模型記住整個專案的規則、完整檔案清單，以及
   固定格式的檢核表回報規則。
2. 依序貼「階段 1」到「階段 8」，**每一階段模型回完，先看它自己回報的
   檢核表**，再對照 [`CHECKLIST.md`](./CHECKLIST.md) 把該階段的項目勾起來
   ——`CHECKLIST.md` 是橫跨全部 8 階段的總表，讓你隨時知道整個專案做到
   哪裡、還缺什麼，不用每次都回頭翻這份文件找檔案清單。檢核表裡有任何
   `[ ]`（未完成）或「⚠️ 需要你確認」，先處理完再貼下一階段。
3. 如果模型在某一階段中途就斷掉（常見於 Gemini/Grok 免費版的輸出長度
   限制），跟它說「繼續，從 `<檔名>` 剩下的部分接著寫」，不要整階段重來。

每個階段刻意設計成「就算單獨拿出來，模型也讀得懂在幹嘛」，不需要它記得
太多之前的對話細節——這樣就算中途換一個新的對話視窗繼續，也能接得上。

---

## 階段 0：開場白（每次開新對話都先貼這個）

```
我要請你分成多個階段幫我建立一個 Electron 桌面應用程式，這則訊息先建立
共同規則，之後我會一階段一階段給你具體任務，請不要在這則訊息就開始寫
程式碼，先確認你理解規則即可。

【專案】AI Workspace Aggregator——一個 Electron 桌面 App，同一個視窗裡
管理多個 AI 平台（Claude / ChatGPT / Gemini / Grok）帳號，每個帳號登入
狀態互相獨立，並能手動匯出對話成 Markdown/JSON。

【技術棧，嚴格遵守，不要自作主張換掉】
- Electron（主框架），版本 ^31
- 原生 JavaScript + HTML + CSS，不使用 React / Vue / Svelte 等任何前端框架
- 不使用 TypeScript，就是純 .js
- 不使用任何打包工具（不用 Vite / Webpack），檔案直接被 Electron 載入
- 打包發布用 electron-builder

【三個不可違反的原則】
1. 不呼叫任何 AI 平台的未公開/內部 API，不做自動化規避風控偵測的行為。
   對話匯出必須是「讀取當前畫面上已經渲染出來的 DOM 內容」，等同使用者
   手動框選複製，不是呼叫背景 API。
2. 不寫任何繞過網站保護機制的程式碼（例如自動下載/解壓 Chrome 商店
   .crx、剝除 X-Frame-Options 之類的安全性標頭）。
3. 不把使用者的登入憑證（cookie/localStorage/session token）打包進任何
   備份或匯出檔案。

【完整檔案清單，這是最終要做出來的樣子，我會分階段一步步引導你做】
main.js
preload.js
package.json
lib/utils.js
test/utils.test.js
extractors/domCapture.js
extractors/selectorPicker.js
extractors/default-selectors.json
renderer/index.html
renderer/renderer.js
renderer/renderer.css
renderer/account.html
renderer/account.js
renderer/knowledge.html
renderer/knowledge.js
renderer/knowledge.css
renderer/settings.html
renderer/settings.js
renderer/settings.css
renderer/i18n.js
renderer/locales/zh-TW.json
renderer/locales/en.json

【重要規則】
- 我會分 8 個階段跟你要求功能，每個階段只處理我明確列出的檔案，不要
  提前做後面階段的東西，也不要在這個階段少做我列出的東西。
- 如果某個階段的內容你覺得單次回覆放不下，請不要偷偷省略或簡化——
  明確跟我說「這階段內容太多，我先給你 A、B 兩個檔案，C 檔案下一則訊息
  接著給」，然後我會回覆「繼續」讓你接著寫完，不要自己決定跳過某個檔案。

【檢核表回報格式，每一階段結束時都要用這個固定格式回報，不要用別的
格式、不要省略】
用 Markdown 勾選清單列出「這個階段要求的每一個檔案」，每個檔案一行，
狀態只能是下面三種之一：

- [x] 檔名 — 完成，一句話說明做了什麼
- [ ] 檔名 — 未完成，原因是什麼（例如「內容太長，下一則訊息接著給」）
- [x] 檔名 — ⚠️ 需要你確認：說明你在哪裡做了跟指示不完全一樣的決定、
      或哪裡不確定

即使某個檔案這階段完全沒動到，也要列出來標成 [ ]「這階段不需要動到」，
讓我看到「一個都沒被漏掉列出來」——清單裡的檔案數量必須跟我這階段列出的
檔案數量一致，一個都不能少列。

請回覆「了解，請給我階段 1 的任務」，先不要生成任何程式碼。
```

---

## 階段 1：專案骨架

**本階段檔案**：`package.json`、`main.js`（僅視窗建立，還不用做帳號功能）、
`preload.js`（先留空殼）、`renderer/index.html`、`renderer/renderer.css`、
`renderer/renderer.js`（先只做側邊欄 UI，不用真的能新增帳號）

```
階段 1：專案骨架。

目標：跑起來會看到一個深色主題的視窗，左側有側邊欄（暫時先放靜態的假
按鈕：新增帳號、匯出當前對話、知識庫、設定，都先不用能點），右側是空白
主畫面。

- package.json：name 隨意、main 指向 main.js、scripts 至少要有
  "start": "electron ."，devDependencies 要有 electron ^31.0.0。
- main.js：建立一個 BrowserWindow（1280x800，深色背景 #1e1e1e），載入
  renderer/index.html，preload 指向 preload.js（contextIsolation: true,
  nodeIntegration: false）。
- preload.js：用 contextBridge.exposeInMainWorld 先建立一個空的
  window.workspaceAPI 物件即可，之後階段會陸續加方法進去。
- renderer/index.html + renderer.css + renderer.js：側邊欄寬度約
  220px，深色主題，CSS 變數用：
  --bg-main:#1e1e1e --bg-sidebar:#171717 --bg-hover:#2a2a2a
  --bg-active:#2f3b52 --text-primary:#e6e6e6 --text-secondary:#9a9a9a
  --accent:#4f8cff --danger:#e5484d --border:#2c2c2c
  側邊欄由上到下：標題「AI Workspace」、新增帳號按鈕、匯出當前對話按鈕、
  知識庫按鈕、帳號清單（一個空的 <ul id="account-list">）、設定按鈕
  （固定在最底部）。右側主畫面 id="content-placeholder"，裡面先放一個
  文字「請新增一個帳號以開始使用」。

完成後列出這階段建立的所有檔案。
```

**本階段驗收清單**：

- [ ] `npm install && npm start` 能順利開起一個視窗（不報錯、不是白畫面）
- [ ] 背景是深色主題（不是預設白底）
- [ ] 側邊欄看得到：標題、新增帳號/匯出當前對話/知識庫/設定 四個按鈕、
      一個空的帳號清單區域
- [ ] 右側主畫面有文字「請新增一個帳號以開始使用」
- [ ] （按鈕點了沒反應是正常的，這階段還不用能動）

---

## 階段 2：帳號管理（核心功能，最重要的一階段）

**本階段檔案**：`main.js`（新增大量帳號管理邏輯）、`preload.js`（補上帳號相關
API）、`renderer/renderer.js`（帳號清單渲染、切換、刪除）、
`renderer/account.html`、`renderer/account.js`（獨立視窗）

```
階段 2：帳號管理，這是整個 App 最核心的部分，請仔細做完整。

在階段 1 的骨架上新增：

1. Session 隔離：每個帳號用 session.fromPartition('persist:<accountId>')
   建立獨立 partition。'persist:' 前綴讓 Electron 把 partition 資料寫到
   磁碟，重開程式後用同一個 accountId 重建，能自動接回登入狀態。

2. 帳號的視覺呈現不是 <iframe> 或 <webview>，是用 Electron 的
   WebContentsView（Electron 30+ API）疊加在主視窗上面：
   mainWindow.contentView.addChildView(view)，用 view.setBounds() 定位到
   側邊欄右側的區域，用 view.setVisible(true/false) 切換顯示/隱藏。

3. 懶載入（重要的效能設計，不要省略）：拆成兩個函式——
   registerAccountMetadata(id, platform, name) 只把中繼資料放進一個
   Map，不建立 WebContentsView；ensureAccountViewCreated(accountId) 才
   是真正建立 WebContentsView、套用 loadURL() 的地方，而且只有這個帳號
   的 view 還是 null 時才建立。switchAccount() 第一步永遠要先 await
   ensureAccountViewCreated(accountId)。開機還原帳號清單時，只呼叫
   registerAccountMetadata() 註冊全部帳號，只有「上次選中的那一個」會
   透過 switchAccount() 順便懶載入建立，其餘要等使用者真的點過去才建立。

4. 四個平台網址：
   claude: https://claude.ai
   chatgpt: https://chatgpt.com
   gemini: https://gemini.google.com
   grok: https://grok.com

5. 帳號清單持久化：id/platform/name（不含任何登入資料）寫進使用者資料
   目錄下的 app-state.json，開機時讀回來。

6. 「新增帳號」是一個獨立的 BrowserWindow（不是疊在主視窗裡的彈窗！），
   renderer/account.html + account.js：平台下拉選單 + 名稱輸入框 +
   取消/確認按鈕。確認後呼叫新增帳號、切換過去、window.close() 自己關掉，
   主程序要透過 IPC 通知主視窗刷新帳號清單（例如廣播一個
   'accounts:changed' 事件）。這個子視窗用 new BrowserWindow({ parent:
   mainWindow, modal: false, ... })，注意 modal 一定要是 false，不要
   true（modal:true 會在系統層級鎖住主視窗，後面階段有功能需要使用者能
   自由切回主視窗操作，先養成習慣不要用 modal:true）。

7. 主視窗側邊欄的帳號清單：每一項顯示帳號名稱，點擊切換帳號；滑鼠移上去
   最右側浮現一個垃圾桶 icon（平常隱藏），點下去跳確認對話框（訊息裡要
   帶出帳號名稱），確認後刪除該帳號（連 view 一起移除、
   session.clearStorageData() 清乾淨 cookie）。

完成後列出這階段建立/修改的所有檔案。如果內容太多放不下，先給我
main.js 跟 preload.js，我回覆「繼續」後再給 renderer 那幾個檔案。
```

**本階段驗收清單**：

- [ ] 能新增至少 2 個不同平台的帳號（例如 Claude + ChatGPT）
- [ ] 能來回切換帳號，畫面正確顯示對應網站
- [ ] 帳號清單項目滑鼠移上去會浮現刪除 icon，點下去有確認對話框
- [ ] 確認刪除後帳號真的消失、畫面自動切到剩下的帳號
- [ ] 完整登入一個帳號後，關掉整個 App、重新 `npm start`，帳號清單還在，
      且**不需要重新登入**
- [ ] 「新增帳號」點下去開的是一個獨立視窗（有自己的標題列），不是疊在
      主視窗裡的彈窗
- [ ] 開著「新增帳號」視窗時，主視窗仍然可以被點擊/切換焦點（不是被鎖住）

---

## 階段 3：對話匯出

**本階段檔案**：`extractors/domCapture.js`、`extractors/default-selectors.json`、
`main.js`（新增匯出邏輯）、`preload.js`、`renderer/renderer.js`（匯出按鈕）

```
階段 3：對話匯出功能。

1. extractors/domCapture.js：這個檔案的內容會被主程序讀成字串、透過
   webContents.executeJavaScript() 注入到目前帳號的網頁裡執行。裡面定義
   一個函式 capturePlatformConversation(platform, selectorConfig)：
   selectorConfig 是 { turn: 'CSS selector 字串', userHint: '關鍵字' }，
   用 document.querySelectorAll(selectorConfig.turn) 抓出所有訊息容器，
   對每個容器取 innerText 當內容，比對 data-message-author-role 屬性或
   class 名稱是否包含 userHint 來判斷是不是使用者發的，回傳
   { title, messages: [{role, text}], capturedAt }。注意這個檔案本身
   不要內建任何 selector 字串，selector 一定是外部傳進來的參數。

2. extractors/default-selectors.json：四個平台各自的出廠預設 selector，
   結構：{ "claude": {"turn": "...", "userHint": "..."}, "chatgpt": {...},
   "gemini": {...}, "grok": {...} }（我先不給你確切的 selector 字串，
   你先用合理的預設值，之後我會自己去調整）。

3. main.js：讀取 default-selectors.json 當出廠預設值，實際生效的設定
   存到使用者資料目錄下的 selectors.json（第一次啟動時複製一份預設值
   過去）。「匯出當前對話」按鈕點下去：讀取目前帳號的 selectors.json
   設定、注入 domCapture.js、拿到結果後跳存檔對話框（可選 Markdown 或
   JSON 副檔名）。Markdown 格式：每則訊息一個 ### 標題（使用者訊息用
   「🧑 使用者」、AI 用「🤖 AI」）+ 內容。如果抓到 0 則訊息，錯誤訊息要
   提示使用者「可能是 selector 設定跟畫面對不上」。

完成後列出這階段建立/修改的所有檔案。
```

**本階段驗收清單**：

- [ ] 點「匯出當前對話」會跳出存檔對話框（不是完全沒反應）
- [ ] 存檔對話框裡能選 Markdown 或 JSON 副檔名
- [ ] 存出來的檔案打得開、格式大致正確（就算內容是空的、抓不到訊息也
      沒關係——這是 selector 準確度問題，階段 7 才會處理）
- [ ] 抓不到任何訊息時，錯誤訊息有提示「可能是 selector 設定跟畫面對
      不上」，不是一個看不懂的例外訊息

---

## 階段 4：知識庫

**本階段檔案**：`renderer/knowledge.html`、`renderer/knowledge.js`、
`renderer/knowledge.css`、`main.js`（知識庫的 CRUD + 匯入匯出）、`preload.js`

```
階段 4：知識庫，一個獨立視窗，用來存常用的提示詞/skill 範本。

跟階段 2 的「新增帳號」一樣是獨立 BrowserWindow（modal: false），不是
疊在主視窗裡的彈窗。

版面：滿版兩欄式。左邊是項目清單（含一個「標籤篩選」下拉選單、清單本身
、匯出全部/匯入按鈕）。右邊是編輯表單：名稱輸入框、標籤輸入框（逗號
分隔多個標籤）、內容 textarea、複製內容/刪除/儲存按鈕。

資料結構：{ id, title, content, tags: string[], createdAt, updatedAt }，
存在使用者資料目錄下的 knowledge-base.json。

- 「複製內容」用瀏覽器原生 navigator.clipboard.writeText()。
- 標籤篩選：從目前所有項目的標籤動態組出下拉選單選項，選了在前端記憶體
  裡篩選清單即可，不用重新呼叫主程序。
- 匯出：存檔對話框給 Markdown 跟 JSON 兩個副檔名選項。Markdown 格式：
  每個項目一個 ## 標題，如果有標籤顯示成「標籤：#tag1 #tag2」，接內容，
  項目之間用 --- 分隔。
- 匯入：只接受 JSON（陣列格式），每一筆重新產生新的 id（避免跟現有的
  撞號），附加到現有清單後面，不要覆蓋原本就有的項目。JSON 解析失敗或
  格式不是陣列的話，要丟出清楚的錯誤訊息，不要靜默失敗。

完成後列出這階段建立/修改的所有檔案。
```

**本階段驗收清單**：

- [ ] 「知識庫」開的是獨立視窗，主視窗仍然可以自由切換/點擊
- [ ] 能新增一筆項目（名稱+標籤+內容），存了之後清單裡看得到
- [ ] 能點清單裡的項目載入回表單編輯、存檔後內容有更新
- [ ] 能刪除項目，刪除前有確認對話框
- [ ] 標籤篩選下拉選單選了之後，清單只顯示對應標籤的項目
- [ ] 「複製內容」按下去，貼上去（例如貼進記事本）真的是該項目的內容
- [ ] 匯出成 `.md` 檔案，標題/標籤/內容格式正確
- [ ] 用剛剛匯出的 JSON 檔匯入，項目數量變成兩倍（不是覆蓋掉、也不是
      沒反應）
- [ ] 拿一個內容故意寫錯格式的 JSON 檔去匯入，會跳出清楚的錯誤訊息，
      不是靜默失敗或讓 App 卡住

---

## 階段 5：設定視窗（基本框架，不含 i18n 和滑鼠選取工具）

**本階段檔案**：`renderer/settings.html`、`renderer/settings.js`、
`renderer/settings.css`、`main.js`、`preload.js`

```
階段 5：設定視窗，一樣是獨立 BrowserWindow（modal: false）。這階段先做
基本框架，語言切換跟滑鼠選取工具留到後面階段。

由上到下依序這幾個區塊：

1. 設定檔存放位置：顯示目前設定檔資料夾路徑（唯讀），「選擇外部資料夾」
   按鈕跳資料夾選擇對話框。選好後，之後 app-state.json /
   knowledge-base.json / selectors.json 這幾個檔案都改存到那個外部資料
   夾（要有個指標檔案，例如 config-location.json，記錄目前生效的外部
   資料夾路徑，這個指標檔本身永遠留在預設的使用者資料目錄，不會被搬
   走）。切換後跳確認對話框問要不要立刻用 app.relaunch(); app.exit();
   重開 App。也要有「還原為預設位置」按鈕。

2. 擴充功能：只支援「已解壓縮」格式（資料夾裡要有 manifest.json），不要
   做任何連去 Chrome 線上應用程式商店下載的功能。清單每項一個 checkbox
   （啟用/停用）+ 移除按鈕，「新增擴充功能」跳資料夾選擇對話框，讀
   manifest.json 拿 name/version 顯示。這是全域套用：每個帳號建立
   session 時都呼叫 session.loadExtension(folderPath, { allowFileAccess:
   true }) 載入所有啟用中的擴充功能；新增/停用/移除要立即套用到「目前
   已經開著」的所有帳號 session，不用重開 App。

3. 檔案預設儲存路徑：「匯出當前對話」的預設存檔資料夾；加一個勾選框
   「使用預設路徑時不再詢問，直接存檔」，開啟後匯出時跳過存檔對話框
   直接寫檔（要處理檔名衝突：同名檔案存在的話依序試 "name (2).md"、
   "name (3).md"...）。

4. 備份與還原：「匯出備份」把帳號清單（平台/名稱，不含登入資料）、
   知識庫、上述設定打包成一個 JSON 檔；「匯入備份」讀回這份檔案，新帳號
   用原本的 id 建立（已存在的 id 略過），知識庫項目同理（已存在的 id
   略過）。JSON 解析失敗或頂層結構不符預期，要丟出清楚的錯誤訊息。

5. 選擇器設定：平台下拉選單、「訊息容器 selector」輸入框、「使用者訊息
   判斷關鍵字」輸入框、「重設此平台為預設值」/「儲存」按鈕，讀寫的就是
   階段 3 提到的 selectors.json。

6. 疑難排解：「開啟目前帳號 DevTools」按鈕，呼叫該帳號 WebContentsView
   的 webContents.openDevTools({ mode: 'detach' })。

完成後列出這階段建立/修改的所有檔案。內容應該會很多，如果放不下，請先
給我區塊 1-3，我回覆「繼續」後再給 4-6。
```

**本階段驗收清單**：

- [ ] 「設定」開的是獨立視窗，主視窗仍然可以自由切換/點擊
- [ ] 六個區塊都看得到：設定檔存放位置、擴充功能、檔案預設儲存路徑、
      備份與還原、選擇器設定、疑難排解
- [ ] 「選擇外部資料夾」能跳出資料夾選擇對話框、選完有問要不要重開 App
- [ ] 「新增擴充功能」能跳資料夾選擇對話框（沒有現成的擴充功能可以測的
      話，至少確認按鈕邏輯有實作、選錯資料夾（沒有 manifest.json）會有
      清楚的錯誤訊息）
- [ ] 「選擇資料夾」（檔案預設儲存路徑）跟自動存檔勾選框能用
- [ ] 「匯出備份」能存出一個 JSON 檔，「匯入備份」能讀回來（不用真的
      切換設定檔資料夾實測，至少單機來回匯出/匯入一次要成功）
- [ ] 選擇器設定的平台下拉選單、兩個輸入框、儲存/重設按鈕都在，存了之後
      重開設定視窗數值還在
- [ ] 「開啟目前帳號 DevTools」點下去真的會跳出一個 DevTools 視窗

---

## 階段 6：多國語系

**本階段檔案**：`renderer/i18n.js`、`renderer/locales/zh-TW.json`、
`renderer/locales/en.json`、修改 `renderer/index.html`、`account.html`、
`knowledge.html`、`settings.html`（加上 `data-i18n` 屬性）、修改對應的
`.js` 檔案（把 alert/confirm 訊息換成透過 i18n 取得翻譯字串）

```
階段 6：多國語系（繁體中文 / English）。這階段是「翻新」前面幾階段已經
做好的畫面，不是新功能，請完整檢查前面每一個 .html 檔案，把所有看得到
的靜態文字都換成 data-i18n 屬性，不要漏掉。

1. renderer/locales/zh-TW.json、en.json：扁平 key-value JSON，例如
   { "sidebar.addAccount": "新增帳號" }。字串裡可以用 {變數} 佔位（例如
   "帳號 {name} 已刪除"）。

2. renderer/i18n.js：所有視窗共用，掛在 window.i18n 上：
   - t(key, vars)：查表回傳翻譯，找不到 key 就回傳 key 本身；vars 的
     每個 key 取代字串中的 {key}。
   - applyToDOM(root)：掃描 [data-i18n]（設 textContent）、
     [data-i18n-placeholder]（設 placeholder）、[data-i18n-title]
     （設 title），套用翻譯。
   - init()：透過 window.workspaceAPI.getUIState() 拿目前語言設定、
     fetch('./locales/<lang>.json') 載入翻譯、applyToDOM()、訂閱主程序
     廣播的 'language:changed' 事件（收到時重新載入+套用）。
   - setLanguage(lang)：呼叫 window.workspaceAPI.setLanguage(lang)。

3. main.js/preload.js：語言偏好存進 app-state.json 的 language 欄位；
   IPC 讓 renderer 能設定語言，設定後對所有現存視窗
   webContents.send('language:changed', lang) 廣播。

4. 在 settings.html 加一個語言下拉選單（繁體中文/English）。

5. 檢查所有 .html 檔案的按鈕文字、標籤、提示文字，全部換成 data-i18n
   屬性；檢查所有 .js 檔案裡的 alert()/confirm() 訊息，全部換成
   window.i18n.t(key, vars)，不要留下任何寫死的中文或英文字串。

完成後列出這階段修改的所有檔案（應該會動到幾乎每一個 renderer 檔案）。
```

**本階段驗收清單**：

- [ ] 設定視窗裡有語言下拉選單（繁體中文/English）
- [ ] 切換語言後，主視窗的側邊欄文字（按鈕、標籤）跟著變
- [ ] 切換語言後，新增帳號視窗的文字跟著變
- [ ] 切換語言後，知識庫視窗的文字跟著變
- [ ] 切換語言後，設定視窗自己的文字也跟著變
- [ ] 觸發一個 alert（例如故意刪除一個帳號跳確認對話框）確認訊息文字
      也是翻譯過的，不是寫死的中文/英文
- [ ] 關掉 App 重開，語言設定還記得（不會跳回預設語言）
- [ ] 隨便找幾個畫面上的文字，搜尋原始碼確認沒有殘留寫死的字串（沒有
      `data-i18n` 屬性、也沒有透過 `window.i18n.t()` 取得的純文字）

---

## 階段 7：滑鼠選取 Selector 工具

**本階段檔案**：`extractors/selectorPicker.js`、`main.js`、`preload.js`、
`renderer/settings.html`、`renderer/settings.js`

```
階段 7：滑鼠選取 selector 工具，解決階段 3 的 selector 準確度問題。

1. extractors/selectorPicker.js：注入到目前帳號網頁的腳本，匯出一個
   函式（回傳一個 Promise），效果：滑鼠移到哪個元素上就用外框標示出來，
   使用者點一下之後，從點擊的元素開始往上最多找 8 層祖先，找出「這個
   祖先的 CSS selector 選到的元素數量 >= 2」的第一層（代表是重複出現的
   訊息容器樣式），當作候選 selector；同時記錄點擊元素的
   data-message-author-role 屬性值（如果有）跟 class list，還有前 60
   個字的文字內容當範例預覽。按 Esc 可以取消（resolve null）。

2. main.js：新增一個函式，讀取 selectorPicker.js 內容、注入到目前帳號
   的 WebContentsView 執行。呼叫這個函式之前，先把設定視窗
   settingsWindow.minimize() 縮小、把主視窗帶到最前面聚焦；拿到結果後
   （不管成功或使用者取消）用 finally 把設定視窗 restore() 帶回來、
   focus()。

3. settings.html/js：在「選擇器設定」區塊加兩個按鈕「選取範例：使用者
   訊息」「選取範例：AI 回覆」，各自呼叫上面那個選取流程。兩個範例都選
   完後，出現「套用選取結果」按鈕，按下去：
   - turn selector：如果兩個候選 selector 一樣就直接用；不一樣的話用
     逗號連接兩個（union selector）。
   - userHint：優先用使用者範例的 data-message-author-role 屬性值；
     沒有的話比對兩個範例的 class list，找出「使用者範例有、AI 範例
     沒有」的第一個 class 名稱當 userHint；都找不到就留空，並提示
     使用者自己手動填。

4. 重要：確認前面階段開的所有子視窗（account/knowledge/settings）建立
   時都是 modal: false（不是 modal: true）。這個滑鼠選取工具需要使用者
   能自由切回主視窗互動，如果之前哪個地方寫成 modal: true，這裡要一併
   修正。

完成後列出這階段建立/修改的所有檔案。
```

**本階段驗收清單**：

- [ ] 點「選取範例：使用者訊息」後，設定視窗自動縮小、主視窗自動跳到
      最前面（不用手動 alt-tab）
- [ ] 在主視窗點一則訊息後，設定視窗自動恢復、範例摘要文字顯示出來
- [ ] 按 Esc 能取消選取（不會卡住、也不會誤選）
- [ ] 兩個範例（使用者訊息 + AI 回覆）都選完後才出現「套用」按鈕
- [ ] 按下「套用」後，「訊息容器 selector」「使用者訊息判斷關鍵字」兩個
      欄位被自動填入合理的值
- [ ] 存檔後回去按「匯出當前對話」，這次真的抓得到訊息了（前提是階段 3
      建立的 domCapture.js 邏輯正確）
- [ ] 檢查 main.js、preload.js 裡開子視窗的地方，全部都是
      `modal: false`，沒有任何一個是 `modal: true`

---

## 階段 8：資料安全、效能、工程品質、打包

**本階段檔案**：`lib/utils.js`、`test/utils.test.js`、`main.js`（重構成呼叫
lib/utils.js）、`package.json`（補齊 electron-builder 設定）、
`.eslintrc.json`、`.prettierrc.json`（可選）

```
階段 8：收尾——資料安全、效能細節、工程品質、打包設定。

1. 資料安全：所有設定檔（app-state.json / knowledge-base.json /
   selectors.json / extensions.json）的寫入都要走一個共用的
   writeJsonFile(filePath, data, {backup=true}) helper：
   - 先寫到 <檔名>.tmp，成功後才用 fs.rename() 覆蓋正式檔（原子寫入，
     避免寫到一半當機造成檔案損毀）。
   - backup 開啟時，正式檔案已存在的話，寫入前先複製一份成
     <檔名>.bak（只保留最近一份）。

2. lib/utils.js：把 sanitizeTags（標籤陣列去重/去空白）、
   findAvailableFilePath（找一個不會撞名的檔名，衝突時依序試
   "(2)" "(3)"...）、renderMarkdown（對話匯出用）、
   renderKnowledgeBaseMarkdown（知識庫匯出用）這幾個不依賴 Electron API
   的純函式獨立出來，用 module.exports 匯出，main.js 用 require() 引入。

3. test/utils.test.js：用 Node 內建的 node:test + node:assert/strict
   （不要另外裝測試框架），對 lib/utils.js 的每個函式寫測試，至少涵蓋
   正常情況跟一個邊界情況。package.json 的 test script 設成
   "node --test"。

4. package.json 補齊 electron-builder 設定：build.appId、
   productName、directories.output: "dist"、files（含 main.js /
   preload.js / lib/**/* / renderer/**/* / extractors/**/*）、
   asarUnpack: ["extractors/**/*"]、各平台 target（win: nsis, mac: dmg,
   linux: AppImage），npm scripts 加 build / build:win / build:mac /
   build:linux / build:dir。

5. （可選，如果還有餘力）加 .eslintrc.json（extends:
   ["eslint:recommended", "prettier"]）、.prettierrc.json，
   package.json 加 lint / format script。

完成後列出這階段建立/修改的所有檔案，並跑一次 npm test 確認全部通過。
```

**本階段驗收清單**：

- [ ] `lib/utils.js` 存在，`main.js` 裡對應的函式改成 `require` 進來用
      （不是重複定義兩份）
- [ ] `npm test` 能執行、全部測試通過
- [ ] 隨便找一個設定檔（例如 `knowledge-base.json`）存檔後，資料夾裡
      同時出現 `.bak` 備份檔
- [ ] `npm run build:dir` 能順利產生免安裝資料夾（沒有圖示檔案的話這步
      驟預期會因為找不到 icon 而失敗，這是正常的，把
      `build.win/mac/linux.icon` 那幾行先拿掉即可跑過）
- [ ] （如果有做 ESLint/Prettier）`npm run lint` 能執行不報設定錯誤

---

## 如果某個模型在某階段還是漏東西

把它漏掉的檔案單獨拿出來，用這個格式重問一次（比整階段重來更省事）：

```
上一輪的階段 <N> 缺少 <檔名>，這是它的完整規格：<貼上該階段提示詞裡
跟這個檔案相關的段落>。請只給我這一個檔案的完整內容。
```

單一檔案的請求成功率通常遠高於整批請求，這也是為什麼要拆成階段的核心
原因。
