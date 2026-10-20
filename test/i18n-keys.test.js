'use strict';

/**
 * test/i18n-keys.test.js
 *
 * 多語系防回歸：
 *   1. 程式碼裡用 t('key')／window.i18n.t('key') 引用的鍵，三個語系檔都必須存在；
 *   2. 視窗標題（<title data-i18n>）的鍵存在；
 *   3. 主程序與 renderer 的程式碼不可新增寫死的中文字串（註解、console 訊息與少數白名單除外），
 *      使用者看得到的文字一律放進 renderer/locales。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const LANGS = ['zh-TW', 'en', 'ja'];
const dicts = Object.fromEntries(
  LANGS.map((l) => [
    l,
    JSON.parse(
      fs.readFileSync(path.join(ROOT, 'renderer', 'locales', `${l}.json`), 'utf8')
    ),
  ])
);

function walk(dir, out = []) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (['vendor', 'locales', 'node_modules'].includes(e.name)) return;
      walk(p, out);
    } else if (e.name.endsWith('.js')) out.push(p);
  });
  return out;
}

const sources = [
  ...walk(path.join(ROOT, 'lib')),
  ...walk(path.join(ROOT, 'renderer')),
  path.join(ROOT, 'main.js'),
].filter((f) => !f.endsWith(path.join('lib', 'i18n.js')));

test('程式碼引用的翻譯鍵，三個語系都存在', () => {
  const re = /(?<![\w.])(?:window\.i18n\.)?t\(\s*['"]([a-zA-Z0-9_.-]+)['"]/g;
  const missing = [];
  sources.forEach((f) => {
    const text = fs.readFileSync(f, 'utf8');
    let m;
    while ((m = re.exec(text))) {
      LANGS.forEach((l) => {
        if (!(m[1] in dicts[l]))
          missing.push(`${path.relative(ROOT, f)}: ${m[1]} (${l})`);
      });
    }
  });
  assert.deepEqual(missing, []);
});

test('HTML 的 data-i18n／data-i18n-placeholder／data-i18n-title 鍵都存在', () => {
  const dir = path.join(ROOT, 'renderer');
  const missing = [];
  fs.readdirSync(dir)
    .filter((f) => f.endsWith('.html'))
    .forEach((f) => {
      const html = fs.readFileSync(path.join(dir, f), 'utf8');
      for (const m of html.matchAll(/data-i18n(?:-placeholder|-title)?="([^"]+)"/g)) {
        LANGS.forEach((l) => {
          if (!(m[1] in dicts[l])) missing.push(`${f}: ${m[1]} (${l})`);
        });
      }
    });
  assert.deepEqual(missing, []);
});

test('每個頁面的視窗標題都跟著語言（<title data-i18n>）', () => {
  const dir = path.join(ROOT, 'renderer');
  const untranslated = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.html') && f !== 'index.html') // index 是品牌名稱，不翻
    .filter(
      (f) => !/<title data-i18n="[^"]+">/.test(fs.readFileSync(path.join(dir, f), 'utf8'))
    );
  assert.deepEqual(untranslated, []);
});

// 允許出現中文的程式碼行（比對「檔案:去掉空白的行」是否含這段文字）
const CJK_ALLOWED = [
  { file: 'lib/reminders.js', pattern: /./ }, // 提醒通知有自己的三語文字表
  { file: 'lib/openspec.js', pattern: /建議變更名稱/ }, // 解析 AI 回覆的標記，需要認得三種語言的標籤
  { file: 'renderer/project/project-pitch.js', pattern: /簡報製作/ }, // 內建標籤的三種寫法
  { file: 'lib/builtinContent.js', pattern: /./ }, // 內建內容的語言對照
];

test('程式碼沒有新增寫死的中文字串（註解、console 訊息、白名單除外）', () => {
  const cjk = /[一-鿿぀-ヿ]/;
  const offenders = [];
  sources.forEach((f) => {
    const rel = path.relative(ROOT, f).split(path.sep).join('/');
    let inBlock = false;
    fs.readFileSync(f, 'utf8')
      .split(/\r?\n/)
      .forEach((line, i) => {
        let code = line;
        if (inBlock) {
          if (code.includes('*/')) {
            inBlock = false;
            code = code.slice(code.indexOf('*/') + 2);
          } else return;
        }
        code = code.replace(/\/\*.*?\*\//g, '');
        if (code.includes('/*')) {
          inBlock = true;
          code = code.slice(0, code.indexOf('/*'));
        }
        code = code.replace(/(^|\s)\/\/.*$/, '');
        if (!cjk.test(code)) return;
        if (/console\.(log|error|warn)/.test(code)) return;
        if (CJK_ALLOWED.some((a) => a.file === rel && a.pattern.test(code))) return;
        offenders.push(`${rel}:${i + 1}: ${code.trim().slice(0, 80)}`);
      });
  });
  assert.deepEqual(offenders, []);
});
