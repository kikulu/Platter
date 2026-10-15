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

/**
 * 把套餐（知識庫 groups）的步驟依 `stage`（階段名稱）切成連續的階段區段。
 *
 * 套餐的 steps 是一維陣列、依序執行；`stage` 是每個步驟上的選填字串，
 * **相鄰且 stage 相同**的步驟屬於同一階段（所以順序永遠只由 steps 陣列本身
 * 決定，階段只是「哪幾步歸在同一組」的標示，不會另外影響順序）。沒有填
 * stage 的步驟（舊資料、或使用者不需要分階段的套餐）stage 一律視為空字串，
 * 整份套餐會得到單一個 stage 為 '' 的區段——呼叫端可以用「只有一個 stage 為
 * '' 的區段」判斷這是一份沒有分階段的套餐。
 *
 * @param {Array<{stage?: string}>} steps
 * @returns {Array<{stage: string, steps: Array}>}
 */
function groupStepsByStage(steps) {
  const runs = [];
  (Array.isArray(steps) ? steps : []).forEach((step) => {
    const stage = typeof step.stage === 'string' ? step.stage : '';
    const last = runs[runs.length - 1];
    if (last && last.stage === stage) last.steps.push(step);
    else runs.push({ stage, steps: [step] });
  });
  return runs;
}

/**
 * 把「內建分階段套餐範本」展開成可以直接存進使用者知識庫的套餐物件。
 *
 * 範本（extractors/default-knowledge-base.json 的 `groups`）是給人維護的
 * 寫法：`stages: [{ title, itemDefaultIds: [...] }]`，用內建提示詞的
 * `defaultId` 引用提示詞，不用綁死使用者資料裡每次隨機產生的 item id。
 * 這裡依 `itemIdByDefaultId`（defaultId → 使用者知識庫實際的 item id）
 * 轉成執行時的扁平 `steps`，每一步帶上所屬階段名稱 `stage`。
 *
 * 找不到對應項目的 defaultId（例如使用者已經把那組內建提示詞刪掉）直接略過
 * 該步驟；整份套餐一個步驟都對不上時回傳 null，呼叫端就不要種這份套餐。
 *
 * @param {object} defaultGroup 內建套餐範本
 * @param {Map<string,string>} itemIdByDefaultId
 * @param {string} now ISO 時間字串
 * @returns {object|null}
 */
function buildGroupFromDefault(defaultGroup, itemIdByDefaultId, now) {
  const steps = [];
  (Array.isArray(defaultGroup.stages) ? defaultGroup.stages : []).forEach((stage) => {
    const label = typeof stage.title === 'string' ? stage.title.trim() : '';
    (Array.isArray(stage.itemDefaultIds) ? stage.itemDefaultIds : []).forEach((defId) => {
      const itemId = itemIdByDefaultId.get(defId);
      if (itemId) steps.push({ id: genId('step'), itemId, checked: false, stage: label });
    });
  });
  if (steps.length === 0) return null;
  return {
    id: genId('grp'),
    defaultId: defaultGroup.defaultId || null,
    title: defaultGroup.title || '',
    description: defaultGroup.description || '',
    tags: Array.isArray(defaultGroup.tags) ? defaultGroup.tags : [],
    steps,
    createdAt: now,
    updatedAt: now,
  };
}

const TRAY_PROJECT_MODES = ['assigned', 'current'];
const TRAY_DEFAULT_HOTKEY = 'CommandOrControl+Shift+P';
const TRAY_RECENT_MAX = 20;

/**
 * 浮動托盤設定（存在 appState.ui.tray）的正規化：舊資料沒有這個欄位、欄位型別不對、
 * 數值超出範圍時一律退回預設值，不會壞。
 *   projectMode  'assigned'（預設，只顯示已指派帳號的未完成任務）| 'current'（每個進行中專案的目前步驟）
 *   hotkeyEnabled / hotkey  全域快捷鍵（預設關閉，避免一升級就搶走使用者別的快捷鍵）
 *   recentLimit  「最近使用」保留筆數（0～20，0 = 關閉，預設 5）
 *   recent       最近使用的知識庫項目 id（新的在前、不重複）
 */
function normalizeTrayPrefs(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const limitNum = Number(r.recentLimit);
  const recentLimit = Number.isFinite(limitNum)
    ? Math.min(TRAY_RECENT_MAX, Math.max(0, Math.floor(limitNum)))
    : 5;
  const recent = [];
  (Array.isArray(r.recent) ? r.recent : []).forEach((id) => {
    if (typeof id === 'string' && id && !recent.includes(id)) recent.push(id);
  });
  return {
    projectMode: TRAY_PROJECT_MODES.includes(r.projectMode) ? r.projectMode : 'assigned',
    hotkeyEnabled: r.hotkeyEnabled === true,
    hotkey:
      typeof r.hotkey === 'string' && r.hotkey.trim()
        ? r.hotkey.trim()
        : TRAY_DEFAULT_HOTKEY,
    recentLimit,
    recent: recent.slice(0, recentLimit),
  };
}

/**
 * 「最近使用」：把 id 放到最前面、去重、只留 limit 筆（limit 為 0 代表關閉，回傳空陣列）。
 */
function pushRecent(recent, id, limit) {
  const max = Math.max(0, Math.min(TRAY_RECENT_MAX, Math.floor(Number(limit)) || 0));
  if (max === 0 || typeof id !== 'string' || !id) return [];
  const list = (Array.isArray(recent) ? recent : []).filter((x) => x !== id);
  return [id, ...list].slice(0, max);
}

/** 把最近使用的 id 對回知識庫項目；已被刪除的項目自動略過（不改存檔內容），最多 limit 筆。 */
function resolveRecentItems(recentIds, items, limit) {
  const byId = new Map((Array.isArray(items) ? items : []).map((it) => [it.id, it]));
  const out = [];
  (Array.isArray(recentIds) ? recentIds : []).forEach((id) => {
    const it = byId.get(id);
    if (it && out.length < limit) out.push(it);
  });
  return out;
}

/**
 * 對話內容正規化：統一換行、把連續空白（含換行）壓成單一空格、去頭尾空白。
 * 用來算雜湊與預覽摘要，讓「只差在空白或換行」的內容視為相同。
 */
function normalizeConversationText(text) {
  return String(text == null ? '' : text)
    .replace(/\r\n/g, '\n')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 對話內容的 sha256（先正規化空白）。空內容回傳空字串，呼叫端不要拿來比對。 */
function hashConversationContent(text) {
  const normalized = normalizeConversationText(text);
  if (!normalized) return '';
  return require('crypto').createHash('sha256').update(normalized, 'utf8').digest('hex');
}

/**
 * 擷取預覽：訊息則數、使用者／AI 各幾則、前幾則的前 N 字，以及
 * 「文字與同角色其他訊息完全相同」的訊息則數（內容異常重複的徵兆）。
 */
function buildConversationPreview(messages, options) {
  const maxSnippets = (options && options.maxSnippets) || 5;
  const snippetLength = (options && options.snippetLength) || 80;
  const list = Array.isArray(messages) ? messages : [];
  let userCount = 0;
  const seen = new Map();
  let repeatedCount = 0;
  const snippets = [];
  list.forEach((m) => {
    const role = m && m.role === 'user' ? 'user' : 'assistant';
    if (role === 'user') userCount += 1;
    const text = normalizeConversationText(m && m.text);
    const key = `${role}:${text}`;
    if (text) {
      if (seen.has(key)) repeatedCount += 1;
      seen.set(key, true);
    }
    if (snippets.length < maxSnippets) {
      snippets.push({
        role,
        text: text.length > snippetLength ? `${text.slice(0, snippetLength)}…` : text,
      });
    }
  });
  return {
    total: list.length,
    userCount,
    assistantCount: list.length - userCount,
    repeatedCount,
    snippets,
  };
}

/**
 * 在對話庫裡找內容雜湊相同的另一則對話（排除 excludeId 自己）。
 * 舊資料沒有 contentHash 欄位時，由 content 現算，所以舊對話也能被偵測到。
 */
function findDuplicateConversation(conversations, hash, excludeId) {
  if (!hash) return null;
  const list = Array.isArray(conversations) ? conversations : [];
  return (
    list.find(
      (c) =>
        c &&
        c.id !== excludeId &&
        (c.contentHash || hashConversationContent(c.content)) === hash
    ) || null
  );
}

/**
 * 原子寫入：先寫到同資料夾的暫存檔並 fsync，再 rename 蓋過原檔，寫到一半
 * 當機／斷電時原檔不會被截斷。`backup: true` 時，覆蓋前先把舊檔複製成
 * `<檔名>.bak`，讓 readJsonFileWithBackup() 在主檔損毀時有東西可救。
 * 寫入失敗（含 content 型別錯誤）一律往外丟例外，且會清掉暫存檔、不動原檔。
 */
function writeFileAtomicSync(filePath, content, options) {
  const backup = !!(options && options.backup);
  const fs = require('fs');
  const path = require('path');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmpPath, content, 'utf-8');
    const fd = fs.openSync(tmpPath, 'r+');
    try {
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    if (backup && fs.existsSync(filePath)) {
      try {
        fs.copyFileSync(filePath, `${filePath}.bak`);
      } catch (err) {
        // 備份失敗不應該擋住正常寫入
      }
    }
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    try {
      fs.rmSync(tmpPath, { force: true });
    } catch (e) {
      // 清不掉暫存檔就算了
    }
    throw err;
  }
}

/**
 * 讀 JSON 檔：主檔不存在回傳 fallback；主檔存在但解析失敗時改讀 `.bak`
 * （由 writeFileAtomicSync 的 backup 選項產生）；兩者都不行回傳 fallback。
 * 回傳 { data, source }，source 是 'main' | 'backup' | 'fallback'，
 * 呼叫端可以據此記錄「主檔損毀、已從備份還原讀取」。
 */
function readJsonFileWithBackup(filePath, fallback) {
  const fs = require('fs');
  if (!fs.existsSync(filePath)) return { data: fallback, source: 'fallback' };
  try {
    return { data: JSON.parse(fs.readFileSync(filePath, 'utf-8')), source: 'main' };
  } catch (err) {
    const bakPath = `${filePath}.bak`;
    try {
      if (fs.existsSync(bakPath)) {
        return { data: JSON.parse(fs.readFileSync(bakPath, 'utf-8')), source: 'backup' };
      }
    } catch (e) {
      // 備份也壞了，走 fallback
    }
    return { data: fallback, source: 'fallback', error: err };
  }
}

module.exports = {
  pushRecent,
  resolveRecentItems,
  TRAY_PROJECT_MODES,
  normalizeTrayPrefs,
  normalizeConversationText,
  hashConversationContent,
  buildConversationPreview,
  findDuplicateConversation,
  writeFileAtomicSync,
  readJsonFileWithBackup,
  genId,
  ensureUniqueFilePath,
  toMarkdown,
  escapeCssIdentifier,
  deriveSelectorFromSamples,
  markdownToHtml,
  groupStepsByStage,
  buildGroupFromDefault,
  sanitizeDocxHtml,
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
  // 去掉控制字元再處理：瀏覽器解析網址時會忽略 tab／換行，`java\tscript:` 會被當成 javascript:
  const trimmed = String(url || '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
    .trim();
  if (/^(https?:|mailto:)/i.test(trimmed)) return trimmed;
  // 協定相對網址（//host）與反斜線開頭的網址會被瀏覽器當成「另一個網站」
  if (/^[\\/]{2}/.test(trimmed)) return '#';
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

/**
 * 淨化 mammoth（`.docx` → HTML）轉換出來的 HTML，插進渲染層的 `innerHTML`
 * 之前的最後一道防線（1.42.0 起改成白名單，見 docs/SECURITY_AUDIT_REPORT.md M-2）。
 *
 * 做法：用小型 tokenizer 逐段掃描輸入，只輸出「我們自己重組」的標籤：
 *   - 標籤名稱必須在 DOCX_ALLOWED_TAGS 內，否則標籤本身被拿掉（文字內容保留）；
 *     DOCX_DROP_WITH_CONTENT 內的標籤（script/style/iframe/svg/template…）連內容一起拿掉。
 *   - 屬性只輸出白名單：a[href]、img[src, alt]、td/th[colspan, rowspan]。其他屬性
 *     （on*、style、class、id、formaction…）一律不輸出；有沒有引號、用什麼引號都不影響。
 *   - 屬性值先解碼 HTML 實體、去掉空白與控制字元，再判斷網址協定（擋 `&#106;avascript:`、
 *     `java\tscript:`）；輸出時重新跳脫。href 只接受 http(s)／mailto／`#` 錨點；
 *     img src 只接受 data:image/(png|jpeg|gif|webp|bmp);base64（不含 svg）。
 *   - 註解、`<!…>`、`<?…>` 整段拿掉；不成形的 `<` 與文字裡的 `>` 都跳脫成實體。
 * 不重建標籤的巢狀平衡（未閉合的標籤只可能影響預覽區塊的排版，不影響安全）。
 */
const DOCX_ALLOWED_TAGS = new Set([
  'p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li',
  'strong', 'b', 'em', 'i', 'u', 's', 'sub', 'sup', 'a', 'img',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption', 'colgroup', 'col',
  'blockquote', 'pre', 'code', 'span', 'div',
]);
const DOCX_VOID_TAGS = new Set(['br', 'hr', 'img', 'col']);
const DOCX_DROP_WITH_CONTENT = new Set([
  'script', 'style', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'svg', 'math',
  'template', 'textarea', 'title', 'noscript', 'noembed', 'noframes', 'xmp', 'plaintext',
  'select', 'head', 'audio', 'video', 'canvas',
]);
const DOCX_ALLOWED_ATTRS = {
  a: ['href'],
  img: ['src', 'alt'],
  td: ['colspan', 'rowspan'],
  th: ['colspan', 'rowspan'],
};
const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', colon: ':', tab: '\t',
  newline: '\n', lpar: '(', rpar: ')', sol: '/', bsol: '\\',
};

function decodeAttrEntities(value) {
  return String(value).replace(/&(?:#x([0-9a-f]+)|#([0-9]+)|([a-z][a-z0-9]*));?/gi, (m, hex, dec, name) => {
    if (hex || dec) {
      const code = hex ? parseInt(hex, 16) : parseInt(dec, 10);
      if (!Number.isFinite(code) || code > 0x10ffff) return '';
      try {
        return String.fromCodePoint(code);
      } catch (err) {
        return '';
      }
    }
    const key = name.toLowerCase();
    return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, key) ? NAMED_ENTITIES[key] : m;
  });
}

// eslint-disable-next-line no-control-regex
const URL_NOISE = /[\u0000-\u0020\u007f-\u009f\u00ad\u200b-\u200f\u2028\u2029\u2060\ufeff]/g;

function cleanDocxAttr(tag, name, rawValue) {
  const value = decodeAttrEntities(rawValue);
  const compact = value.replace(URL_NOISE, '');
  if (name === 'href') {
    if (/^(https?:|mailto:)/i.test(compact)) return value.trim();
    if (/^#[^\s]*$/.test(compact)) return compact;
    return '#';
  }
  if (name === 'src') {
    return /^data:image\/(png|jpe?g|gif|webp|bmp);base64,[a-z0-9+/=\s]*$/i.test(value.trim())
      ? value.trim()
      : null;
  }
  if (name === 'colspan' || name === 'rowspan') {
    return /^[0-9]{1,3}$/.test(compact) ? compact : null;
  }
  if (name === 'alt') return value.slice(0, 500);
  return null;
}

/** 從 html[start] 的 '<' 開始解析一個標籤。回傳 { end, closing, name, attrs } 或 null（不成形）。 */
function parseTagAt(html, start) {
  const head = /^<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)/.exec(html.slice(start, start + 64));
  if (!head) return null;
  let i = start + head[0].length;
  const attrs = [];
  const n = html.length;
  while (i < n) {
    const c = html[i];
    if (c === '>') return { end: i + 1, closing: head[1] === '/', name: head[2].toLowerCase(), attrs };
    if (/[\s/]/.test(c)) {
      i += 1;
      continue;
    }
    let j = i;
    while (j < n && !/[\s/>=]/.test(html[j])) j += 1;
    if (j === i) {
      i += 1; // 落單的 '='
      continue;
    }
    const attrName = html.slice(i, j).toLowerCase();
    i = j;
    while (i < n && /\s/.test(html[i])) i += 1;
    let value = '';
    if (html[i] === '=') {
      i += 1;
      while (i < n && /\s/.test(html[i])) i += 1;
      if (html[i] === '"' || html[i] === "'") {
        const close = html.indexOf(html[i], i + 1);
        if (close === -1) return null; // 引號沒閉合：當成不成形
        value = html.slice(i + 1, close);
        i = close + 1;
      } else {
        j = i;
        while (j < n && !/[\s>]/.test(html[j])) j += 1;
        value = html.slice(i, j);
        i = j;
      }
    }
    attrs.push([attrName, value]);
  }
  return null;
}

function sanitizeDocxHtml(html) {
  const input = String(html || '');
  const n = input.length;
  let out = '';
  let i = 0;
  while (i < n) {
    const lt = input.indexOf('<', i);
    if (lt === -1) {
      out += input.slice(i).replace(/>/g, '&gt;');
      break;
    }
    out += input.slice(i, lt).replace(/>/g, '&gt;');
    if (input.startsWith('<!--', lt)) {
      const close = input.indexOf('-->', lt + 4);
      i = close === -1 ? n : close + 3;
      continue;
    }
    if (input[lt + 1] === '!' || input[lt + 1] === '?') {
      const close = input.indexOf('>', lt + 2);
      i = close === -1 ? n : close + 1;
      continue;
    }
    const tag = parseTagAt(input, lt);
    if (!tag) {
      out += '&lt;';
      i = lt + 1;
      continue;
    }
    i = tag.end;
    if (DOCX_DROP_WITH_CONTENT.has(tag.name)) {
      if (!tag.closing) {
        const re = new RegExp('</' + tag.name + '(?=[\\s/>])', 'ig');
        re.lastIndex = i;
        const m = re.exec(input);
        if (!m) {
          i = n;
        } else {
          const close = input.indexOf('>', m.index);
          i = close === -1 ? n : close + 1;
        }
      }
      continue;
    }
    if (!DOCX_ALLOWED_TAGS.has(tag.name)) continue;
    if (tag.closing) {
      if (!DOCX_VOID_TAGS.has(tag.name)) out += `</${tag.name}>`;
      continue;
    }
    const allowed = DOCX_ALLOWED_ATTRS[tag.name] || [];
    const seen = new Set();
    let attrText = '';
    tag.attrs.forEach(([name, raw]) => {
      if (!allowed.includes(name) || seen.has(name)) return;
      const cleaned = cleanDocxAttr(tag.name, name, raw);
      if (cleaned === null) return;
      seen.add(name);
      attrText += ` ${name}="${escapeHtml(cleaned)}"`;
    });
    out += `<${tag.name}${attrText}>`;
  }
  return out;
}
