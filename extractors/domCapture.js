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
 */
async function capturePlatformConversation(platform, selectorConfig, options) {
  const opts = Object.assign({ loadAll: true, collectFiles: true }, options || {});
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

    const query = () => Array.from(document.querySelectorAll(selectorConfig.turn));
    // 排除「頁面外殼」：側邊欄、導覽列、頁首頁尾、輸入表單、對話框裡的符合節點
    const CHROME_SELECTOR =
      'nav, aside, header, footer, form, dialog, [role="navigation"], [role="complementary"], [role="dialog"], [role="banner"]';
    const inChrome = (el) => typeof el.closest === 'function' && !!el.closest(CHROME_SELECTOR);
    let nodes = query();
    const userHint = (selectorConfig.userHint || '').trim();
    const fileSelector = (selectorConfig.fileSelector || '').trim();
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    // ---- 1. 載入完整歷史：往上捲到頂，等新訊息載入，直到數量與捲動高度連續兩輪沒變 ----
    let scrollRounds = 0;
    // 用第一個「真的訊息」節點找捲動容器（側邊欄裡的符合節點不能拿來當基準）
    const anchor = nodes.find((el) => !inChrome(el)) || null;
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
        const sig = query().length + ':' + scroller.scrollHeight;
        stable = sig === last ? stable + 1 : 0;
        last = sig;
        if (stable >= 2) break;
      }
      scroller.scrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight - fromBottom);
      nodes = query();
    }

    const isUserMessage = function (el) {
      if (!userHint) return false;

      // 1) 優先比對 data-message-author-role 屬性值
      const roleAttr = el.getAttribute && el.getAttribute('data-message-author-role');
      if (roleAttr) {
        return roleAttr.toLowerCase() === userHint.toLowerCase();
      }

      // 2) 比對其他常見屬性是否包含 userHint（例如 "data-testid=user-message" 這種寫法）
      if (userHint.includes('=')) {
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

    let chromeSkipped = 0;
    const contentNodes = nodes.filter((el) => {
      if (inChrome(el)) {
        chromeSkipped += 1;
        return false;
      }
      return true;
    });

    // 去除「巢狀重複」：selector 是聯集（例如 claude 的 user-message +
    // font-claude-response）或外層容器也剛好符合時，querySelectorAll 會同時
    // 回傳外層與內層節點，外層的 innerText 又包含內層全部文字，結果同一段
    // 內容被重複擷取、越疊越多。這裡只保留「最內層」符合的節點（內含其他
    // 符合節點的外層容器一律略過）。
    const leafNodes = contentNodes.filter(
      (el) => !contentNodes.some((other) => other !== el && el.contains(other))
    );

    // ---- 2. 檔案收集 ----
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
    const collectFiles = (root, cardsOnly) => {
      const out = [];
      const seen = new Set();
      const add = (url, name, kind) => {
        const key = url || 'name:' + name;
        if (!name && !url) return;
        if (seen.has(key)) return;
        seen.add(key);
        out.push({ url: url || null, name: (name || baseName(url) || '').slice(0, 200), kind });
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

    const rawMessages = leafNodes
      .map((el) => {
        const text = (el.innerText || '').trim();
        const attachments = opts.collectFiles ? collectFiles(el) : [];
        if (!text && attachments.length === 0) return null;
        const m = { role: isUserMessage(el) ? 'user' : 'assistant', text };
        if (attachments.length) m.attachments = attachments;
        return m;
      })
      .filter(Boolean);

    // 去除「相鄰完全相同」的訊息（同一則訊息被多個節點包住時的保險）
    const messages = rawMessages.filter(
      (m, i) =>
        i === 0 ||
        !(m.role === rawMessages[i - 1].role && m.text === rawMessages[i - 1].text)
    );

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
        selectorUsed: selectorConfig.turn,
        matchedNodeCount: nodes.length,
        nonEmptyMessageCount: messages.length,
        chromeSkipped,
        scrollRounds,
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
