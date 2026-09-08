# 總檢核表

搭配 [`BUILD_PLAN.md`](./BUILD_PLAN.md) 使用。每貼完一個階段、模型回報完
它自己的檢核表，你對照這份總表把該階段的項目勾起來——這份文件是橫跨全部
8 階段的**單一追蹤來源**，不用每次都回頭翻 `BUILD_PLAN.md` 找檔案清單。

用法建議：把這份文件複製一份到你自己的筆記軟體（或直接在這份 .md 檔案上
編輯），一邊跑階段一邊勾。看到某個階段结束後這裡還有 `[ ]` 沒勾起來，
先處理完再貼下一階段的提示詞，不要往下跳。

---

## 階段 1：專案骨架

- [ ] `package.json`
- [ ] `main.js`（僅視窗建立）
- [ ] `preload.js`（空殼）
- [ ] `renderer/index.html`
- [ ] `renderer/renderer.css`
- [ ] `renderer/renderer.js`（僅側邊欄 UI，不用能動）

## 階段 2：帳號管理

- [ ] `main.js`（新增：session 隔離、WebContentsView、懶載入、
      新增/切換/刪除帳號、帳號清單持久化）
- [ ] `preload.js`（新增：帳號相關 API）
- [ ] `renderer/renderer.js`（新增：帳號清單渲染、切換、刪除）
- [ ] `renderer/account.html`（新視窗）
- [ ] `renderer/account.js`（新視窗邏輯）

## 階段 3：對話匯出

- [ ] `extractors/domCapture.js`
- [ ] `extractors/default-selectors.json`
- [ ] `main.js`（新增：讀寫 selectors.json、匯出對話邏輯）
- [ ] `preload.js`（新增：匯出相關 API）
- [ ] `renderer/renderer.js`（新增：匯出按鈕邏輯）

## 階段 4：知識庫

- [ ] `renderer/knowledge.html`（新視窗）
- [ ] `renderer/knowledge.js`（新視窗邏輯：CRUD、標籤篩選、匯入匯出）
- [ ] `renderer/knowledge.css`
- [ ] `main.js`（新增：知識庫 CRUD + 匯入匯出邏輯）
- [ ] `preload.js`（新增：知識庫相關 API）

## 階段 5：設定視窗

- [ ] `renderer/settings.html`（新視窗，六個區塊）
- [ ] `renderer/settings.js`
- [ ] `renderer/settings.css`
- [ ] `main.js`（新增：設定檔位置、擴充功能、匯出路徑+自動存檔、
      備份還原、選擇器設定讀寫、DevTools 開關）
- [ ] `preload.js`（新增：設定相關 API）

## 階段 6：多國語系

- [ ] `renderer/i18n.js`
- [ ] `renderer/locales/zh-TW.json`
- [ ] `renderer/locales/en.json`
- [ ] `renderer/index.html`（補 `data-i18n` 屬性）
- [ ] `renderer/account.html`（補 `data-i18n` 屬性）
- [ ] `renderer/knowledge.html`（補 `data-i18n` 屬性）
- [ ] `renderer/settings.html`（補 `data-i18n` 屬性 + 語言下拉選單）
- [ ] `renderer/renderer.js`（alert/confirm 文字改用 `i18n.t()`）
- [ ] `renderer/account.js`（同上）
- [ ] `renderer/knowledge.js`（同上）
- [ ] `renderer/settings.js`（同上）
- [ ] `main.js`（新增：語言偏好持久化、`language:changed` 廣播）
- [ ] `preload.js`（新增：語言相關 API）

## 階段 7：滑鼠選取 Selector 工具

- [ ] `extractors/selectorPicker.js`
- [ ] `main.js`（新增：注入選取器腳本、縮小/恢復設定視窗；**順便檢查**
      所有子視窗是不是都是 `modal: false`）
- [ ] `preload.js`（新增：選取器相關 API）
- [ ] `renderer/settings.html`（新增：兩個選取按鈕 + 範例顯示區）
- [ ] `renderer/settings.js`（新增：選取流程、比對邏輯）

## 階段 8：資料安全 / 工程品質 / 打包

- [ ] `lib/utils.js`
- [ ] `test/utils.test.js`
- [ ] `main.js`（改用 `writeJsonFile()` 原子寫入、改成 `require`
      `lib/utils.js`）
- [ ] `package.json`（補齊 electron-builder 設定 + test script）
- [ ] `.eslintrc.json`（可選）
- [ ] `.prettierrc.json`（可選）

---

## 最終完整檔案清單（全部階段做完後的總覽）

如果以上 8 個階段都打勾了，下面這份清單應該每一項都存在。可以請模型
（或你自己）最後跑一次「列出目前所有檔案」跟這份清單對一次，抓出任何
遺漏：

- [ ] `main.js`
- [ ] `preload.js`
- [ ] `package.json`
- [ ] `lib/utils.js`
- [ ] `test/utils.test.js`
- [ ] `extractors/domCapture.js`
- [ ] `extractors/selectorPicker.js`
- [ ] `extractors/default-selectors.json`
- [ ] `renderer/index.html`
- [ ] `renderer/renderer.js`
- [ ] `renderer/renderer.css`
- [ ] `renderer/account.html`
- [ ] `renderer/account.js`
- [ ] `renderer/knowledge.html`
- [ ] `renderer/knowledge.js`
- [ ] `renderer/knowledge.css`
- [ ] `renderer/settings.html`
- [ ] `renderer/settings.js`
- [ ] `renderer/settings.css`
- [ ] `renderer/i18n.js`
- [ ] `renderer/locales/zh-TW.json`
- [ ] `renderer/locales/en.json`

## 功能行為總檢查（不只檔案存在，還要「能動」）

檔案都在不代表功能是對的，最後建議整個 App 從頭操作一次：

- [ ] 開機時只有「上次選中的那個帳號」在載入，其他帳號不會一開機就全部
      開始跑（打開工作管理員/活動監視器看網路活動可以確認）
- [ ] 新增第二個帳號，兩個帳號各自登入不同的號，互不干擾
- [ ] 匯出對話能抓到實際訊息內容（用滑鼠選取工具校正過 selector 之後）
- [ ] 知識庫、設定、新增帳號都能自由跟主視窗切換，沒有任何一個把主視窗
      鎖住
- [ ] 切換語言，四個視窗文字都跟著變
- [ ] 關掉 App 整個重開，帳號登入狀態、知識庫內容、設定都還在
