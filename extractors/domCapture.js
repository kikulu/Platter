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
 */
function capturePlatformConversation(platform, selectorConfig) {
  try {
    if (!selectorConfig || !selectorConfig.turn) {
      return {
        ok: false,
        error: 'NO_SELECTOR',
        title: document.title || platform,
        messages: [],
        capturedAt: new Date().toISOString(),
        debug: { selectorUsed: null, matchedNodeCount: 0, nonEmptyMessageCount: 0, pageUrl: location.href },
      };
    }

    const nodes = Array.from(document.querySelectorAll(selectorConfig.turn));
    const userHint = (selectorConfig.userHint || '').trim();

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

    const messages = nodes
      .map((el) => {
        const text = (el.innerText || '').trim();
        if (!text) return null;
        return {
          role: isUserMessage(el) ? 'user' : 'assistant',
          text,
        };
      })
      .filter(Boolean);

    return {
      ok: messages.length > 0,
      error: messages.length > 0 ? null : 'EMPTY_RESULT',
      title: document.title || platform,
      messages,
      capturedAt: new Date().toISOString(),
      debug: {
        selectorUsed: selectorConfig.turn,
        matchedNodeCount: nodes.length,
        nonEmptyMessageCount: messages.length,
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
