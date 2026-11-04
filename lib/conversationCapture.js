const fs = require('fs');
const path = require('path');
const { app, dialog } = require('electron');
const { genId, ensureUniqueFilePath, toMarkdown } = require('./utils');
const {
  downloadAttachments,
  sanitizeFileName,
  uniqueName,
  LIMITS: ATTACHMENT_LIMITS,
} = require('./attachments');
const state = require('./state');
const { t } = require('./i18n');
const {
  loadSelectors,
  registerDocument,
  loadConversations,
  saveConversations,
  loadKnowledgeBase,
  saveKnowledgeBase,
} = require('./stores');
const { logError, logAudit } = require('./logs');
const { broadcastToAllWindows } = require('./broadcast');

// ---------------------------------------------------------------------------
// 對話匯出
// ---------------------------------------------------------------------------

// 備用選擇器（1.51.0）：extractors/capture-fallbacks.json 裡該平台的清單 + 通用清單。
// 平台改版時設定的選擇器可能抓不到，domCapture 會依序試這些並挑最好的結果。
function loadCaptureFallbacks(platform) {
  try {
    const data = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', 'extractors', 'capture-fallbacks.json'), 'utf-8')
    );
    const pick = (k) => (Array.isArray(data[k]) ? data[k] : []);
    return [...pick(platform), ...pick('generic')].filter(
      (c) => c && typeof c.turn === 'string' && c.turn.trim()
    );
  } catch (err) {
    return [];
  }
}

async function captureCurrentConversation(captureOptions = {}) {
  if (!state.activeAccountId) return { ok: false, error: 'NO_ACTIVE_ACCOUNT' };
  const entry = state.accountViews.get(state.activeAccountId);
  if (!entry) return { ok: false, error: 'NO_ACTIVE_ACCOUNT' };
  // 帳號頁面還沒載入（開機時記憶體吃緊而延後）或已崩潰：沒有頁面可以擷取
  if (!entry.view) return { ok: false, error: 'NOT_LOADED' };

  const selectors = loadSelectors();
  const selectorConfig = {
    ...(selectors[entry.platform] || {}),
    fallbacks: loadCaptureFallbacks(entry.platform),
  };
  const domCaptureSrc = fs.readFileSync(
    path.join(__dirname, '..', 'extractors', 'domCapture.js'),
    'utf-8'
  );
  const script = `${domCaptureSrc}\ncapturePlatformConversation(${JSON.stringify(
    entry.platform
  )}, ${JSON.stringify(selectorConfig)}, ${JSON.stringify({
    loadAll: captureOptions.loadAll !== false,
    collectFiles: captureOptions.collectFiles !== false,
  })});`;

  try {
    // domCapture 是 async（會先捲動載入完整歷史），executeJavaScript 會等 Promise
    const result = await entry.view.webContents.executeJavaScript(script);
    const debug = result && result.debug;
    console.log(
      `[conversation:capture] platform=${entry.platform} ok=${result ? result.ok : false} ` +
        `matchedNodes=${debug ? debug.matchedNodeCount : '?'} nonEmptyMessages=${
          debug ? debug.nonEmptyMessageCount : '?'
        } chromeSkipped=${debug ? debug.chromeSkipped : '?'} candidate=${
          debug ? debug.candidateIndex : '?'
        } scrollRounds=${
          debug ? debug.scrollRounds : '?'
        } attachments=${debug ? debug.attachmentCount : '?'} ` +
        `selector="${debug ? debug.selectorUsed : selectorConfig.turn || '(unset)'}" ` +
        `error=${result && result.error ? result.error : 'none'}` +
        (debug && debug.pageUrl ? ` url=${debug.pageUrl}` : '') +
        (result && !result.ok && debug && debug.pageProbe
          ? ` probe=${JSON.stringify(debug.pageProbe)}`
          : '')
    );
    if (!result || !result.ok) {
      logError(
        'conversation:capture',
        t('main.capture.log.failed', {
          platform: entry.platform,
          error: result ? result.error : 'UNKNOWN',
        }) +
          (debug
            ? t('main.capture.log.failedDetail', {
                nodes: debug.matchedNodeCount,
                messages: debug.nonEmptyMessageCount,
              }) +
              (debug.candidatesTried
                ? ' candidates=' + JSON.stringify(debug.candidatesTried).slice(0, 600)
                : '') +
              // 匯出的日誌檔也要帶網址與頁面探針（console 使用者通常看不到）
              (debug.pageUrl ? ' url=' + debug.pageUrl : '') +
              (debug.pageProbe ? ' probe=' + JSON.stringify(debug.pageProbe) : '')
            : '')
      );
      // 一個節點都沒命中：自動跑一次結構診斷並寫進日誌，使用者不用另外操作就能把完整資訊貼回來
      if (result && result.error === 'EMPTY_RESULT' && debug && !debug.matchedNodeCount) {
        try {
          const report = await runDiagnose(entry, selectorConfig);
          // 寫進持久化的錯誤日誌（日誌匯出檔會帶出），不是只印在主控台
          logError('conversation:diagnose', `platform=${entry.platform}\n${String(report).slice(0, 6000)}`);
        } catch (diagErr) {
          logError('conversation:diagnose', 'diagnose failed: ' + (diagErr && diagErr.message));
        }
      }
    }
    return result;
  } catch (err) {
    logError(
      'conversation:capture',
      t('main.capture.log.failedShort', { platform: entry.platform }),
      err
    );
    return { ok: false, error: 'EXECUTE_FAILED: ' + err.message };
  }
}

// 把擷取結果裡所有附件下載到 destDir，並把每筆附件的 status／localName 寫回 result（就地修改，
// 之後輸出 md／json 時會一起帶出）。http(s) 用「這個帳號自己的 session」下載（帶登入 cookie），
// blob: 要回到頁面裡 fetch 再轉 base64。網址安全檢查與數量／大小上限見 lib/attachments.js。
async function downloadConversationFiles(entry, result, destDir) {
  const lists = [...result.messages.map((m) => m.attachments || []), result.pageFiles || []];
  const flat = lists.flat();
  if (!entry || !entry.view) {
    return { saved: 0, failed: 0, nameOnly: flat.length, skipped: 0 };
  }
  const wc = entry.view.webContents;
  const pageUrl = (result.debug && result.debug.pageUrl) || wc.getURL();
  const io = {
    pageUrl,
    fetchUrl: async (url, kind) => {
      if (kind === 'blob') {
        const out = await wc.executeJavaScript(
          `(async (u, max) => {
            const r = await fetch(u);
            const b = await r.blob();
            if (b.size > max) throw new Error('too-large');
            const bytes = new Uint8Array(await b.arrayBuffer());
            let bin = '';
            for (let i = 0; i < bytes.length; i += 32768) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 32768));
            return { b64: btoa(bin), type: b.type };
          })(${JSON.stringify(url)}, ${ATTACHMENT_LIMITS.fileBytes})`
        );
        return { buffer: Buffer.from(out.b64, 'base64'), contentType: out.type };
      }
      const res = await wc.session.fetch(url, { redirect: 'follow' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const len = Number(res.headers.get('content-length') || 0);
      if (len > ATTACHMENT_LIMITS.fileBytes) throw new Error('too-large');
      // 邊讀邊檢查大小，超過上限就中止（content-length 可能不存在或說謊）
      const chunks = [];
      let size = 0;
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > ATTACHMENT_LIMITS.fileBytes) {
          await reader.cancel();
          throw new Error('too-large');
        }
        chunks.push(Buffer.from(value));
      }
      return {
        buffer: Buffer.concat(chunks),
        contentType: res.headers.get('content-type') || '',
        contentDisposition: res.headers.get('content-disposition') || '',
      };
    },
  };
  const summary = await downloadAttachments(flat, destDir, io);
  flat.forEach((att, i) => {
    const r = summary.results[i];
    att.status = r.status;
    if (r.localName) att.localName = r.localName;
    if (r.reason) att.reason = r.reason;
  });
  // 1.52.0：沒有直接網址、要點下去才會下載的檔案（ChatGPT sandbox: 連結、Claude 成品卡片）：
  // 回頁面點擊，由 session 的 will-download 接住存進 destDir
  const used = new Set();
  let clickSaved = 0;
  let clickFailed = 0;
  const triggers = flat.filter((a) => a.trigger && a.status === 'name-only').slice(0, 30);
  // 1.52.7：優先用 Claude 右上角 Outputs 面板標題列的下載圖示（一次打包全部檔案，含各種副檔名）；
  // 成功就不再逐一點擊卡片，失敗才退回逐一點擊
  // 1.53.0：Outputs 面板的「Download all」是 Claude 專有；ChatGPT／Gemini／Grok／Copilot 沒有，不要去找，
  // 避免誤點頁面上其他按鈕
  const isClaude = entry.platform === 'claude';
  let panelBundle = [];
  if (isClaude && triggers.length > 0) {
    try {
      panelBundle = await downloadOutputsPanelBundle(wc, destDir, used);
    } catch (err) {
      logError('conversation:files', 'outputs-panel download failed: ' + (err && err.message));
    }
  }
  if (panelBundle.length > 0) {
    triggers.forEach((att) => {
      const m = matchDownloaded(att, panelBundle);
      att.status = 'saved';
      att.localName = m.name;
      if (!m.exact) att.reason = 'bundle';
    });
    // 面板打包的檔案數可能比頁面上偵測到的卡片多（面板列出對話全部檔案），實際存下幾個就算幾個
    clickSaved += panelBundle.length;
    trace(`outputs-panel saved ${panelBundle.length} files: ${panelBundle.join(', ')}`);
  } else {
    // 連續失敗 2 次就停止（每次失敗要白等 20 秒；通常是偵測錯誤或平台沒有對應的下載行為），剩下的標成略過
    let consecutiveFails = 0;
    for (const att of triggers) {
      if (consecutiveFails >= 2) {
        att.status = 'failed';
        att.reason = 'skipped-after-failures';
        clickFailed += 1;
        continue;
      }
      const r = await clickDownload(wc, att, destDir, used);
      att.status = r.status;
      if (r.localName) att.localName = r.localName;
      if (r.reason) att.reason = r.reason;
      if (r.status === 'saved') {
        clickSaved += 1;
        consecutiveFails = 0;
      } else {
        clickFailed += 1;
        consecutiveFails += 1;
      }
    }
  }
  // 1.52.4：個別點擊沒抓到的檔案，改驅動平台自己的「Download all／全部下載」按鈕（Claude 會打包成 zip），
  // 打包檔存進同一個資料夾，沒抓到的項目標成 saved（localName 指向打包檔、reason=bundle）
  const missed = triggers.filter((a) => a.status !== 'saved');
  if (isClaude && missed.length > 0) {
    try {
      const bundles = await downloadAllBundles(wc, destDir, used);
      if (bundles.length > 0) {
        missed.forEach((att) => {
          att.status = 'saved';
          att.localName = bundles[0];
          att.reason = 'bundle';
          delete att.reasonDetail;
        });
        clickSaved += bundles.length;
        clickFailed -= missed.length;
      }
    } catch (err) {
      logError('conversation:downloadAll', 'download-all failed: ' + (err && err.message));
    }
  }
  // 逐檔結果寫進日誌，個別下載失敗時匯出的日誌檔就能看到原因
  const failedLines = triggers
    .filter((a) => a.status !== 'saved')
    .map((a) => `${a.name}: ${a.reason || a.status}`);
  if (failedLines.length) logError('conversation:files', 'click-download failed → ' + failedLines.join(' | '));
  summary.saved += clickSaved;
  summary.failed += clickFailed;
  summary.nameOnly = Math.max(0, summary.nameOnly - clickSaved - clickFailed);
  logAudit(
    'conversation',
    'exportFiles',
    t('main.capture.log.exportFiles', {
      saved: summary.saved,
      failed: summary.failed,
      skipped: summary.skipped,
    })
  );
  return {
    saved: summary.saved,
    failed: summary.failed,
    nameOnly: summary.nameOnly,
    skipped: summary.skipped,
  };
}

// 點擊頁面上的檔案卡片／連結並接住下載。第一步只點它本身（ChatGPT 的 sandbox: 連結會直接下載）；
// 2 秒內沒開始下載，再找預覽面板／選單裡的「下載」按鈕（Claude 的成品卡片先開預覽）。
const CLICK_STEP1 = (n) => `(() => {
  const el = document.querySelector('[data-platter-file="${String(n).replace(/[^0-9]/g, '')}"]');
  if (!el) return 'missing';
  try { el.scrollIntoView({ block: 'center' }); } catch (e) {}
  el.click();
  return 'clicked';
})()`;
const CLICK_STEP2 = (n) => `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const el = document.querySelector('[data-platter-file="${String(n).replace(/[^0-9]/g, '')}"]');
  // 平台頁面上的「下載」按鈕文字（繁／簡／日），用 Unicode 跳脫避免寫死中文字串
  const DL = /^(download|\\u4e0b\\u8f09|\\u4e0b\\u8f7d|\\u30c0\\u30a6\\u30f3\\u30ed\\u30fc\\u30c9)/i;
  const visible = (b) => !!(b.offsetWidth || b.offsetHeight || b.getClientRects().length);
  const find = (skip) => Array.from(document.querySelectorAll('button, [role="button"], [role="menuitem"], a')).find((b) => {
    if (b === skip || (el && (b === el || el.contains(b)))) return false;
    const t = String(b.getAttribute('aria-label') || b.innerText || '').trim();
    return t.length > 0 && t.length < 40 && DL.test(t) && visible(b);
  });
  for (let i = 0; i < 6; i += 1) {
    await sleep(400);
    const b = find(null);
    if (b) {
      b.click();
      await sleep(600);
      const m = find(b);
      if (m) m.click();
      return 'download-clicked';
    }
  }
  return 'no-download-button';
})()`;

function clickDownload(wc, att, destDir, used) {
  return new Promise((resolve) => {
    let settled = false;
    let started = false;
    let timer = null;
    const sess = wc.session;
    const finish = (r) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      sess.removeListener('will-download', onDownload);
      trace(`click trigger=${att.trigger} started=${started} → ${JSON.stringify(r)}`);
      resolve(r);
    };
    function onDownload(_event, item) {
      if (settled) return;
      started = true;
      trace(`will-download trigger=${att.trigger} file=${item.getFilename()} bytes=${item.getTotalBytes()}`);
      clearTimeout(timer);
      if (item.getTotalBytes() > ATTACHMENT_LIMITS.fileBytes) {
        item.cancel();
        finish({ status: 'skipped', reason: 'too-large' });
        return;
      }
      let name = sanitizeFileName(item.getFilename() || att.name || 'file');
      fs.mkdirSync(destDir, { recursive: true });
      name = uniqueName(destDir, name, used);
      item.setSavePath(path.join(destDir, name));
      timer = setTimeout(() => {
        item.cancel();
        finish({ status: 'failed', reason: 'timeout' });
      }, 120000);
      item.once('done', (_e, state) =>
        finish(state === 'completed' ? { status: 'saved', localName: name } : { status: 'failed', reason: 'download-' + state })
      );
    }
    sess.on('will-download', onDownload);
    timer = setTimeout(() => finish({ status: 'failed', reason: 'no-download' }), att.waitMs || 20000);
    (async () => {
      try {
        const r1 = await wc.executeJavaScript(CLICK_STEP1(att.trigger));
        trace(`click step1 trigger=${att.trigger} → ${r1}`);
        if (r1 === 'missing') return finish({ status: 'failed', reason: 'element-missing' });
        await new Promise((r) => setTimeout(r, 2000));
        if (settled || started || att.noStep2) return;
        // 2 秒內沒開始下載：試第二步
        trace(`click step2 trigger=${att.trigger} → ${await wc.executeJavaScript(CLICK_STEP2(att.trigger))}`);
      } catch (err) {
        finish({ status: 'failed', reason: String((err && err.message) || err).slice(0, 80) });
      }
    })();
  });
}

// 平台頁面上「全部下載」按鈕的文字（英／繁／簡／日），用 Unicode 跳脫避免寫死中文字串
// 匯出檔案的逐步追蹤（寫進稽核日誌，匯出日誌檔看得到；只在匯出檔案時寫，不含對話內容）
function trace(msg) {
  try {
    logAudit('conversation', 'filesTrace', String(msg).slice(0, 400));
  } catch (err) {
    // 日誌失敗不影響匯出
  }
}

const MARK_DL_ALL = `(() => {
  const DL = /^(download all|download everything|\\u4e0b\\u8f09\\u5168\\u90e8|\\u5168\\u90e8\\u4e0b\\u8f09|\\u4e0b\\u8f09\\u6240\\u6709|\\u4e0b\\u8f7d\\u5168\\u90e8|\\u5168\\u90e8\\u4e0b\\u8f7d|\\u4e0b\\u8f7d\\u6240\\u6709|\\u3059\\u3079\\u3066\\u30c0\\u30a6\\u30f3\\u30ed\\u30fc\\u30c9)/i;
  const visible = (b) => !!(b.offsetWidth || b.offsetHeight || b.getClientRects().length);
  const found = Array.from(document.querySelectorAll('button, [role="button"], [role="menuitem"], a')).filter((b) => {
    const t = String(b.getAttribute('aria-label') || b.innerText || '').trim();
    return t.length > 0 && t.length < 40 && DL.test(t) && visible(b);
  });
  found.slice(0, 10).forEach((b, i) => b.setAttribute('data-platter-file', String(9001 + i)));
  return Math.min(found.length, 10);
})()`;

// 驅動平台的「全部下載」按鈕，回傳存下來的打包檔名稱（最多 10 個按鈕，循序點擊）
// 1.52.5：Claude 把對話的所有檔案集中在右上角「檔案數量」按鈕開出的 Outputs 面板，沒點開時看不到
// Download all 之類的按鈕。這裡先找標題列右側、文字只有數字的按鈕（如「4」）點開；面板已開就不再點（避免關掉）。
const OPEN_OUTPUTS_PANEL = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const visible = (b) => !!(b.offsetWidth || b.offsetHeight || b.getClientRects().length);
  const OUT = /^(outputs|\\u8f38\\u51fa|\\u8f93\\u51fa|\\u51fa\\u529b)$/i;
  const panelOpen = () => Array.from(document.querySelectorAll('h1, h2, h3, h4, div, span')).some((e) =>
    e.children.length === 0 && OUT.test(String(e.innerText || '').trim()) && visible(e) &&
    e.getBoundingClientRect().left > window.innerWidth * 0.3);
  if (panelOpen()) return 'already-open';
  const btn = Array.from(document.querySelectorAll('button, [role="button"]')).find((b) => {
    if (!visible(b)) return false;
    const r = b.getBoundingClientRect();
    return r.top < 100 && r.left > window.innerWidth / 2 && /^\\d{1,3}$/.test(String(b.innerText || '').trim());
  });
  if (!btn) return 'no-toggle';
  btn.click();
  for (let i = 0; i < 6; i += 1) {
    await sleep(300);
    if (panelOpen()) return 'opened';
  }
  return 'clicked';
})()`;

// Outputs 面板標題列（「Outputs」＋下載圖示＋關閉 X）：找標題往外最多 4 層、含 2 個以上按鈕的容器，
// 優先取 aria-label／title 含 download 的按鈕，否則取「沒有文字的圖示按鈕」倒數第二個（最後一個是關閉）。
// 檔案列有文字，不會被當成圖示按鈕。
const MARK_PANEL_DL = `(() => {
  const OUT = /^(outputs|\\u8f38\\u51fa|\\u8f93\\u51fa|\\u51fa\\u529b)$/i;
  const DL = /(download|\\u4e0b\\u8f09|\\u4e0b\\u8f7d|\\u30c0\\u30a6\\u30f3\\u30ed\\u30fc\\u30c9)/i;
  const visible = (b) => !!(b.offsetWidth || b.offsetHeight || b.getClientRects().length);
  const head = Array.from(document.querySelectorAll('h1, h2, h3, h4, div, span')).find((e) =>
    e.children.length === 0 && OUT.test(String(e.innerText || '').trim()) && visible(e) &&
    e.getBoundingClientRect().left > window.innerWidth * 0.3);
  if (!head) return '';
  let up = head.parentElement;
  for (let i = 0; up && i < 4; i += 1, up = up.parentElement) {
    const btns = Array.from(up.querySelectorAll('button, [role="button"]')).filter(visible);
    if (btns.length < 2) continue;
    const named = btns.find((b) => DL.test(String(b.getAttribute('aria-label') || b.getAttribute('title') || '')));
    const icons = btns.filter((b) => !String(b.innerText || '').trim());
    const target = named || (icons.length >= 2 ? icons[icons.length - 2] : null);
    if (target) {
      target.setAttribute('data-platter-file', '9100');
      const r = target.getBoundingClientRect();
      return 'level=' + i + ' buttons=' + btns.length + ' icons=' + icons.length + ' named=' + !!named +
        ' target=<' + target.tagName.toLowerCase() + '> aria=' + String(target.getAttribute('aria-label') || '').slice(0, 30) +
        ' rect=' + Math.round(r.left) + ',' + Math.round(r.top);
    }
  }
  return '';
})()`;

// 點一下會連續觸發「多個」下載（Claude 的 Outputs 面板「Download all」實測是每個檔案各一個下載，不是 zip）。
// 監聽器要一直留著，直到所有下載完成、且一段時間沒有新的下載事件，不能像單檔那樣第一個完成就收工。
function clickDownloadMany(wc, trigger, destDir, used, { startWaitMs = 20000, idleMs = 2500, maxMs = 120000 } = {}) {
  return new Promise((resolve) => {
    const sess = wc.session;
    const names = [];
    let pending = 0;
    let lastEvent = 0;
    let finished = false;
    const t0 = Date.now();
    const finish = () => {
      if (finished) return;
      finished = true;
      clearInterval(poll);
      sess.removeListener('will-download', onDownload);
      trace(`click-many trigger=${trigger} files=${names.length}`);
      resolve(names);
    };
    function onDownload(_event, item) {
      if (finished) return;
      lastEvent = Date.now();
      trace(`will-download trigger=${trigger} file=${item.getFilename()} bytes=${item.getTotalBytes()}`);
      if (item.getTotalBytes() > ATTACHMENT_LIMITS.fileBytes) {
        item.cancel();
        return;
      }
      const name = uniqueName(destDir, sanitizeFileName(item.getFilename() || 'file'), used);
      fs.mkdirSync(destDir, { recursive: true });
      item.setSavePath(path.join(destDir, name));
      pending += 1;
      item.once('done', (_e, state) => {
        pending -= 1;
        lastEvent = Date.now();
        if (state === 'completed') names.push(name);
        else trace(`download ${name} → ${state}`);
      });
    }
    sess.on('will-download', onDownload);
    const poll = setInterval(() => {
      const now = Date.now();
      const started = lastEvent > 0;
      if (started && pending === 0 && now - lastEvent > idleMs) finish();
      else if (!started && now - t0 > startWaitMs) finish();
      else if (now - t0 > maxMs) finish();
    }, 200);
    wc.executeJavaScript(CLICK_STEP1(trigger))
      .then((r) => trace(`click-many step1 trigger=${trigger} → ${r}`))
      .catch((err) => {
        trace('click-many step1 error: ' + ((err && err.message) || err));
        finish();
      });
  });
}

// 開 Outputs 面板、點標題列的「Download all」，回傳實際存下來的檔名清單
async function downloadOutputsPanelBundle(wc, destDir, used) {
  let opened = 'error';
  try {
    opened = await wc.executeJavaScript(OPEN_OUTPUTS_PANEL);
  } catch (err) {
    // 開不了面板就照現況找
  }
  trace('outputs-panel open → ' + opened);
  const found = await wc.executeJavaScript(MARK_PANEL_DL);
  trace('outputs-panel download button → ' + (found || 'not found'));
  if (!found) return [];
  const names = await clickDownloadMany(wc, '9100', destDir, used);
  // 確認檔案真的寫進資料夾
  return names.filter((n) => {
    try {
      return fs.statSync(path.join(destDir, n)).size > 0;
    } catch (err) {
      return false;
    }
  });
}

// 依名稱把附件對到實際下載的檔案（正規化後相等或互相包含）；對不到的指向第一個
function matchDownloaded(att, names) {
  const norm = (x) => String(x || '').toLowerCase().replace(/\.[a-z0-9]{1,8}$/i, '').replace(/[^a-z0-9\u4e00-\u9fff]/g, '');
  const a = norm(att.name);
  if (a) {
    const hit = names.find((n) => {
      const f = norm(n.replace(/ \(\d+\)(?=\.[^.]*$|$)/, ''));
      return f && (f === a || f.includes(a) || a.includes(f));
    });
    if (hit) return { name: hit, exact: true };
  }
  return { name: names[0], exact: false };
}

async function downloadAllBundles(wc, destDir, used) {
  try {
    await wc.executeJavaScript(OPEN_OUTPUTS_PANEL);
  } catch (err) {
    // 開不了面板不影響後面照現況找按鈕
  }
  const count = await wc.executeJavaScript(MARK_DL_ALL);
  const saved = [];
  for (let i = 0; i < count; i += 1) {
    const r = await clickDownload(wc, { name: 'download-all.zip', trigger: String(9001 + i) }, destDir, used);
    if (r.status === 'saved' && r.localName) saved.push(r.localName);
  }
  return saved;
}

async function exportCurrentConversation(format, options = {}) {
  const { forceChoosePath = false, addToKnowledge = false, downloadFiles = true } = options;
  const result = await captureCurrentConversation({ collectFiles: downloadFiles });
  if (!result || !result.ok) {
    // captureCurrentConversation() 內部已經記過詳細的 logError，這裡不重複記錄，
    // 只把「使用者當下按了匯出，但因為擷取失敗所以整個匯出動作沒有成功」這件
    // 事實補記一筆稽核紀錄，方便回頭對照時間點。
    logAudit(
      'conversation',
      'exportFailed',
      t('main.capture.log.exportCurrentFailed', {
        error: result ? result.error : 'UNKNOWN',
      })
    );
    return {
      ok: false,
      error: result ? result.error : 'UNKNOWN',
      debug: result ? result.debug : undefined,
    };
  }

  const ext = format === 'json' ? 'json' : 'md';
  const baseName = (result.title || 'conversation').replace(/[\\/:*?"<>|]/g, '_');

  const defaultDir = state.appState.ui.defaultSavePath || app.getPath('documents');
  const currentEntry = state.activeAccountId
    ? state.accountViews.get(state.activeAccountId)
    : null;

  function registerExportedFile(filePath) {
    let size = 0;
    try {
      size = fs.statSync(filePath).size;
    } catch (err) {
      // 忽略，size 只是附加資訊
    }
    registerDocument({
      name: path.basename(filePath),
      originalName: path.basename(filePath),
      filePath,
      size,
      managed: false, // 檔案留在使用者選擇/預設的儲存位置，文件庫只是登記引用
      sourceAccountId: state.activeAccountId,
      sourcePlatform: currentEntry ? currentEntry.platform : null,
      tags: currentEntry ? [currentEntry.platform] : [],
    });
    logAudit(
      'conversation',
      'export',
      t('main.capture.log.exportCurrent', {
        title: result.title || '',
        platform: currentEntry
          ? currentEntry.platform
          : t('main.capture.unknownPlatform'),
        path: filePath,
      })
    );

    // 「匯出時同時加入知識庫」是匯出對話框裡另外勾選的選項，跟「檔案存
    // 成 md 還是 json」是兩件事——不管使用者選了哪種檔案格式，知識庫
    // 項目一律存成人類好讀的 Markdown（toMarkdown(result)），因為知識庫
    // 本來就是拿來當提示詞/參考資料用的，原始 JSON 丟進去不好閱讀也不
    // 方便直接複製貼上使用。
    if (addToKnowledge) {
      const kb = loadKnowledgeBase();
      const now = new Date().toISOString();
      const title = result.title || baseName;
      kb.items.push({
        id: genId('kb'),
        title,
        content: toMarkdown(result), // 不帶 linkDir：知識庫裡只列附件名稱，不放會失效的相對路徑
        tags: currentEntry ? [currentEntry.platform] : [],
        checklist: [],
        roleIds: [],
        createdAt: now,
        updatedAt: now,
      });
      saveKnowledgeBase(kb);
      broadcastToAllWindows('knowledge:changed');
      logAudit(
        'knowledge',
        'addFromExport',
        t('main.capture.log.addedToKnowledge', { title })
      );
    }
  }

  try {
    // 預設路徑 + 略過對話框的設定是全域偏好；但使用者這次在匯出對話框
    // 裡按了「另存到其他路徑」（forceChoosePath），代表這一次想自己選，
    // 就算全域設定是「略過對話框」也要照樣跳出存檔對話框，不能被全域
    // 設定蓋過去。
    let filePath;
    if (state.appState.ui.skipSaveDialog && !forceChoosePath) {
      filePath = ensureUniqueFilePath(defaultDir, baseName, ext);
    } else {
      const picked = await dialog.showSaveDialog(state.mainWindow, {
        title: t('main.capture.exportTitle'),
        defaultPath: path.join(defaultDir, `${baseName}.${ext}`),
        filters:
          format === 'json'
            ? [{ name: 'JSON', extensions: ['json'] }]
            : [{ name: 'Markdown', extensions: ['md'] }],
      });
      if (picked.canceled || !picked.filePath) return { ok: false, error: 'CANCELLED' };
      filePath = picked.filePath;
    }
    fs.mkdirSync(path.dirname(filePath), { recursive: true });

    // 對話裡的檔案（1.50.0）：存到匯出檔旁邊的「<檔名>_files」資料夾，檔案內容裡的附件改成指向它的相對連結。
    // 下載失敗不影響對話本身的匯出，只在回傳的 files 裡回報數量。
    let filesSummary = null;
    let linkDir;
    const allAttachments = [
      ...result.messages.flatMap((m) => m.attachments || []),
      ...(result.pageFiles || []),
    ];
    if (downloadFiles && allAttachments.length > 0) {
      const dirName = `${path.basename(filePath, path.extname(filePath))}_files`;
      filesSummary = await downloadConversationFiles(
        currentEntry,
        result,
        path.join(path.dirname(filePath), dirName)
      );
      if (filesSummary.saved > 0) {
        linkDir = dirName;
        filesSummary.dir = dirName;
      }
    }

    const content =
      format === 'json' ? JSON.stringify(result, null, 2) : toMarkdown(result, { linkDir });
    fs.writeFileSync(filePath, content, 'utf-8');
    registerExportedFile(filePath);
    return { ok: true, filePath, files: filesSummary };
  } catch (err) {
    logError('conversation:export', t('main.capture.log.writeExportFailed'), err);
    return { ok: false, error: 'WRITE_FAILED: ' + err.message };
  }
}

// ---------------------------------------------------------------------------
// 對話庫：把庫裡的一則對話匯出成檔案，並自動登記進文件庫、跟這則對話互相關聯
// ---------------------------------------------------------------------------

async function exportConversationEntry(id, format) {
  const conversations = loadConversations();
  const conv = conversations.find((c) => c.id === id);
  if (!conv) return { ok: false, error: 'NOT_FOUND' };

  const ext = format === 'json' ? 'json' : 'md';
  const content =
    format === 'json'
      ? JSON.stringify(
          { title: conv.title, tags: conv.tags, content: conv.content },
          null,
          2
        )
      : conv.content || '';
  const baseName = (conv.title || 'conversation').replace(/[\\/:*?"<>|]/g, '_');
  const defaultDir = state.appState.ui.defaultSavePath || app.getPath('documents');

  let filePath;
  if (state.appState.ui.skipSaveDialog) {
    filePath = ensureUniqueFilePath(defaultDir, baseName, ext);
  } else {
    const parentWin =
      state.conversationsWindow && !state.conversationsWindow.isDestroyed()
        ? state.conversationsWindow
        : state.mainWindow;
    const result = await dialog.showSaveDialog(parentWin, {
      title: t('main.capture.exportTitle'),
      defaultPath: path.join(defaultDir, `${baseName}.${ext}`),
      filters:
        format === 'json'
          ? [{ name: 'JSON', extensions: ['json'] }]
          : [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (result.canceled || !result.filePath) return { ok: false, error: 'CANCELLED' };
    filePath = result.filePath;
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  try {
    fs.writeFileSync(filePath, content, 'utf-8');
  } catch (err) {
    logError(
      'conversation:export',
      t('main.capture.log.writeExportFailedPath', { path: filePath }),
      err
    );
    return { ok: false, error: 'WRITE_FAILED: ' + err.message };
  }

  let size = 0;
  try {
    size = fs.statSync(filePath).size;
  } catch (err) {
    // 忽略，size 只是附加資訊
  }

  // 自動登記進文件庫（只記錄路徑引用，不複製），並跟來源對話互相關聯
  const documents = registerDocument({
    name: path.basename(filePath),
    originalName: path.basename(filePath),
    filePath,
    size,
    managed: false,
    sourceAccountId: conv.sourceAccountId || null,
    sourcePlatform: conv.sourcePlatform || null,
    tags: conv.tags && conv.tags.length ? conv.tags : [t('main.capture.conversationTag')],
  });
  const newDoc = documents[documents.length - 1];

  conv.linkedDocumentIds = Array.isArray(conv.linkedDocumentIds)
    ? conv.linkedDocumentIds
    : [];
  if (newDoc && !conv.linkedDocumentIds.includes(newDoc.id)) {
    conv.linkedDocumentIds.push(newDoc.id);
  }
  conv.updatedAt = new Date().toISOString();
  saveConversations(conversations);
  broadcastToAllWindows('conversations:changed');
  logAudit(
    'conversation',
    'export',
    t('main.capture.log.conversationExported', {
      title: conv.title || '',
      path: filePath,
    })
  );

  return { ok: true, filePath, documentId: newDoc ? newDoc.id : null };
}

// ---------------------------------------------------------------------------
// 選取器工具（滑鼠選取範例訊息）
// ---------------------------------------------------------------------------

// 診斷頁面結構（1.51.0）：在「指定平台」的帳號畫面（優先目前作用中的）注入 domCapture + domDiagnose，
// 回傳純文字報告（只含結構資訊，不含對話文字）。使用者可複製後貼給開發者，用來調整選擇器。
// 在指定帳號視圖跑結構診斷（domDiagnose.js），回傳文字報告
async function runDiagnose(entry, selectorConfig) {
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'extractors', f), 'utf-8');
  const script = `${read('domCapture.js')}\n${read('domDiagnose.js')}\ndiagnosePage(${JSON.stringify(
    entry.platform
  )}, ${JSON.stringify(selectorConfig)});`;
  return entry.view.webContents.executeJavaScript(script);
}

async function diagnoseCapture(platform) {
  const activeEntry = state.activeAccountId ? state.accountViews.get(state.activeAccountId) : null;
  let entry = activeEntry && (!platform || activeEntry.platform === platform) ? activeEntry : null;
  if (!entry && platform) {
    entry =
      Array.from(state.accountViews.values()).find((e) => e.platform === platform && e.view) || null;
  }
  if (!entry) entry = activeEntry;
  if (!entry || !entry.view) return { ok: false, error: 'NO_ACCOUNT_FOR_PLATFORM' };
  const selectors = loadSelectors();
  const selectorConfig = {
    ...(selectors[entry.platform] || {}),
    fallbacks: loadCaptureFallbacks(entry.platform),
  };
  try {
    const report = await runDiagnose(entry, selectorConfig);
    return { ok: true, platform: entry.platform, report };
  } catch (err) {
    return { ok: false, error: 'EXECUTE_FAILED: ' + err.message };
  }
}

async function pickSelectorSample() {
  if (!state.activeAccountId) return { cancelled: true, error: 'NO_ACTIVE_ACCOUNT' };
  const entry = state.accountViews.get(state.activeAccountId);
  if (!entry) return { cancelled: true, error: 'NO_ACTIVE_ACCOUNT' };

  if (state.settingsWindow && !state.settingsWindow.isDestroyed())
    state.settingsWindow.minimize();
  if (state.mainWindow) {
    state.mainWindow.show();
    state.mainWindow.focus();
  }

  const pickerSrc = fs.readFileSync(
    path.join(__dirname, '..', 'extractors', 'selectorPicker.js'),
    'utf-8'
  );

  try {
    const result = await entry.view.webContents.executeJavaScript(pickerSrc);
    return result;
  } catch (err) {
    logError('selector:pick', t('main.capture.log.pickerFailed'), err);
    return { cancelled: true, error: err.message };
  } finally {
    if (state.settingsWindow && !state.settingsWindow.isDestroyed())
      state.settingsWindow.restore();
  }
}

// ---------------------------------------------------------------------------
// 選擇器設定：測試擷取預覽
// ---------------------------------------------------------------------------

// 跟 captureCurrentConversation() 的差異：
//   1. 用的是使用者在「設定 → 選擇器設定」表單裡「還沒按儲存」的 selector，
//      不是從 selectors.json 讀出來的已儲存版本，這樣調整 selector 時可以
//      邊改邊測，不用每次都先存檔。
//   2. 鎖定測試「選擇的那個平台」，不是「目前作用中的帳號」：如果目前
//      作用中的帳號剛好就是這個平台就直接用，否則找第一個開著的同平台
//      帳號；一個都沒有就回傳 NO_ACCOUNT_FOR_PLATFORM，請使用者先開一個
//      該平台的帳號再測試。
//   3. 故意不寫檔、不登記文件庫、也不記錯誤/稽核日誌——調整 selector 本來
//      就會反覆試錯，每次失敗都記一筆錯誤日誌只會洗版日誌表、稀釋掉真正
//      該注意的錯誤，單純把擷取結果（含 debug 診斷數字）回傳給 UI 即時
//      顯示就好。仍然保留 console.log 這行，方便對照日誌主控台的「主控台」
//      分頁排查。
async function testCaptureSelector(platform, selector) {
  const activeEntry = state.activeAccountId
    ? state.accountViews.get(state.activeAccountId)
    : null;
  let entry = activeEntry && activeEntry.platform === platform ? activeEntry : null;
  if (!entry) {
    entry =
      Array.from(state.accountViews.values()).find(
        (e) => e.platform === platform && e.view
      ) || null;
  }
  if (!entry) {
    return { ok: false, error: 'NO_ACCOUNT_FOR_PLATFORM', messages: [] };
  }

  if (!selector || !selector.turn) {
    return {
      ok: false,
      error: 'NO_SELECTOR',
      messages: [],
      debug: { selectorUsed: null, matchedNodeCount: 0, nonEmptyMessageCount: 0 },
    };
  }

  const domCaptureSrc = fs.readFileSync(
    path.join(__dirname, '..', 'extractors', 'domCapture.js'),
    'utf-8'
  );
  const script = `${domCaptureSrc}\ncapturePlatformConversation(${JSON.stringify(
    platform
  )}, ${JSON.stringify(selector)}, ${JSON.stringify({ loadAll: false, collectFiles: false })});`;

  try {
    const result = await entry.view.webContents.executeJavaScript(script);
    const debug = result && result.debug;
    console.log(
      `[selector:test] platform=${platform} ok=${result ? result.ok : false} ` +
        `matchedNodes=${debug ? debug.matchedNodeCount : '?'} nonEmptyMessages=${
          debug ? debug.nonEmptyMessageCount : '?'
        } selector="${selector.turn}"`
    );
    return result;
  } catch (err) {
    return { ok: false, error: 'EXECUTE_FAILED: ' + err.message, messages: [] };
  }
}

module.exports = {
  captureCurrentConversation,
  exportCurrentConversation,
  exportConversationEntry,
  pickSelectorSample,
  testCaptureSelector,
  diagnoseCapture,
};
