/**
 * domDiagnose.js
 *
 * 「診斷頁面結構」（1.51.0）：在目前帳號的畫面裡執行，產生一份純文字報告，說明
 * 為什麼對話擷取抓不到或抓不全，並列出頁面實際使用的 data-testid、角色屬性、自訂元素與 class 名稱，
 * 讓平台改版後可以對照調整選擇器。報告只含結構資訊（標籤、屬性名、class、數量、文字長度），
 * **不包含對話文字內容**，也不含網址的查詢字串。使用者可以複製後貼給開發者。
 *
 * 跟 domCapture.js 一樣由主行程讀成字串注入；會先呼叫同一支 capturePlatformConversation()
 * （不捲動、不收集檔案），所以兩個檔案要一起注入（見 lib/conversationCapture.js 的 diagnoseCapture）。
 */
async function diagnosePage(platform, selectorConfig) {
  const lines = [];
  const out = (s) => lines.push(s === undefined ? '' : String(s));
  try {
    const count = (sel) => {
      try {
        return document.querySelectorAll(sel).length;
      } catch (err) {
        return -1;
      }
    };
    const top = (map, n) =>
      Array.from(map.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, n)
        .map(([k, v]) => `${k} ×${v}`);
    const bump = (map, k) => map.set(k, (map.get(k) || 0) + 1);

    let urlText = location.href;
    try {
      const u = new URL(location.href);
      urlText = u.origin + u.pathname;
    } catch (err) {
      // 保持原樣
    }
    out(`# Platter 擷取診斷報告`);
    out(`platform: ${platform}`);
    out(`page: ${urlText}`);
    out(`title length: ${(document.title || '').length}`);
    out(`viewport: ${window.innerWidth}x${window.innerHeight}`);
    out('');

    // 1. 用目前設定實際跑一次（不捲動、不收集檔案），看每組候選的命中數
    const res = await capturePlatformConversation(platform, selectorConfig, {
      loadAll: false,
      collectFiles: true,
    });
    out('## 擷取結果');
    out(`ok: ${res.ok}  error: ${res.error || 'none'}  messages: ${res.messages.length}`);
    const roles = { user: 0, assistant: 0 };
    res.messages.forEach((m) => (roles[m.role] = (roles[m.role] || 0) + 1));
    out(`roles: user=${roles.user} assistant=${roles.assistant}`);
    const d = res.debug || {};
    out(`selector used: ${d.selectorUsed}  (candidate #${d.candidateIndex})`);
    out(`matched nodes: ${d.matchedNodeCount}  chromeSkipped: ${d.chromeSkipped}  chromeFallback: ${d.chromeFallback}`);
    out('candidates tried (turn → nodes / messages / both roles):');
    (d.candidatesTried || []).forEach((c, i) => out(`  ${i}. ${c.turn} → ${c.nodes} / ${c.messages} / ${c.both}`));
    out('');

    // 2. 頁面結構概況
    out('## 頁面結構');
    out(
      ['main', '[role="main"]', 'nav', 'aside', 'header', 'footer', 'form', 'dialog', 'article', 'textarea', '[contenteditable="true"]']
        .map((s) => `${s}=${count(s)}`)
        .join('  ')
    );
    const testids = new Map();
    document.querySelectorAll('[data-testid]').forEach((el) => bump(testids, el.getAttribute('data-testid').slice(0, 60)));
    out(`data-testid (top 25): ${top(testids, 25).join(', ')}`);
    const roleVals = new Map();
    document.querySelectorAll('[data-message-author-role]').forEach((el) => bump(roleVals, el.getAttribute('data-message-author-role')));
    out(`data-message-author-role: ${top(roleVals, 6).join(', ') || '(none)'}`);
    const turnVals = new Map();
    document.querySelectorAll('[data-turn]').forEach((el) => bump(turnVals, el.getAttribute('data-turn')));
    out(`data-turn: ${top(turnVals, 6).join(', ') || '(none)'}`);

    const tags = new Map();
    const classes = new Map();
    const TAG_RE = /message|response|query|turn|chat|conversation|answer|prompt|user|model/i;
    const CLASS_RE = /message|response|turn|markdown|prose|query|answer|bubble|user|assistant|model/i;
    document.querySelectorAll('*').forEach((el) => {
      const tag = el.tagName.toLowerCase();
      if (tag.includes('-') && TAG_RE.test(tag)) bump(tags, tag);
      if (typeof el.className === 'string' && el.className) {
        el.className
          .split(/\s+/)
          .filter((c) => c && c.length < 60 && CLASS_RE.test(c))
          .forEach((c) => bump(classes, c));
      }
    });
    out(`custom elements (name matches message/response/query/turn/chat…): ${top(tags, 20).join(', ') || '(none)'}`);
    out(`classes (name matches message/response/turn/markdown/…; top 30): ${top(classes, 30).join(', ') || '(none)'}`);
    out('');

    // 2.5 檔案相關（1.52.0）：要點擊才會下載的檔案偵測結果與頁面上的下載相關元素（只列標籤／class／副檔名，不列檔名與內容）
    out('## 檔案');
    const dlRe = /download|下載|下载|ダウンロード/i;
    const dlButtons = Array.from(document.querySelectorAll('button, [role="button"], [role="menuitem"], a')).filter((b) =>
      dlRe.test(String(b.getAttribute('aria-label') || b.innerText || '').slice(0, 40))
    ).length;
    out(
      `a[href^=sandbox:]=${count('a[href^="sandbox:"]')}  a[download]=${count('a[download]')}  blob links=${count('a[href^="blob:"]')}  ` +
        `下載相關按鈕=${dlButtons}  偵測到的點擊式檔案=${count('[data-platter-file]')}`
    );
    const extOf = (n) => (String(n).match(/\.([A-Za-z0-9]{1,8})$/) || [])[1] || '?';
    const perMsg = (res.messages || []).flatMap((m) => m.attachments || []);
    out(`attachments in messages: ${perMsg.length}  (${top(perMsg.reduce((mp, a) => (bump(mp, `${a.kind}:${extOf(a.name)}`), mp), new Map()), 12).join(', ') || 'none'})`);
    Array.from(document.querySelectorAll('[data-platter-file]'))
      .slice(0, 8)
      .forEach((el, i) => {
        const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0, 3).join('.').slice(0, 60) : '';
        out(`  ${i + 1}. <${el.tagName.toLowerCase()}> .${cls}  text length=${String(el.innerText || '').trim().length}  parent=<${el.parentElement ? el.parentElement.tagName.toLowerCase() : '-'}>`);
      });
    out('');

    // 3. 設定的選擇器命中的前幾個節點：祖先鏈、是否被視為外殼、文字長度（不輸出內容）
    out('## 設定的選擇器命中的節點（前 4 個）');
    let nodes = [];
    try {
      nodes = Array.from(document.querySelectorAll(selectorConfig.turn || '')).slice(0, 4);
    } catch (err) {
      out(`selector error: ${err.message}`);
    }
    if (nodes.length === 0) out('(none)');
    nodes.forEach((el, i) => {
      const chain = [];
      let p = el;
      for (let k = 0; p && k < 7; k += 1, p = p.parentElement) {
        const id = p.id ? '#' + String(p.id).slice(0, 24) : '';
        const cls = typeof p.className === 'string' && p.className ? '.' + p.className.trim().split(/\s+/).slice(0, 2).join('.').slice(0, 40) : '';
        chain.push(p.tagName.toLowerCase() + id + cls);
      }
      const chromeAncestor = typeof el.closest === 'function' ? el.closest('nav, aside, dialog, [role="navigation"], [role="complementary"], [role="dialog"]') : null;
      out(`${i + 1}. text length=${(el.innerText || '').trim().length}  inChrome=${!!chromeAncestor}  attrs=${Array.from(el.attributes).map((a) => a.name).slice(0, 8).join(',')}`);
      out(`   ancestors: ${chain.join(' < ')}`);
    });
  } catch (err) {
    out('diagnose error: ' + (err && err.message ? err.message : String(err)));
  }
  return lines.join('\n');
}
