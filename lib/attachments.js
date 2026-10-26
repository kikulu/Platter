'use strict';

/**
 * lib/attachments.js
 *
 * 匯出對話時「一起下載對話裡的檔案」（1.50.0）。
 *
 * extractors/domCapture.js 只在畫面上收集檔案的網址與名稱（外部輸入、不可信）；實際下載在主行程做。
 * 這個檔案是下載邏輯：網址安全檢查、檔名清理與去重、下載限制，網路與頁面存取（fetchUrl）由呼叫端注入，
 * 所以可以純函式／假 io 測試，不依賴 Electron。
 *
 * 安全原則（網址來自 AI 平台頁面上的 DOM，內容可能被對話內容影響）：
 *   - 只接受 http／https／blob／data；
 *   - http(s) 只下載「跟頁面同源」或「公開 https 主機」，一律不下載 localhost／私有網段／連結本機位址
 *     （避免對話裡的惡意連結讓帶著登入 cookie 的請求打到內網或本機服務；本地端 AI 服務帳號是同源，不受限）；
 *   - 單檔、總量、數量都有上限；檔名清理掉路徑分隔符與保留字，絕不寫出匯出資料夾之外。
 */

const fs = require('fs');
const path = require('path');

const LIMITS = {
  files: 100,
  fileBytes: 100 * 1024 * 1024,
  totalBytes: 500 * 1024 * 1024,
};

function isPrivateHost(hostname) {
  const h = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!h) return true;
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    return (
      a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)
    );
  }
  if (h.includes(':')) {
    // IPv6：回送、未指定、唯一本機（fc00::/7）、連結本機（fe80::/10）、IPv4 對映
    return h === '::1' || h === '::' || /^f[cd]/.test(h) || /^fe[89ab]/.test(h) || h.startsWith('::ffff:');
  }
  return false;
}

/**
 * @returns {'http'|'inline'|null} http＝主行程用 session 下載；inline＝blob:／data:；null＝不允許
 */
function classifyUrl(url, pageUrl) {
  let u;
  try {
    u = new URL(String(url));
  } catch (err) {
    return null;
  }
  let page = null;
  try {
    page = new URL(String(pageUrl));
  } catch (err) {
    page = null;
  }
  if (u.protocol === 'data:') return 'inline';
  if (u.protocol === 'blob:') {
    // blob:https://host/uuid 只在產生它的頁面有效；要求跟頁面同源
    return page && u.origin === page.origin ? 'inline' : null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (page && u.origin === page.origin) return 'http';
  if (u.protocol === 'https:' && !isPrivateHost(u.hostname)) return 'http';
  return null;
}

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

function sanitizeFileName(name, fallback = 'file') {
  let s = String(name || '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .replace(/[. ]+$/, '');
  if (!s || WINDOWS_RESERVED.test(s)) s = s ? '_' + s : fallback;
  if (s.length > 120) {
    const ext = path.extname(s).slice(0, 12);
    s = s.slice(0, 120 - ext.length) + ext;
  }
  return s;
}

const CONTENT_TYPE_EXT = {
  'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp', 'image/svg+xml': '.svg',
  'application/pdf': '.pdf', 'text/plain': '.txt', 'text/markdown': '.md', 'text/csv': '.csv', 'application/json': '.json',
  'application/zip': '.zip', 'audio/mpeg': '.mp3', 'audio/wav': '.wav', 'video/mp4': '.mp4', 'video/webm': '.webm',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'text/html': '.html',
};

function extFromContentType(ct) {
  const base = String(ct || '').split(';')[0].trim().toLowerCase();
  return CONTENT_TYPE_EXT[base] || '';
}

function fileNameFromContentDisposition(header) {
  const h = String(header || '');
  const star = h.match(/filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/);
  if (star) {
    try {
      return decodeURIComponent(star[1].trim());
    } catch (err) {
      // 往下試一般 filename
    }
  }
  const plain = h.match(/filename\s*=\s*"?([^";]+)"?/);
  return plain ? plain[1].trim() : '';
}

/** 在 dir 底下找一個不存在、也不在 used 裡的檔名（name、name (2)…） */
function uniqueName(dir, name, used) {
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  let candidate = name;
  for (let i = 2; used.has(candidate.toLowerCase()) || fs.existsSync(path.join(dir, candidate)); i += 1) {
    candidate = `${stem} (${i})${ext}`;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

function decodeDataUrl(url) {
  const m = String(url).match(/^data:([^,]*),(.*)$/s);
  if (!m) return null;
  const meta = m[1];
  const isB64 = /;base64$/i.test(meta);
  const buffer = isB64 ? Buffer.from(m[2], 'base64') : Buffer.from(decodeURIComponent(m[2]), 'utf-8');
  return { buffer, contentType: meta.replace(/;base64$/i, '') };
}

/**
 * 下載一批附件到 destDir（有任何檔案成功才會建立資料夾）。
 *
 * @param {{url:string|null,name:string,kind?:string}[]} attachments
 * @param {string} destDir
 * @param {{ pageUrl: string, fetchUrl: (url:string, kind:'http'|'blob') => Promise<{buffer:Buffer,contentType?:string,contentDisposition?:string}> }} io
 * @returns {Promise<{ results: object[], saved: number, failed: number, nameOnly: number, skipped: number }>}
 *   results 與 attachments 同順序；每筆是 { ...原附件, status: 'saved'|'failed'|'name-only'|'skipped', localName?, reason? }
 */
async function downloadAttachments(attachments, destDir, io) {
  const used = new Set();
  const results = [];
  let total = 0;
  let saved = 0;
  let failed = 0;
  let nameOnly = 0;
  let skipped = 0;
  // 同一個網址只下載一次
  const byUrl = new Map();
  for (const att of Array.isArray(attachments) ? attachments : []) {
    const base = { url: att.url || null, name: att.name || '', kind: att.kind || 'link' };
    if (!att.url) {
      nameOnly += 1;
      results.push({ ...base, status: 'name-only' });
      continue;
    }
    if (byUrl.has(att.url)) {
      results.push({ ...base, ...byUrl.get(att.url) });
      continue;
    }
    const finish = (r) => {
      byUrl.set(att.url, r);
      results.push({ ...base, ...r });
    };
    if (saved + failed + skipped >= LIMITS.files) {
      skipped += 1;
      finish({ status: 'skipped', reason: 'too-many' });
      continue;
    }
    const kind = classifyUrl(att.url, io.pageUrl);
    if (!kind) {
      skipped += 1;
      finish({ status: 'skipped', reason: 'blocked-url' });
      continue;
    }
    try {
      let got;
      if (att.url.startsWith('data:')) got = decodeDataUrl(att.url);
      else got = await io.fetchUrl(att.url, kind === 'inline' ? 'blob' : 'http');
      if (!got || !got.buffer) throw new Error('empty');
      const size = got.buffer.length;
      if (size > LIMITS.fileBytes) {
        skipped += 1;
        finish({ status: 'skipped', reason: 'too-large' });
        continue;
      }
      if (total + size > LIMITS.totalBytes) {
        skipped += 1;
        finish({ status: 'skipped', reason: 'total-limit' });
        continue;
      }
      let name = sanitizeFileName(
        fileNameFromContentDisposition(got.contentDisposition) || att.name || path.basename(new URL(att.url).pathname || '') || 'file'
      );
      if (!path.extname(name)) name += extFromContentType(got.contentType);
      fs.mkdirSync(destDir, { recursive: true });
      name = uniqueName(destDir, name, used);
      fs.writeFileSync(path.join(destDir, name), got.buffer);
      total += size;
      saved += 1;
      finish({ status: 'saved', localName: name, size });
    } catch (err) {
      failed += 1;
      finish({ status: 'failed', reason: String((err && err.message) || err).slice(0, 80) });
    }
  }
  return { results, saved, failed, nameOnly, skipped };
}

module.exports = {
  LIMITS,
  isPrivateHost,
  classifyUrl,
  sanitizeFileName,
  extFromContentType,
  fileNameFromContentDisposition,
  downloadAttachments,
  uniqueName,
};
