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
  markdownToHtml,
};

/**
 * 把純文字做 HTML escape：markdownToHtml() 的安全性完全建立在「來源文字
 * 一律先跳脫、只有我們自己組出來的標籤才是未跳脫的」這個前提上。
 */
function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * 檢查連結/圖片的網址是否安全可以直接放進 href/src：只接受 http(s)://、
 * mailto: 開頭，或是沒有 scheme 的相對路徑／錨點（例如 `./a.md`、
 * `#section`）。像 `javascript:`、`data:` 這種 scheme 一律擋掉、換成
 * `#`，避免 Markdown 內容被用來注入可執行的連結。
 */
function safeUrl(url) {
  const trimmed = String(url || '').trim();
  if (/^(https?:|mailto:)/i.test(trimmed)) return trimmed;
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) return trimmed; // 沒有 scheme，視為相對路徑/錨點
  return '#';
}

/**
 * 處理單行/單一區塊內的行內語法：行內程式碼、圖片、連結、粗體、斜體。
 * 呼叫端傳進來的必須是「尚未跳脫」的原始文字，這裡會先整段 escapeHtml()，
 * 之後的每個規則都只在「已跳脫」的字串上做字串替換、組出我們自己的標籤，
 * 不會有機會讓來源文字裡的 `<script>` 之類的內容變成真的標籤。
 */
function renderInline(text) {
  let out = escapeHtml(text);

  // 行內程式碼要最先抽出來、暫存成佔位符，避免後面的粗體/斜體/連結規則
  // 誤吃進程式碼片段裡本來就有的 `*`、`[`、`]` 這些符號。用 Unicode
  // Private Use Area 字元（U+E000）當佔位符邊界，不用 ASCII 控制字元
  // （\x00 之類），避免踩到 eslint no-control-regex 規則，也幾乎不可能
  // 跟來源文字裡真正出現的字元衝突。
  const codeSpans = [];
  out = out.replace(/`([^`]+)`/g, (m, code) => {
    codeSpans.push(code);
    return `\uE000CODE${codeSpans.length - 1}\uE000`;
  });

  out = out.replace(
    /!\[([^\]]*)\]\(([^)\s]+)\)/g,
    (m, alt, url) => `<img alt="${alt}" src="${safeUrl(url)}">`
  );
  out = out.replace(
    /\[([^\]]+)\]\(([^)\s]+)\)/g,
    (m, label, url) => `<a href="${safeUrl(url)}">${label}</a>`
  );
  out = out.replace(
    /\*\*([^*]+)\*\*|__([^_]+)__/g,
    (m, a, b) => `<strong>${a || b}</strong>`
  );
  out = out.replace(/\*([^*]+)\*|_([^_]+)_/g, (m, a, b) => `<em>${a || b}</em>`);

  out = out.replace(
    /\uE000CODE(\d+)\uE000/g,
    (m, idx) => `<code>${codeSpans[Number(idx)]}</code>`
  );
  return out;
}

/**
 * 把 Markdown 純文字轉成 HTML 字串，供文件庫「Markdown 預覽」使用（見
 * `lib/ipc/documents.js` 的 `documents:getMarkdownPreview`，渲染層用
 * `innerHTML` 直接插入畫面，見 `renderer/documents.js`）。
 *
 * 這是刻意手刻的極簡轉換器，不是完整的 CommonMark 實作，只涵蓋日常筆記
 * 常見的語法：標題（# ~ ######）、粗體/斜體、行內程式碼、fenced code
 * block（```）、有序/無序清單（不支援巢狀）、引言（>）、連結/圖片、
 * 分隔線（---）、段落。故意不支援表格、巢狀清單、註腳、原始 HTML
 * 穿透——安全性見 `renderInline()`/`safeUrl()` 的說明：來源文字一律先
 * escape，只有我們自己產生的標籤是未跳脫的，連結網址也做了 scheme 白名單。
 */
function markdownToHtml(markdown) {
  const lines = String(markdown || '')
    .replace(/\r\n/g, '\n')
    .split('\n');
  const html = [];
  let i = 0;
  let listType = null; // 'ul' | 'ol' | null，追蹤目前是否在清單中
  let paragraphBuffer = [];

  function flushParagraph() {
    if (paragraphBuffer.length > 0) {
      html.push(`<p>${renderInline(paragraphBuffer.join(' '))}</p>`);
      paragraphBuffer = [];
    }
  }
  function closeList() {
    if (listType) {
      html.push(`</${listType}>`);
      listType = null;
    }
  }

  while (i < lines.length) {
    const line = lines[i];

    const fenceMatch = /^```(\w*)\s*$/.exec(line);
    if (fenceMatch) {
      flushParagraph();
      closeList();
      const codeLines = [];
      i += 1;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        codeLines.push(lines[i]);
        i += 1;
      }
      html.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
      i += 1; // 跳過結尾的 ```
      continue;
    }

    if (line.trim() === '') {
      flushParagraph();
      closeList();
      i += 1;
      continue;
    }

    const headingMatch = /^(#{1,6})\s+(.*)$/.exec(line);
    if (headingMatch) {
      flushParagraph();
      closeList();
      const level = headingMatch[1].length;
      html.push(`<h${level}>${renderInline(headingMatch[2])}</h${level}>`);
      i += 1;
      continue;
    }

    if (/^(---+|\*\*\*+|___+)\s*$/.test(line)) {
      flushParagraph();
      closeList();
      html.push('<hr>');
      i += 1;
      continue;
    }

    const quoteMatch = /^>\s?(.*)$/.exec(line);
    if (quoteMatch) {
      flushParagraph();
      closeList();
      const quoteLines = [quoteMatch[1]];
      i += 1;
      while (i < lines.length && /^>\s?(.*)$/.test(lines[i])) {
        quoteLines.push(/^>\s?(.*)$/.exec(lines[i])[1]);
        i += 1;
      }
      html.push(`<blockquote><p>${renderInline(quoteLines.join(' '))}</p></blockquote>`);
      continue;
    }

    const ulMatch = /^[-*+]\s+(.*)$/.exec(line);
    if (ulMatch) {
      flushParagraph();
      if (listType !== 'ul') {
        closeList();
        html.push('<ul>');
        listType = 'ul';
      }
      html.push(`<li>${renderInline(ulMatch[1])}</li>`);
      i += 1;
      continue;
    }

    const olMatch = /^\d+\.\s+(.*)$/.exec(line);
    if (olMatch) {
      flushParagraph();
      if (listType !== 'ol') {
        closeList();
        html.push('<ol>');
        listType = 'ol';
      }
      html.push(`<li>${renderInline(olMatch[1])}</li>`);
      i += 1;
      continue;
    }

    closeList();
    paragraphBuffer.push(line.trim());
    i += 1;
  }

  flushParagraph();
  closeList();
  return html.join('\n');
}
