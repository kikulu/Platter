/**
 * domCapture.js
 *
 * 這個檔案「本身不內建任何 CSS selector」。
 * selector 一律由呼叫端（main.js）從 selectors.json 讀出後，
 * 以參數 selectorConfig 傳入 capturePlatformConversation()。
 *
 * 這個檔案的內容會被 main.js 讀成字串，跟一小段呼叫程式碼串接後，
 * 透過 webContents.executeJavaScript() 注入到目前帳號的
 * WebContentsView 裡執行 —— 完全只讀取「目前已經渲染在畫面上的 DOM」，
 * 不呼叫任何平台的內部 / 未公開 API，效果等同使用者手動框選複製。
 *
 * 1.50.0 起：
 *   - 函式改成 async（executeJavaScript 會等 Promise）：擷取前可先自動往上捲動，讓「往上捲才載入」
 *     的較舊訊息都載入（options.loadAll，預設開），擷取完把捲動位置還原。
 *   - 排除側邊欄／導覽列／輸入表單等「頁面外殼」裡的符合節點（selector 太寬鬆時不會把 UI 文字當成訊息）。
 *   - 同時收集每則訊息裡的「檔案」（options.collectFiles，預設開）：可下載的連結（download 屬性、
 *     常見副檔名或 /files/ 之類路徑）、較大的圖片、影音來源，以及使用者在 selector 設定裡填的
 *     fileSelector 所指的元素（沒有網址的只記名稱）。只回報網址與名稱，下載由主行程負責。
 *
 * 1.51.0 起（自我修復）：
 *   - selectorConfig.fallbacks（呼叫端從 extractors/capture-fallbacks.json 帶入的備用選擇器清單，
 *     這個檔案本身仍不內建任何 selector）：設定的選擇器擷取不到、或只抓到單一角色（沒有 AI 回覆）時，
 *     依序試備用選擇器，挑「同時有使用者與 AI 訊息、且訊息最多」的結果；debug.candidatesTried 回報每組的命中數。
 *   - 「頁面外殼」排除放寬：只排除 nav／aside／dialog 與對應 ARIA role（不再排除 header／footer／form，
 *     很多平台的訊息會包在這些元素裡）；外殼若包著 main 也不算外殼；排除後一個都不剩就退回不排除。
 *   - userHint 支援 "has:<selector>"（節點裡有符合 selector 的子元素就是使用者訊息）；
 *     "屬性=值" 的寫法不再被 data-message-author-role 搶先比對。
 *   - Gemini 的 user-query 優先讀 .query-text（避免讀到隱藏的「You said」前綴）。
 */
async function capturePlatformConversation(platform, selectorConfig, options) {
  const opts = Object.assign({ loadAll: true, collectFiles: true, useFallbacks: true }, options || {});
  try {
    if (!selectorConfig || !selectorConfig.turn) {
      return {
        ok: false,
        error: 'NO_SELECTOR',
        title: document.title || platform,
        messages: [],
        capturedAt: new Date().toISOString(),
        debug: {
          selectorUsed: null,
          matchedNodeCount: 0,
          nonEmptyMessageCount: 0,
          pageUrl: location.href,
        },
      };
    }

    const fileSelector = (selectorConfig.fileSelector || '').trim();
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const candidates = [selectorConfig];
    if (opts.useFallbacks && Array.isArray(selectorConfig.fallbacks)) {
      selectorConfig.fallbacks.forEach((c) => {
        if (c && typeof c.turn === 'string' && c.turn.trim() && c.turn !== selectorConfig.turn) {
          candidates.push({ turn: c.turn, userHint: c.userHint || '' });
        }
      });
    }

    const queryOf = (cfg) => {
      try {
        return Array.from(document.querySelectorAll(cfg.turn));
      } catch (err) {
        return []; // selector 語法錯誤：當作沒有符合
      }
    };

    // 「頁面外殼」：側邊欄、導覽列、對話框。外殼若包著 main（整頁被一層包起來）就不算。
    const CHROME_SELECTOR =
      'nav, aside, dialog, [role="navigation"], [role="complementary"], [role="dialog"]';
    const inChrome = (el) => {
      if (typeof el.closest !== 'function') return false;
      const c = el.closest(CHROME_SELECTOR);
      if (!c) return false;
      if (typeof c.querySelector === 'function' && c.querySelector('main, [role="main"]')) return false;
      return true;
    };

    // ---- 1. 載入完整歷史：往上捲到頂，等新訊息載入，直到數量與捲動高度連續兩輪沒變 ----
    let scrollRounds = 0;
    let anchor = null;
    let anchorCfg = null;
    for (const cfg of candidates) {
      anchor = queryOf(cfg).find((el) => !inChrome(el)) || null;
      if (anchor) {
        anchorCfg = cfg;
        break;
      }
    }
    if (
      opts.loadAll &&
      anchor &&
      anchor.parentElement &&
      typeof getComputedStyle === 'function' &&
      typeof setTimeout === 'function'
    ) {
      let scroller = null;
      for (let p = anchor.parentElement; p && p !== document.documentElement; p = p.parentElement) {
        const oy = getComputedStyle(p).overflowY;
        if (/(auto|scroll)/.test(oy) && p.scrollHeight > p.clientHeight + 40) {
          scroller = p;
          break;
        }
      }
      if (!scroller) scroller = document.scrollingElement || document.documentElement;
      const fromBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
      const deadline = Date.now() + 20000;
      let last = '';
      let stable = 0;
      while (Date.now() < deadline && scrollRounds < 60) {
        scroller.scrollTop = 0;
        await sleep(400);
        scrollRounds += 1;
        const sig = queryOf(anchorCfg).length + ':' + scroller.scrollHeight;
        stable = sig === last ? stable + 1 : 0;
        last = sig;
        if (stable >= 2) break;
      }
      scroller.scrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight - fromBottom);
    }

    // ---- 2. 判斷訊息角色與文字 ----
    const isUserMessage = function (el, userHint) {
      if (!userHint) return false;

      // 0) "has:<selector>"：節點裡有符合的子元素就是使用者訊息（回合容器型的 DOM）
      if (userHint.startsWith('has:')) {
        try {
          return !!(el.querySelector && el.querySelector(userHint.slice(4)));
        } catch (err) {
          return false;
        }
      }

      const hasEquals = userHint.includes('=');

      // 1) 優先比對 data-message-author-role 屬性值（hint 是單純的角色字，例如 "user"）
      const roleAttr = el.getAttribute && el.getAttribute('data-message-author-role');
      if (roleAttr && !hasEquals) {
        return roleAttr.toLowerCase() === userHint.toLowerCase();
      }

      // 2) 比對其他常見屬性是否包含 userHint（例如 "data-testid=user-message" 這種寫法）
      if (hasEquals) {
        const [attrName, attrValue] = userHint.split('=').map((s) => s.trim());
        const val = el.getAttribute && el.getAttribute(attrName);
        if (val) return val.toLowerCase().includes(attrValue.toLowerCase());
      }

      // 3) 比對 tag name（例如 gemini 的 user-query / model-response）
      if (el.tagName && el.tagName.toLowerCase() === userHint.toLowerCase()) {
        return true;
      }

      // 4) 比對 class list 是否包含 userHint 這個 class 名稱
      if (el.classList && el.classList.contains(userHint)) {
        return true;
      }

      return false;
    };

    const textOf = (el) => {
      // Gemini 的 user-query 含隱藏的「You said」前綴，優先讀實際的提問文字
      if (el.tagName === 'USER-QUERY' && typeof el.querySelector === 'function') {
        const q = el.querySelector('.query-text');
        const qt = q && (q.innerText || '').trim();
        if (qt) return qt;
      }
      // innerText 在「沒有被渲染」的節點（帳號視圖被隱藏／未顯示、display:none 的祖先）會是空字串，
      // 這時改讀 textContent，避免整頁被判成 EMPTY_RESULT
      // 零寬字元（Claude 會塞空的 span）不算文字，否則「看起來空白」的節點會被當成一則訊息
      return String(el.innerText || el.textContent || '')
        .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
        .trim();
    };
    // 平台頁面上的雜訊（相對時間、免責聲明、額度用完橫幅）：不是對話內容
    const NOISE_TEXT = /^(\d+\s*(seconds?|minutes?|hours?|days?|weeks?|months?|years?)\s+ago|just now|(Claude|ChatGPT|Gemini|Grok) (is AI and )?can make mistakes\b.*|You are out of free messages\b.*)$/i;

    // 平台在訊息文字前面塞的角色標籤／思考時間（Grok 的「您」「Grok 運作了5s」、Gemini 的「你說了」）
    const ROLE_LABEL = /^(您|你|你說了|You said|You|Grok|ChatGPT|Gemini|Claude|Gemini 說了|ChatGPT said|ChatGPT 說)$/i;
    const THINK_LABEL = /^(運作了|已運作|思考了|已思考|Thought for|Worked for|Thinking)\s*[\d.]*\s*(s|秒|seconds?|分鐘|min)?$/i;
    const stripLabels = (text) => {
      const lines = text.split('\n');
      let i = 0;
      while (i < lines.length && i < 3 && (ROLE_LABEL.test(lines[i].trim()) || THINK_LABEL.test(lines[i].trim()))) i += 1;
      let out = lines.slice(i).join('\n').trim();
      const m = out.match(/^(你說了|You said)\s+(.+)$/s);
      if (m) out = m[2].trim();
      return out || text;
    };
    // 按鈕、表單、輸入框裡的節點一定不是對話訊息（Share／Upgrade／輸入框提示字等 UI 文字）
    const INTERACTIVE = 'button, [role="button"], form, textarea, [contenteditable="true"]';
    const inInteractive = (el) => typeof el.closest === 'function' && !!el.closest(INTERACTIVE);

    // 對一組選擇器做一次擷取（不含檔案收集）
    const extract = (cfg) => {
      const hint = (cfg.userHint || '').trim();
      const nodes = queryOf(cfg);
      let contentNodes = nodes.filter((el) => !inChrome(el));
      let chromeSkipped = nodes.length - contentNodes.length;
      let chromeFallback = false;
      // 排除後一個都不剩 → 外殼規則可能誤傷，退回不排除
      if (contentNodes.length === 0 && nodes.length > 0) {
        contentNodes = nodes;
        chromeSkipped = 0;
        chromeFallback = true;
      }
      // 去除「巢狀重複」：selector 是聯集（例如 claude 的 user-message +
      // font-claude-response）或外層容器也剛好符合時，querySelectorAll 會同時
      // 回傳外層與內層節點，外層的 innerText 又包含內層全部文字，結果同一段
      // 內容被重複擷取、越疊越多。這裡只保留「最內層」符合的節點（內含其他
      // 符合節點的外層容器一律略過）。
      const leafNodes = contentNodes
        .filter((el) => !inInteractive(el))
        .filter((el, _i, arr) => !arr.some((other) => other !== el && el.contains(other)));
      const items = leafNodes.map((el) => ({
        el,
        role: isUserMessage(el, hint) ? 'user' : 'assistant',
        text: stripLabels(textOf(el)),
      })).filter((x) => !NOISE_TEXT.test(x.text));
      const chars = items.reduce((n, x) => n + x.text.length, 0);
      return { cfg, nodeCount: nodes.length, chromeSkipped, chromeFallback, items, chars };
    };
    const hasBoth = (items) =>
      items.some((x) => x.role === 'user') && items.some((x) => x.role === 'assistant');
    const scoreOf = (r) => (hasBoth(r.items) ? 1000000 : 0) + r.items.length;
    // 設定的選擇器兩種角色都有時優先沿用；但備用選擇器抓到明顯更多文字（≥1.3 倍）就改用它——
    // 例如 Claude 的 .font-claude-response 只抓到「Ran 18 commands」這類步驟標題，正文在別的元素裡
    const RICHER = 1.3;

    // ---- 3. 選擇器：設定的先試；沒有同時抓到兩種角色就試備用，挑最好的 ----
    const tried = [];
    let best = null;
    let bestIndex = 0;
    for (let i = 0; i < candidates.length; i += 1) {
      const r = extract(candidates[i]);
      tried.push({ turn: candidates[i].turn, nodes: r.nodeCount, messages: r.items.length, chars: r.chars, both: hasBoth(r.items) });
      let better;
      if (!best) better = true;
      else if (hasBoth(best.items) && hasBoth(r.items)) better = r.chars > best.chars * RICHER;
      else better = scoreOf(r) > scoreOf(best);
      if (better) {
        best = r;
        bestIndex = i;
      }
    }

    // ---- 4. 檔案收集 ----
    const FILE_EXT =
      /\.(pdf|docx?|xlsx?|pptx?|csv|tsv|txt|md|json|xml|zip|rar|7z|tar|gz|png|jpe?g|gif|webp|svg|bmp|mp3|wav|m4a|mp4|mov|webm|py|js|ts|html?|css|ipynb|epub)$/i;
    const FILE_PATH = /\/(files?|attachments?|downloads?|uploads?|backend-api\/files)(\/|$)/i;
    const ICON_HINT = /avatar|emoji|icon|logo|favicon|sprite|thumbnail-small/i;
    const baseName = (u) => {
      try {
        const last = decodeURIComponent(new URL(u, location.href).pathname.split('/').pop() || '');
        return last;
      } catch (err) {
        return '';
      }
    };
    const firstLine = (s) =>
      String(s || '')
        .split('\n')
        .map((x) => x.trim())
        .find(Boolean) || '';
    // 1.52.0：沒有直接網址、要「點下去才會下載」的檔案卡片／連結（ChatGPT 的 sandbox: 連結、Claude 的成品卡片）。
    // 偵測到的元素會標上 data-platter-file="<序號>"，主行程之後用這個序號回頁面點擊並接住下載。
    let triggerSeq = 0;
    const TRIGGER_EXT =
      'pdf|md|markdown|docx?|xlsx?|pptx?|csv|tsv|txt|zip|json|xml|html?|py|js|ts|png|jpe?g|gif|webp|svg|mp3|wav|mp4|epub|ipynb';
    const TRIGGER_NAME = new RegExp('([^\\s/\\\\:*?"<>|]{1,80}\\.(?:' + TRIGGER_EXT + '))(?![\\w])', 'i');
    const TRIGGER_LABEL = new RegExp('(?:^|[·•\\s])(' + TRIGGER_EXT + ')$', 'i');
    const GENERIC_TYPE = /^(document|code|spreadsheet|presentation|archive|image|text|file|artifact)$/i;
    const collectFiles = (root, cardsOnly) => {
      const out = [];
      const seen = new Set();
      const add = (url, name, kind, trigger) => {
        const key = url || 'name:' + name;
        if (!name && !url) return;
        if (seen.has(key)) return;
        seen.add(key);
        const item = { url: url || null, name: (name || baseName(url) || '').slice(0, 200), kind };
        if (trigger) item.trigger = trigger;
        out.push(item);
      };
      const okScheme = (u) => /^(https?|blob|data):/i.test(u || '');
      if (!cardsOnly) root.querySelectorAll('a[href]').forEach((a) => {
        const href = a.href;
        if (!okScheme(href)) return;
        let path = '';
        try {
          path = new URL(href).pathname;
        } catch (err) {
          path = '';
        }
        const looksLikeFile =
          a.hasAttribute('download') || FILE_EXT.test(path) || FILE_PATH.test(path) || /^blob:/i.test(href);
        if (!looksLikeFile) return;
        add(href, a.getAttribute('download') || firstLine(a.innerText) || baseName(href), 'link');
      });
      if (!cardsOnly) root.querySelectorAll('img').forEach((img) => {
        const src = img.currentSrc || img.src;
        if (!okScheme(src)) return;
        const w = img.naturalWidth || img.width || 0;
        const h = img.naturalHeight || img.height || 0;
        if (w < 80 || h < 80) return;
        if (ICON_HINT.test((img.className || '') + ' ' + (img.alt || '') + ' ' + src)) return;
        add(src, img.alt || baseName(src) || 'image', 'image');
      });
      if (!cardsOnly) root.querySelectorAll('video[src], audio[src], video source[src], audio source[src]').forEach((m) => {
        const src = m.src;
        if (okScheme(src)) add(src, baseName(src) || 'media', 'media');
      });
      if (!cardsOnly && typeof root.querySelectorAll === 'function') {
        let clickCount = 0;
        root.querySelectorAll('a[href^="sandbox:"], a[href], button, [role="button"]').forEach((el) => {
          if (clickCount >= 20) return;
          if (typeof el.hasAttribute !== 'function' || el.hasAttribute('data-platter-file')) return;
          if (typeof el.closest === 'function' && el.closest('[data-platter-file]')) return;
          if (typeof el.querySelector === 'function' && el.querySelector('[data-platter-file]')) return;
          if (inChrome(el)) return;
          const href = (el.getAttribute && el.getAttribute('href')) || '';
          const isSandbox = /^sandbox:/i.test(href);
          // 有一般網址的連結已由上面的連結邏輯處理
          if (href && !isSandbox) return;
          const text = String(el.innerText || el.textContent || '').trim();
          if (!isSandbox && text.length > 200) return;
          const aria = (el.getAttribute && el.getAttribute('aria-label')) || '';
          let name = '';
          if (isSandbox) {
            try {
              name = decodeURIComponent(href.split('/').pop() || '');
            } catch (err) {
              name = href.split('/').pop() || '';
            }
            if (!name) name = firstLine(text);
          } else {
            const m = TRIGGER_NAME.exec(text) || TRIGGER_NAME.exec(aria);
            if (m) {
              name = m[1];
            } else {
              const lines = text.split('\n').map((x) => x.trim()).filter(Boolean);
              const joined = lines.join(' ');
              const lm = lines.length >= 1 && lines.length <= 3 ? TRIGGER_LABEL.exec(joined) : null;
              if (lm) {
                const rawTitle = lines.length > 1 ? lines[0] : joined.slice(0, lm.index);
                const title = !GENERIC_TYPE.test(rawTitle.trim()) ? rawTitle.replace(/[·•\s]+$/, '').trim() : '';
                name = (title || 'file') + '.' + lm[1].toLowerCase();
              }
            }
          }
          if (!name) return;
          triggerSeq += 1;
          clickCount += 1;
          el.setAttribute('data-platter-file', String(triggerSeq));
          add(null, name, 'click', String(triggerSeq));
        });
      }
      if (fileSelector) {
        root.querySelectorAll(fileSelector).forEach((card) => {
          if (inChrome(card)) return;
          const a = card.matches && card.matches('a[href]') ? card : card.querySelector('a[href]');
          const img = card.querySelector && card.querySelector('img');
          const url = a && okScheme(a.href) ? a.href : img && okScheme(img.src) ? img.src : null;
          const name = (a && (a.getAttribute('download') || firstLine(a.innerText))) || firstLine(card.innerText) || card.getAttribute('aria-label') || '';
          add(url, name, 'card');
        });
      }
      return out;
    };

    // 清掉上一次擷取留下的點擊標記（同一頁連續匯出時，序號要重新編）
    if (opts.collectFiles && typeof document.querySelectorAll === 'function') {
      Array.from(document.querySelectorAll('[data-platter-file]') || []).forEach((e) => {
        if (e && typeof e.removeAttribute === 'function') e.removeAttribute('data-platter-file');
      });
    }
    const rawMessages = best.items
      .map((x) => {
        const attachments = opts.collectFiles ? collectFiles(x.el) : [];
        if (!x.text && attachments.length === 0) return null;
        const m = { role: x.role, text: x.text };
        if (attachments.length) m.attachments = attachments;
        return m;
      })
      .filter(Boolean);

    // 去除「相鄰完全相同」的訊息（同一則訊息被多個節點包住時的保險）
    // 相鄰同角色、其中一則只是另一則加上短前綴（例如「你說了 …」）也視為同一則，留乾淨的那則
    const messages = [];
    rawMessages.forEach((m) => {
      const prev = messages[messages.length - 1];
      if (prev && prev.role === m.role && m.text && prev.text) {
        if (prev.text === m.text) return;
        if (prev.text.endsWith(m.text) && prev.text.length - m.text.length <= 12) {
          messages[messages.length - 1] = m;
          return;
        }
        if (m.text.endsWith(prev.text) && m.text.length - prev.text.length <= 12) return;
      }
      messages.push(m);
    });

    // 不在任何訊息節點裡的檔案卡片（例如側邊的成品／附件面板）：只有設了 fileSelector 才收集
    let pageFiles = [];
    if (opts.collectFiles && fileSelector) {
      const inMessages = new Set(messages.flatMap((m) => (m.attachments || []).map((a) => a.url || 'name:' + a.name)));
      const holder = { querySelectorAll: (s) => document.querySelectorAll(s) };
      pageFiles = collectFiles(holder, true).filter((a) => !inMessages.has(a.url || 'name:' + a.name));
    }

    return {
      ok: messages.length > 0,
      error: messages.length > 0 ? null : 'EMPTY_RESULT',
      title: document.title || platform,
      messages,
      pageFiles,
      capturedAt: new Date().toISOString(),
      debug: {
        selectorUsed: best.cfg.turn,
        matchedNodeCount: best.nodeCount,
        nonEmptyMessageCount: messages.length,
        chromeSkipped: best.chromeSkipped,
        chromeFallback: best.chromeFallback,
        scrollRounds,
        candidateIndex: bestIndex,
        // 頁面探針：全部擷取不到時用來判斷是「選擇器不對」還是「頁面根本沒內容／不在對話頁」
        pageProbe: {
          title: document.title || '',
          bodyTextLength: document.body ? String(document.body.innerText || '').length : -1,
          mains: document.querySelectorAll('main').length,
          articles: document.querySelectorAll('article').length,
          roleNodes: document.querySelectorAll('[data-message-author-role]').length,
          iframes: document.querySelectorAll('iframe').length,
        },
        candidatesTried: tried,
        attachmentCount:
          messages.reduce((n, m) => n + (m.attachments ? m.attachments.length : 0), 0) +
          pageFiles.length,
        pageUrl: location.href,
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: 'EXCEPTION: ' + (err && err.message ? err.message : String(err)),
      title: document.title || platform,
      messages: [],
      capturedAt: new Date().toISOString(),
    };
  }
}
