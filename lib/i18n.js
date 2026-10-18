'use strict';

/**
 * lib/i18n.js
 *
 * 主程序（main process）用的語系翻譯：跟 renderer 共用同一份 `renderer/locales/<lang>.json`，
 * 所以三語系的鍵集合一致性由 `npm run check:docs` 一併把關。
 *
 *   t('main.settings.confirmRestart')                 // 用目前介面語言
 *   t('main.docs.importDone', { count: 3 })           // 取代 {count}
 *   t('main.docs.importDone', { count: 3 }, 'en')     // 指定語言（例如依檔案內容產生的文字）
 *
 * 找不到鍵時退回 zh-TW，再找不到就回傳鍵本身。刻意不依賴 Electron，可以直接用 `node --test` 測試。
 */

const fs = require('fs');
const path = require('path');

const LOCALE_DIR = path.join(__dirname, '..', 'renderer', 'locales');
const SUPPORTED_LANGUAGES = ['zh-TW', 'en', 'ja'];
const DEFAULT_LANGUAGE = 'zh-TW';

const cache = new Map();

function loadDictionary(lang) {
  if (cache.has(lang)) return cache.get(lang);
  let dict = {};
  try {
    dict = JSON.parse(fs.readFileSync(path.join(LOCALE_DIR, `${lang}.json`), 'utf8'));
  } catch (err) {
    dict = {};
  }
  cache.set(lang, dict);
  return dict;
}

/** 目前介面語言（讀 appState.ui.language，不合法就退回 zh-TW）。 */
function currentLanguage() {
  let lang = DEFAULT_LANGUAGE;
  try {
    const state = require('./state');
    lang = (state.appState && state.appState.ui && state.appState.ui.language) || lang;
  } catch (err) {
    // state 還沒載入（例如單獨測試某個純函式）時用預設語言
  }
  return SUPPORTED_LANGUAGES.includes(lang) ? lang : DEFAULT_LANGUAGE;
}

function t(key, vars, lang) {
  const language = lang && SUPPORTED_LANGUAGES.includes(lang) ? lang : currentLanguage();
  let text = loadDictionary(language)[key];
  if (text === undefined) text = loadDictionary(DEFAULT_LANGUAGE)[key];
  if (text === undefined) return key;
  if (vars) {
    Object.keys(vars).forEach((name) => {
      text = text.split(`{${name}}`).join(String(vars[name]));
    });
  }
  return text;
}

module.exports = { t, currentLanguage, SUPPORTED_LANGUAGES, DEFAULT_LANGUAGE };
