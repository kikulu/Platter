'use strict';

/**
 * lib/utils.js
 *
 * 存放 main.js 裡「不依賴 Electron runtime」的純邏輯函式，抽出來的目的是
 * 讓它們可以在一般 Node.js 環境下被單元測試（見 test/utils.test.js），
 * 不需要真的啟動 Electron。main.js 透過 require('./lib/utils') 使用這些
 * 函式，行為必須跟原本內嵌在 main.js 裡時完全一致。
 *
 * 這個檔案只能依賴 Node.js 內建模組（fs/path），不可以 require('electron')。
 */

const fs = require('fs');
const path = require('path');

/**
 * 產生一個帶時間戳記＋隨機字尾的識別碼，用於新增帳號等場景。
 * @param {string} [prefix='acc'] id 前綴，方便從 id 看出來源類型。
 */
function genId(prefix = 'acc') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 在指定資料夾裡找出一個不會撞名的檔案路徑。
 * `name.ext` 已存在的話，依序試 `name (2).ext`、`name (3).ext`...
 * 用於「使用預設路徑時不再詢問，直接存檔」情境下處理檔名衝突。
 */
function ensureUniqueFilePath(dir, baseName, ext) {
  let candidate = path.join(dir, `${baseName}.${ext}`);
  let counter = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${baseName} (${counter}).${ext}`);
    counter += 1;
  }
  return candidate;
}

/**
 * 把 DOM 擷取結果（{ title, messages: [{role, text}] }）轉成 Markdown。
 * 每則訊息一個 `###` 標題（🧑 使用者 / 🤖 AI）+ 內容。
 */
function toMarkdown(result) {
  const lines = [`# ${result.title || '對話紀錄'}`, ''];
  (result.messages || []).forEach((m) => {
    const heading = m.role === 'user' ? '### 🧑 使用者' : '### 🤖 AI';
    lines.push(heading, '', m.text, '');
  });
  return lines.join('\n');
}

/**
 * 用單一 class 名稱組出一個安全的 CSS class selector。
 * 原本的實作誤用了瀏覽器專屬的 `CSS.escape`，但 main.js 是在 Electron
 * 主程序（Node.js 環境）執行，並沒有 `CSS` 這個全域物件，一旦樣本元素
 * 帶有 id（會走到同一段判斷邏輯的鄰近分支）就會丟出
 * `ReferenceError: CSS is not defined`。這裡改用不依賴瀏覽器 API 的
 * 手刻 escape，只跳脫 CSS selector 裡有特殊意義的字元。
 */
function escapeCssIdentifier(value) {
  return String(value).replace(/([^a-zA-Z0-9_-])/g, '\\$1');
}

/**
 * 依「滑鼠選取範例」拿到的使用者訊息樣本／AI 回覆樣本，推導出：
 * - turn selector：兩個候選 selector 相同就直接用；不同就用逗號連接
 *   （union selector，同時匹配兩種 pattern）。
 * - userHint：優先用 `data-message-author-role`；沒有的話比對兩個範例的
 *   class list，抓出「使用者範例有、AI 範例沒有」的第一個 class 名稱；
 *   都找不到就回傳空字串。
 */
function deriveSelectorFromSamples(userSample, aiSample) {
  function buildCandidateSelector(sample) {
    if (sample.attrs && sample.attrs['data-message-author-role'] !== undefined) {
      return '[data-message-author-role]';
    }
    if (sample.id) return `#${escapeCssIdentifier(sample.id)}`;
    if (sample.className) {
      const firstClass = sample.className.split(/\s+/).filter(Boolean)[0];
      if (firstClass) return `.${firstClass}`;
    }
    return sample.tagName || '';
  }

  const userSelector = buildCandidateSelector(userSample);
  const aiSelector = buildCandidateSelector(aiSample);

  const turn =
    userSelector && aiSelector && userSelector !== aiSelector
      ? `${userSelector}, ${aiSelector}`
      : userSelector || aiSelector;

  let userHint = '';
  if (userSample.attrs && userSample.attrs['data-message-author-role'] !== undefined) {
    userHint = userSample.attrs['data-message-author-role'];
  } else {
    const userClasses = (userSample.className || '').split(/\s+/).filter(Boolean);
    const aiClasses = new Set((aiSample.className || '').split(/\s+/).filter(Boolean));
    const uniqueToUser = userClasses.find((c) => !aiClasses.has(c));
    userHint = uniqueToUser || '';
  }

  return { turn, userHint };
}

module.exports = {
  genId,
  ensureUniqueFilePath,
  toMarkdown,
  escapeCssIdentifier,
  deriveSelectorFromSamples,
};
