'use strict';

/**
 * lib/security.js
 *
 * 資安防護用的小工具（1.42.0，見 docs/SECURITY_AUDIT_REPORT.md）。這個檔案刻意不 require
 * 'electron'：需要 webContents／ipcMain 的函式都由呼叫端傳進來，這樣可以用假物件直接用
 * `node --test` 測試，不需要啟動 Electron。
 *
 *   - 網址判斷：isHttpUrl / isSafeExternalUrl / normalizeServiceUrl
 *   - 路徑判斷：isPathInside
 *   - 視窗加固：hardenAppWebContents / hardenAccountWebContents
 *   - IPC 來源檢查：isTrustedAppUrl / isTrustedSender / guardIpc
 *   - 可執行檔判斷：isExecutableFile
 *   - 擴充功能權限摘要：summarizeExtensionPermissions
 */

const fs = require('fs');
const path = require('path');
const { fileURLToPath } = require('url');

// ---------------------------------------------------------------------------
// 網址
// ---------------------------------------------------------------------------

function parseUrl(input) {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed || trimmed.length > 2048) return null;
  try {
    return new URL(trimmed);
  } catch (err) {
    return null;
  }
}

/** 是不是 http:／https: 網址。 */
function isHttpUrl(input) {
  const u = parseUrl(input);
  return !!u && (u.protocol === 'http:' || u.protocol === 'https:');
}

/** 可以交給系統瀏覽器／郵件程式開啟的網址：只接受 http:、https:、mailto:。 */
function isSafeExternalUrl(input) {
  const u = parseUrl(input);
  return (
    !!u && (u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'mailto:')
  );
}

/**
 * 本地端 AI 服務的網址：只接受 http(s)。合法回傳去掉頭尾空白的原字串（不改寫，
 * 使用者輸入什麼就存什麼），不合法回傳 null。
 */
function normalizeServiceUrl(input) {
  if (!isHttpUrl(input)) return null;
  return String(input).trim();
}

// ---------------------------------------------------------------------------
// 路徑
// ---------------------------------------------------------------------------

/** child 是否位於 parent 資料夾「底下」（不含 parent 自己）。不解析符號連結。 */
function isPathInside(child, parent) {
  if (typeof child !== 'string' || typeof parent !== 'string' || !child || !parent) {
    return false;
  }
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  if (!rel || rel === '..' || rel.startsWith('..' + path.sep)) return false;
  return !path.isAbsolute(rel);
}

// ---------------------------------------------------------------------------
// 可執行檔／容易夾帶指令的副檔名
// ---------------------------------------------------------------------------

const EXECUTABLE_EXTENSIONS = new Set([
  // Windows 可執行與腳本
  '.exe',
  '.com',
  '.bat',
  '.cmd',
  '.msi',
  '.msp',
  '.scr',
  '.pif',
  '.lnk',
  '.url',
  '.vbs',
  '.vbe',
  '.js',
  '.jse',
  '.wsf',
  '.wsh',
  '.ps1',
  '.psm1',
  '.psd1',
  '.reg',
  '.hta',
  '.cpl',
  '.jar',
  '.dll',
  '.sys',
  '.inf',
  '.gadget',
  '.msc',
  '.chm',
  '.scf',
  '.application',
  '.appref-ms',
  // macOS／Linux
  '.app',
  '.command',
  '.sh',
  '.bash',
  '.zsh',
  '.run',
  '.bin',
  '.appimage',
  '.deb',
  '.rpm',
  '.dmg',
  '.pkg',
  '.apk',
  '.desktop',
  // 會被瀏覽器當成網頁執行腳本
  '.html',
  '.htm',
  '.xhtml',
  '.svg',
  // 可含巨集的 Office 文件
  '.docm',
  '.xlsm',
  '.pptm',
  '.dotm',
  '.xltm',
]);

/** 檔名（或路徑）的副檔名是否在「不直接用系統預設程式開啟」清單裡。 */
function isExecutableFile(filePath) {
  if (typeof filePath !== 'string') return false;
  // Windows 會忽略檔名結尾的空白與點（"a.exe " 實際上是 a.exe）
  const cleaned = filePath.replace(/[\s.]+$/, '');
  return EXECUTABLE_EXTENSIONS.has(path.extname(cleaned).toLowerCase());
}

// ---------------------------------------------------------------------------
// 視窗加固
// ---------------------------------------------------------------------------

/**
 * 自己的 renderer 頁面是不是 `renderer/` 底下的 file:// 頁面（查詢字串與 hash 不影響判斷）。
 */
function isTrustedAppUrl(url, rendererDir) {
  const u = parseUrl(url);
  if (!u || u.protocol !== 'file:') return false;
  try {
    return isPathInside(fileURLToPath(u), rendererDir);
  } catch (err) {
    return false;
  }
}

/**
 * 加固「自己的」視窗（主視窗、子視窗、托盤——有掛 preload 的那種）：
 * 不允許導覽到自己頁面以外的地方、不允許開新視窗。
 * onBlock(kind, url) 是選用的回報函式（寫日誌用）。
 */
function hardenAppWebContents(webContents, { rendererDir, onBlock } = {}) {
  const guardNavigation = (event, maybeUrl) => {
    const url = typeof maybeUrl === 'string' ? maybeUrl : event && event.url;
    if (isTrustedAppUrl(url, rendererDir)) return;
    event.preventDefault();
    if (onBlock) onBlock('navigate', url);
  };
  webContents.on('will-navigate', guardNavigation);
  webContents.on('will-redirect', guardNavigation);
  webContents.setWindowOpenHandler(({ url } = {}) => {
    if (onBlock) onBlock('open', url);
    return { action: 'deny' };
  });
}

const ACCOUNT_ALLOWED_PROTOCOLS = new Set([
  'http:',
  'https:',
  'about:',
  'blob:',
  'data:',
]);

/**
 * 加固帳號視圖（第三方網站，沒有 preload）：只擋掉 file: 之類不是網頁的協定，
 * 一般 http(s) 導覽與彈窗照舊放行（OAuth 彈窗登入需要）。
 */
function hardenAccountWebContents(webContents, { onBlock } = {}) {
  const allowed = (url) => {
    const u = parseUrl(url);
    return !!u && ACCOUNT_ALLOWED_PROTOCOLS.has(u.protocol);
  };
  const guardNavigation = (event, maybeUrl) => {
    const url = typeof maybeUrl === 'string' ? maybeUrl : event && event.url;
    if (allowed(url)) return;
    event.preventDefault();
    if (onBlock) onBlock('navigate', url);
  };
  webContents.on('will-navigate', guardNavigation);
  webContents.on('will-redirect', guardNavigation);
  webContents.setWindowOpenHandler(({ url } = {}) => {
    if (allowed(url)) return { action: 'allow' };
    if (onBlock) onBlock('open', url);
    return { action: 'deny' };
  });
}

// ---------------------------------------------------------------------------
// IPC 來源檢查
// ---------------------------------------------------------------------------

/** IPC 呼叫是不是從自己的 renderer 頁面發出的（看 senderFrame 的網址）。 */
function isTrustedSender(event, rendererDir) {
  const frame = event && event.senderFrame;
  if (!frame || typeof frame.url !== 'string') return false;
  return isTrustedAppUrl(frame.url, rendererDir);
}

/**
 * 包一層 ipcMain：每個 handler 執行前先檢查呼叫來源，不是自己的頁面就拒絕。
 * 回傳的物件只提供 handle／on／removeHandler（專案的 lib/ipc/*.js 只用到 handle）。
 * onReject(channel, event) 是選用的回報函式（寫日誌用）。
 */
function guardIpc(ipcMain, { rendererDir, onReject } = {}) {
  const wrap =
    (channel, listener) =>
    (event, ...args) => {
      if (!isTrustedSender(event, rendererDir)) {
        if (onReject) onReject(channel, event);
        throw new Error('UNTRUSTED_SENDER');
      }
      return listener(event, ...args);
    };
  return {
    handle: (channel, listener) => ipcMain.handle(channel, wrap(channel, listener)),
    on: (channel, listener) => ipcMain.on(channel, wrap(channel, listener)),
    removeHandler: (channel) => ipcMain.removeHandler(channel),
  };
}

// ---------------------------------------------------------------------------
// 擴充功能權限摘要
// ---------------------------------------------------------------------------

const BROAD_HOST_PATTERNS = [
  '<all_urls>',
  '*://*/*',
  'http://*/*',
  'https://*/*',
  '*://*/',
];

/**
 * 從 manifest.json 取出使用者該知道的權限。
 * @returns {{ permissions: string[], hostPermissions: string[], broad: boolean }}
 */
function summarizeExtensionPermissions(manifest) {
  const m = manifest && typeof manifest === 'object' ? manifest : {};
  const strings = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);
  // MV2 把網址樣式也放在 permissions 裡，這裡一併歸到「可存取的網站」
  const isHostPattern = (p) => /^(\*|https?|file|ftp):|^<all_urls>$/.test(p);
  const all = strings(m.permissions);
  const permissions = all.filter((p) => !isHostPattern(p));
  const hostPermissions = [...strings(m.host_permissions), ...all.filter(isHostPattern)];
  const broad = hostPermissions.some((h) => BROAD_HOST_PATTERNS.includes(h));
  return { permissions, hostPermissions, broad };
}

/** 給確認對話框用的文字。 */
function formatExtensionPermissionSummary(summary) {
  const lines = [];
  lines.push(
    summary.permissions.length
      ? `權限：${summary.permissions.join('、')}`
      : '權限：（沒有宣告額外權限）'
  );
  lines.push(
    summary.hostPermissions.length
      ? `可存取的網站：${summary.hostPermissions.join('、')}`
      : '可存取的網站：（沒有宣告）'
  );
  if (summary.broad) {
    lines.push(
      '⚠ 這個擴充功能可以存取所有網站，包括你登入的每一個 AI 平台頁面與對話內容。'
    );
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// 備份檔（.bak）
// ---------------------------------------------------------------------------

/** 刪掉單一資料檔的 .bak。不存在視為成功。 */
function removeBackupFor(filePath) {
  try {
    fs.rmSync(`${filePath}.bak`, { force: true });
    return true;
  } catch (err) {
    return false;
  }
}

/** 刪掉資料夾（只看第一層）裡所有 `*.json.bak`，回傳刪除的檔案數。 */
function removeAllBackupFiles(dir) {
  let count = 0;
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch (err) {
    return 0;
  }
  names.forEach((name) => {
    if (!/\.json\.bak$/i.test(name)) return;
    try {
      fs.rmSync(path.join(dir, name), { force: true });
      count += 1;
    } catch (err) {
      // 單一檔案刪不掉不影響其他檔案
    }
  });
  return count;
}

module.exports = {
  isHttpUrl,
  isSafeExternalUrl,
  normalizeServiceUrl,
  isPathInside,
  EXECUTABLE_EXTENSIONS,
  isExecutableFile,
  isTrustedAppUrl,
  isTrustedSender,
  hardenAppWebContents,
  hardenAccountWebContents,
  guardIpc,
  summarizeExtensionPermissions,
  formatExtensionPermissionSummary,
  removeBackupFor,
  removeAllBackupFiles,
};
