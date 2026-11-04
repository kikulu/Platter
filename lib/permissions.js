'use strict';

/**
 * lib/permissions.js
 *
 * 資安稽核 N-3：Electron 在沒有權限處理器時，預設「全部允許」第三方網頁的權限請求
 * （相機、定位、通知、剪貼簿讀取…）。這裡集中決定哪些放行，其餘一律拒絕。
 *
 * 純函式，不依賴 Electron；applyPermissionPolicy(ses) 才會碰 session。
 *
 * 放行：
 *   - media：只放行「只有麥克風」的請求（AI 平台的語音輸入／語音對話）；有鏡頭的一律拒絕
 *   - clipboard-sanitized-write：網頁的「複製」按鈕
 *   - fullscreen：影片／圖片全螢幕
 * 其餘（定位、通知、鏡頭、螢幕擷取、剪貼簿讀取、MIDI、藍牙／USB／HID、openExternal…）一律拒絕。
 * 而且請求來源必須是 https（或本機 localhost，給本地端 AI 服務帳號）。
 */

const ALWAYS_ALLOWED = new Set(['clipboard-sanitized-write', 'fullscreen']);

function isSecureOrigin(url) {
  let u;
  try {
    u = new URL(String(url));
  } catch (err) {
    return false;
  }
  if (u.protocol === 'https:') return true;
  if (u.protocol === 'http:') {
    const h = u.hostname.replace(/^\[|\]$/g, '');
    return h === 'localhost' || h === '127.0.0.1' || h === '::1';
  }
  return false;
}

/**
 * @param {string} permission  Electron 的權限名稱
 * @param {string} requestingUrl  發出請求的頁面網址
 * @param {{ mediaTypes?: string[] }} [details]
 */
function decidePermission(permission, requestingUrl, details) {
  if (!isSecureOrigin(requestingUrl)) return false;
  if (ALWAYS_ALLOWED.has(permission)) return true;
  if (permission === 'media') {
    // 請求處理器給 mediaTypes（陣列）；檢查處理器給 mediaType（單一字串）
    let types = [];
    if (details && Array.isArray(details.mediaTypes)) types = details.mediaTypes;
    else if (details && typeof details.mediaType === 'string')
      types = [details.mediaType];
    // 沒有說明類型（例如只是檢查）時不放行；只有 audio 才放行
    return types.length > 0 && types.every((m) => m === 'audio');
  }
  return false;
}

const applied = new WeakSet();

/** 對一個 session 套用權限政策（同一個 session 只會套一次）。 */
function applyPermissionPolicy(ses) {
  if (!ses || applied.has(ses)) return;
  applied.add(ses);
  ses.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const url =
      (details && details.requestingUrl) ||
      (webContents && webContents.getURL && webContents.getURL());
    callback(decidePermission(permission, url, details));
  });
  ses.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    const url = requestingOrigin || (details && details.requestingUrl);
    return decidePermission(permission, url, details);
  });
}

module.exports = { decidePermission, isSecureOrigin, applyPermissionPolicy };
