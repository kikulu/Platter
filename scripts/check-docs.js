'use strict';

/**
 * scripts/check-docs.js
 *
 * 文件與版本漂移檢查（無外部依賴）：
 *   1. package.json 版本 = CHANGELOG.md 第一個版本標題
 *   2. 接續開發提示詞檔寫的「目前版本」= package.json 版本
 *   3. 三語系 locale 鍵集合一致
 *   4. README／PROJECT_SPEC 寫的內建數量 = 種子資料實際數量
 *   5. README 文件索引（相對連結）指向的檔案都存在
 *
 * 用法：`npm run check:docs`（有問題時結束碼為 1）；
 * test/docs-consistency.test.js 也會呼叫 runChecks() 讓 `npm test` 一併檢查。
 */

const fs = require('fs');
const path = require('path');

function readText(root, rel) {
  return fs.readFileSync(path.join(root, rel), 'utf-8').replace(/\r\n/g, '\n');
}

function readJson(root, rel) {
  return JSON.parse(readText(root, rel));
}

function runChecks(root) {
  const problems = [];
  const pkg = readJson(root, 'package.json');
  const version = pkg.version;

  // 1. CHANGELOG 第一個版本
  const changelog = readText(root, 'CHANGELOG.md');
  const m = changelog.match(/^## \[(\d+\.\d+\.\d+)\]/m);
  if (!m) problems.push('CHANGELOG.md 找不到版本標題');
  else if (m[1] !== version) {
    problems.push(`CHANGELOG.md 最新版本 ${m[1]} 與 package.json ${version} 不一致`);
  }

  // 2. 提示詞檔的「目前版本」
  const promptChecks = [
    ['NEW_FEATURE_BUILD_PROMPT.md', /同步在 `(\d+\.\d+\.\d+)`/],
    ['NEW_FEATURE_BUILD_PROMPT.md', /目前版本是\s*(\d+\.\d+\.\d+)/],
    ['FIX_EXISTING_FEATURE_PROMPT.md', /目前版本是\s*(\d+\.\d+\.\d+)/],
  ];
  for (const [file, re] of promptChecks) {
    const mm = readText(root, file).match(re);
    if (!mm) problems.push(`${file} 找不到「目前版本」字樣（${re}）`);
    else if (mm[1] !== version) {
      problems.push(`${file} 寫的目前版本 ${mm[1]}，package.json 是 ${version}`);
    }
  }

  // 3. locale 鍵一致
  const locales = {};
  for (const lang of ['zh-TW', 'en', 'ja']) {
    locales[lang] = Object.keys(readJson(root, `renderer/locales/${lang}.json`));
  }
  const base = new Set(locales['zh-TW']);
  for (const lang of ['en', 'ja']) {
    const set = new Set(locales[lang]);
    const missing = [...base].filter((k) => !set.has(k));
    const extra = [...set].filter((k) => !base.has(k));
    if (missing.length) problems.push(`${lang}.json 缺少鍵：${missing.slice(0, 5).join(', ')}…（共 ${missing.length}）`);
    if (extra.length) problems.push(`${lang}.json 多出鍵：${extra.slice(0, 5).join(', ')}…（共 ${extra.length}）`);
  }

  // 4. 內建數量
  const kb = readJson(root, 'extractors/default-knowledge-base.json');
  const itemCount = (kb.items || []).length;
  const groupCount = (kb.groups || []).length;
  const countRules = [
    ['README.md', /內建\s*(\d+)\s*組跨領域提示詞範本/g, itemCount, '內建提示詞'],
    ['README.md', /內建\s*(\d+)\s*組提示詞範本/g, itemCount, '內建提示詞'],
    ['README.en.md', /(\d+) built-in prompt templates/g, itemCount, '內建提示詞'],
    ['README.ja.md', /組み込みプロンプトテンプレート\s*(\d+)\s*個/g, itemCount, '內建提示詞'],
    ['PROJECT_SPEC.md', /內建的(\d+)組提示詞範本/g, itemCount, '內建提示詞'],
  ];
  for (const [file, re, expected, label] of countRules) {
    for (const mm of readText(root, file).matchAll(re)) {
      if (Number(mm[1]) !== expected) {
        problems.push(`${file} 寫${label} ${mm[1]} 組，實際是 ${expected}`);
      }
    }
  }
  void groupCount;

  // 5. README 索引連結
  for (const file of ['README.md', 'README.en.md', 'README.ja.md', 'ROADMAP.md']) {
    const text = readText(root, file);
    const seen = new Set();
    for (const mm of text.matchAll(/\]\((\.\/[^)#\s]+)\)/g)) seen.add(mm[1]);
    for (const link of seen) {
      if (!fs.existsSync(path.join(root, link))) problems.push(`${file} 連到不存在的檔案 ${link}`);
    }
  }

  return problems;
}

module.exports = { runChecks };

if (require.main === module) {
  const problems = runChecks(path.join(__dirname, '..'));
  if (problems.length) {
    console.error('文件檢查發現 ' + problems.length + ' 個問題：');
    for (const p of problems) console.error(' - ' + p);
    process.exit(1);
  }
  console.log('文件檢查通過');
}
